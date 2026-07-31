import { schema } from "@mams/db";
import { taskLabel } from "@mams/shared";
import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type { Db } from "../db";
import { env } from "../env";
import { addDaysISO, todayISO } from "../lib/time";
import { logActivity } from "./activity";
import { notifyResponsible, notifyUser } from "./notify";
import { scheduleStageAutoReminder } from "./reminder-service";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type TaskRow = typeof schema.tasks.$inferSelect;

async function assigneesOf(tx: Tx | Db, taskId: string): Promise<string[]> {
  const rows = await tx
    .select({ userId: schema.taskAssignees.userId })
    .from(schema.taskAssignees)
    .where(eq(schema.taskAssignees.taskId, taskId));
  return rows.map((r) => r.userId);
}

async function labelOfStage(tx: Tx | Db, stageId: string | null): Promise<string> {
  if (!stageId) return taskLabel(null);
  const [stage] = await tx.select().from(schema.stages).where(eq(schema.stages.id, stageId));
  return taskLabel(stage?.name ?? null);
}

async function isActive(tx: Tx | Db, userId: string) {
  const [u] = await tx.select().from(schema.user).where(eq(schema.user.id, userId));
  return !!u && !u.banned;
}

/**
 * Shared assignment resolution for handoff + preview (kept in one place so
 * "what will happen" and "what happens" can never disagree). Rule B considers
 * everyone who worked the completed task and keeps *all* of them who hold a
 * qualifying skill — assignment is a set now, not a single owner.
 */
async function resolveNextAssignees(
  tx: Tx | Db,
  completed: TaskRow,
  next: TaskRow,
): Promise<{ assigneeIds: string[]; route: "pre_assigned" | "same_person" | null }> {
  const preAssigned: string[] = [];
  for (const userId of await assigneesOf(tx, next.id)) {
    if (await isActive(tx, userId)) preAssigned.push(userId);
  }
  if (preAssigned.length > 0) return { assigneeIds: preAssigned, route: "pre_assigned" };
  if (!next.stageId) return { assigneeIds: [], route: null };

  const qualified: string[] = [];
  for (const candidateId of await assigneesOf(tx, completed.id)) {
    if (!(await isActive(tx, candidateId))) continue;
    const overlap = await tx
      .select({ skillId: schema.stageSkills.skillId })
      .from(schema.stageSkills)
      .innerJoin(
        schema.userSkills,
        and(
          eq(schema.userSkills.skillId, schema.stageSkills.skillId),
          eq(schema.userSkills.userId, candidateId),
        ),
      )
      .where(eq(schema.stageSkills.stageId, next.stageId))
      .limit(1);
    if (overlap.length > 0) qualified.push(candidateId);
  }
  return qualified.length > 0
    ? { assigneeIds: qualified, route: "same_person" }
    : { assigneeIds: [], route: null };
}

/**
 * "What will happen when this task is completed?" — powers the completion
 * dialog so the handoff is visible before it runs.
 */
export async function previewHandoff(dbc: Db, taskId: string) {
  const [task] = await dbc.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
  if (!task || task.chainPosition === null) return null;
  const [next] = await dbc
    .select()
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.projectId, task.projectId),
        eq(schema.tasks.chainPosition, task.chainPosition + 1),
      ),
    );
  if (!next) return { kind: "last_stage" as const };
  if (next.status !== "waiting") return { kind: "already_active" as const, nextTaskId: next.id };

  const { assigneeIds, route } = await resolveNextAssignees(dbc, task, next);
  const assignees =
    assigneeIds.length === 0
      ? []
      : await dbc
          .select({ id: schema.user.id, name: schema.user.name })
          .from(schema.user)
          .where(inArray(schema.user.id, assigneeIds));
  let defaultDeadline = next.deadline;
  if (!defaultDeadline && next.stageId) {
    const [stage] = await dbc.select().from(schema.stages).where(eq(schema.stages.id, next.stageId));
    if (stage) defaultDeadline = addDaysISO(todayISO(env.TZ_BUSINESS), stage.defaultDurationDays);
  }
  return {
    kind: "handoff" as const,
    nextTaskId: next.id,
    nextLabel: await labelOfStage(dbc, next.stageId),
    route: route ?? ("unassigned" as const),
    assignees,
    defaultStartDate: next.startDate ?? todayISO(env.TZ_BUSINESS),
    defaultDeadline,
  };
}

/**
 * The handoff engine (PLAN.md §4.1). Runs INSIDE the caller's transaction,
 * immediately after a task's status was conditionally updated to 'done'.
 *
 * Assignment resolution order (deliberate refinement, PLAN.md §4.1 note):
 *   A. explicit pre-assignment on the successor (active people only)
 *   B. whoever completed this task and holds a qualifying skill keeps the job
 *   C. unassigned queue + a notification to whoever can assign
 */
export async function runHandoff(tx: Tx, completed: TaskRow, actorId: string | null) {
  if (completed.chainPosition === null) return; // ad-hoc task: no chain

  const [next] = await tx
    .select()
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.projectId, completed.projectId),
        eq(schema.tasks.chainPosition, completed.chainPosition + 1),
      ),
    )
    .for("update");

  if (!next) {
    await maybeCompleteProject(tx, completed.projectId);
    return;
  }

  if (next.status !== "waiting") return; // already activated (e.g. re-completion after reopen)

  // --- resolve assignees (rules A/B shared with previewHandoff) -------------
  const preAssigned = await assigneesOf(tx, next.id);
  const { assigneeIds, route } = await resolveNextAssignees(tx, completed, next);
  const dropped = preAssigned.filter((id) => !assigneeIds.includes(id));
  if (dropped.length > 0) {
    await logActivity(tx, {
      actorId: null,
      entityType: "task",
      entityId: next.id,
      action: "assignment_cleared",
      detail: { reason: "assignee_inactive", previousAssignees: dropped },
    });
  }

  // --- activate the successor ----------------------------------------------
  const today = todayISO(env.TZ_BUSINESS);
  const startDate = next.startDate ?? today;
  let deadline = next.deadline; // never overwrite an explicitly set deadline
  let reminderRule = "none";
  if (next.stageId) {
    const [stage] = await tx.select().from(schema.stages).where(eq(schema.stages.id, next.stageId));
    if (stage) {
      reminderRule = stage.reminderRule;
      if (!deadline) deadline = addDaysISO(startDate, stage.defaultDurationDays);
    }
  }

  await tx
    .update(schema.tasks)
    .set({ status: "todo", activatedAt: new Date(), startDate, deadline })
    .where(eq(schema.tasks.id, next.id));
  await tx.delete(schema.taskAssignees).where(eq(schema.taskAssignees.taskId, next.id));
  if (assigneeIds.length > 0) {
    await tx
      .insert(schema.taskAssignees)
      .values(assigneeIds.map((userId) => ({ taskId: next.id, userId })))
      .onConflictDoNothing();
  }

  await logActivity(tx, {
    actorId: null,
    entityType: "task",
    entityId: next.id,
    action: "handoff",
    detail: { fromTask: completed.id, route: route ?? "unassigned", actorOfCompletion: actorId },
  });

  const [project] = await tx
    .select({ title: schema.projects.title })
    .from(schema.projects)
    .where(eq(schema.projects.id, completed.projectId));
  const projectTitle = project?.title ?? "project";
  const label = await labelOfStage(tx, next.stageId);

  if (assigneeIds.length > 0) {
    await scheduleStageAutoReminder(tx, { id: next.id, assigneeIds, deadline, label }, reminderRule);
    for (const userId of assigneeIds) {
      await notifyUser(tx, userId, {
        type: "task_assigned",
        title: `New task: ${label} — ${projectTitle}`,
        body: deadline ? `Due ${deadline}` : undefined,
        entityType: "task",
        entityId: next.id,
      });
    }
  } else {
    await notifyResponsible(
      tx,
      "tasks.assign",
      {
        type: "handoff_unassigned",
        title: `Unassigned: ${label} for ${projectTitle} needs a person`,
        entityType: "task",
        entityId: next.id,
      },
      actorId ?? undefined,
    );
  }
}

/** Last stage done → project auto-completes (PLAN.md §4.3). */
async function maybeCompleteProject(tx: Tx, projectId: string) {
  const [open] = await tx
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.projectId, projectId),
        isNotNull(schema.tasks.chainPosition),
        ne(schema.tasks.status, "done"),
      ),
    )
    .limit(1);
  if (open) return;

  const [project] = await tx
    .update(schema.projects)
    .set({ status: "completed", completedAt: new Date() })
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.status, "active")))
    .returning();
  if (!project) return;

  await logActivity(tx, {
    actorId: null,
    entityType: "project",
    entityId: projectId,
    action: "status_changed",
    detail: { from: "active", to: "completed", reason: "all_stages_done" },
  });
  await notifyResponsible(tx, "projects.manage", {
    type: "project_completed",
    title: `${project.title} is complete 🎉`,
    entityType: "project",
    entityId: projectId,
  });
}

/**
 * Reopen support (PLAN.md §4.3): called when an admin reopens a done task.
 * Untouched successor reverts to waiting; a started successor triggers a
 * conflict flag on both tasks.
 */
export async function handleReopen(tx: Tx, reopened: TaskRow, actorId: string) {
  // a reopened task in a completed project re-activates the project
  await tx
    .update(schema.projects)
    .set({ status: "active", completedAt: null })
    .where(and(eq(schema.projects.id, reopened.projectId), eq(schema.projects.status, "completed")));

  if (reopened.chainPosition === null) return;

  const [next] = await tx
    .select()
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.projectId, reopened.projectId),
        eq(schema.tasks.chainPosition, reopened.chainPosition + 1),
      ),
    )
    .for("update");
  if (!next || next.status === "waiting") return;

  if (next.status === "todo") {
    // untouched successor → revert to waiting; auto-set dates are cleared, an
    // explicitly set schedule survives (detected via the audit trail)
    const manualSchedule = await tx
      .select({ id: schema.activityLog.id })
      .from(schema.activityLog)
      .where(
        and(
          eq(schema.activityLog.entityType, "task"),
          eq(schema.activityLog.entityId, next.id),
          eq(schema.activityLog.action, "schedule_changed"),
          isNotNull(schema.activityLog.actorId),
        ),
      )
      .limit(1);
    await tx
      .update(schema.tasks)
      .set({
        status: "waiting",
        activatedAt: null,
        ...(manualSchedule.length === 0 ? { startDate: null, deadline: null } : {}),
      })
      .where(eq(schema.tasks.id, next.id));
    await tx
      .update(schema.reminders)
      .set({ canceledAt: new Date() })
      .where(
        and(
          eq(schema.reminders.taskId, next.id),
          eq(schema.reminders.source, "auto"),
          sql`${schema.reminders.firedAt} IS NULL`,
          sql`${schema.reminders.canceledAt} IS NULL`,
        ),
      );
    await logActivity(tx, {
      actorId: null,
      entityType: "task",
      entityId: next.id,
      action: "reverted_to_waiting",
      detail: { reason: "predecessor_reopened", predecessor: reopened.id },
    });
    return;
  }

  // successor already in progress or done → humans must untangle it
  await tx
    .update(schema.tasks)
    .set({ flagged: true, flagNote: "Predecessor was reopened — coordinate with the team" })
    .where(inArray(schema.tasks.id, [reopened.id, next.id]));
  await logActivity(tx, {
    actorId,
    entityType: "task",
    entityId: next.id,
    action: "reopen_conflict",
    detail: { reopened: reopened.id, successor: next.id },
  });
  await notifyResponsible(tx, "tasks.manage", {
    type: "reopen_conflict",
    title: `Untangle: "${await labelOfStage(tx, reopened.stageId)}" reopened but "${await labelOfStage(tx, next.stageId)}" already started`,
    entityType: "task",
    entityId: next.id,
  });
}
