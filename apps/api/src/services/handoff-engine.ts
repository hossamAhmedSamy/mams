import { schema } from "@mams/db";
import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type { Db } from "../db";
import { env } from "../env";
import { addDaysISO, todayISO } from "../lib/time";
import { logActivity } from "./activity";
import { notifyAdmins, notifyUser } from "./notify";
import { scheduleStageAutoReminder } from "./reminder-service";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type TaskRow = typeof schema.tasks.$inferSelect;

/**
 * Shared assignment resolution for handoff + preview (kept in one place so
 * "what will happen" and "what happens" can never disagree).
 * Rule B considers everyone on the completed task — owner first, then helpers.
 */
async function resolveNextAssignee(
  tx: Tx | Db,
  completed: TaskRow,
  next: TaskRow,
): Promise<{ assigneeId: string | null; route: "pre_assigned" | "same_person" | null }> {
  if (next.assigneeId) {
    const [pre] = await tx.select().from(schema.user).where(eq(schema.user.id, next.assigneeId));
    if (pre && !pre.banned) return { assigneeId: pre.id, route: "pre_assigned" };
  }
  if (!next.stageId) return { assigneeId: null, route: null };

  const candidates: string[] = [];
  if (completed.assigneeId) candidates.push(completed.assigneeId);
  const helpers = await tx
    .select({ userId: schema.taskAssignees.userId })
    .from(schema.taskAssignees)
    .where(eq(schema.taskAssignees.taskId, completed.id));
  for (const h of helpers) if (!candidates.includes(h.userId)) candidates.push(h.userId);

  for (const candidateId of candidates) {
    const [candidate] = await tx.select().from(schema.user).where(eq(schema.user.id, candidateId));
    if (!candidate || candidate.banned) continue;
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
    if (overlap.length > 0) return { assigneeId: candidateId, route: "same_person" };
  }
  return { assigneeId: null, route: null };
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

  const { assigneeId, route } = await resolveNextAssignee(dbc, task, next);
  let assigneeName: string | null = null;
  if (assigneeId) {
    const [u] = await dbc.select().from(schema.user).where(eq(schema.user.id, assigneeId));
    assigneeName = u?.name ?? null;
  }
  let defaultDeadline = next.deadline;
  if (!defaultDeadline && next.stageId) {
    const [stage] = await dbc.select().from(schema.stages).where(eq(schema.stages.id, next.stageId));
    if (stage) defaultDeadline = addDaysISO(todayISO(env.TZ_BUSINESS), stage.defaultDurationDays);
  }
  return {
    kind: "handoff" as const,
    nextTaskId: next.id,
    nextTitle: next.title,
    route: route ?? ("unassigned" as const),
    assigneeId,
    assigneeName,
    defaultDeadline,
  };
}

/**
 * The handoff engine (PLAN.md §4.1). Runs INSIDE the caller's transaction,
 * immediately after a task's status was conditionally updated to 'done'.
 *
 * Assignment resolution order (deliberate refinement, PLAN.md §4.1 note):
 *   A. explicit pre-assignment on the successor (if that user is active)
 *   B. completer holds a qualifying skill → keeps the job
 *   C. unassigned queue + admin notification
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

  // --- resolve assignee (rules A/B shared with previewHandoff) --------------
  if (next.assigneeId) {
    const [pre] = await tx.select().from(schema.user).where(eq(schema.user.id, next.assigneeId));
    if (!pre || pre.banned) {
      await logActivity(tx, {
        actorId: null,
        entityType: "task",
        entityId: next.id,
        action: "assignment_cleared",
        detail: { reason: "assignee_inactive", previousAssignee: next.assigneeId },
      });
      next.assigneeId = null;
    }
  }
  const { assigneeId, route } = await resolveNextAssignee(tx, completed, next);

  // --- activate the successor ----------------------------------------------
  const today = todayISO(env.TZ_BUSINESS);
  let deadline = next.deadline; // never overwrite an explicitly set deadline
  let reminderRule = "none";
  if (next.stageId) {
    const [stage] = await tx.select().from(schema.stages).where(eq(schema.stages.id, next.stageId));
    if (stage) {
      reminderRule = stage.reminderRule;
      if (!deadline) deadline = addDaysISO(today, stage.defaultDurationDays);
    }
  }

  await tx
    .update(schema.tasks)
    .set({
      status: "todo",
      activatedAt: new Date(),
      startDate: today,
      deadline,
      assigneeId,
    })
    .where(eq(schema.tasks.id, next.id));
  if (assigneeId) {
    await tx
      .insert(schema.taskAssignees)
      .values({ taskId: next.id, userId: assigneeId })
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

  if (assigneeId) {
    await scheduleStageAutoReminder(
      tx,
      { id: next.id, assigneeId, deadline, title: next.title },
      reminderRule,
    );
    await notifyUser(tx, assigneeId, {
      type: "task_assigned",
      title: `New task: ${next.title} — ${projectTitle}`,
      body: deadline ? `Due ${deadline}` : undefined,
      entityType: "task",
      entityId: next.id,
    });
  } else {
    await notifyAdmins(
      tx,
      {
        type: "handoff_unassigned",
        title: `Unassigned: ${next.title} for ${projectTitle} needs a person`,
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
  await notifyAdmins(tx, {
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
    // untouched successor → revert to waiting; auto-set deadline is cleared,
    // an admin-set deadline survives (detected via the audit trail)
    const manualDeadline = await tx
      .select({ id: schema.activityLog.id })
      .from(schema.activityLog)
      .where(
        and(
          eq(schema.activityLog.entityType, "task"),
          eq(schema.activityLog.entityId, next.id),
          eq(schema.activityLog.action, "deadline_changed"),
          isNotNull(schema.activityLog.actorId),
        ),
      )
      .limit(1);
    await tx
      .update(schema.tasks)
      .set({
        status: "waiting",
        activatedAt: null,
        startDate: null,
        ...(manualDeadline.length === 0 ? { deadline: null } : {}),
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
  await notifyAdmins(tx, {
    type: "reopen_conflict",
    title: `Untangle: "${reopened.title}" reopened but "${next.title}" already started`,
    entityType: "task",
    entityId: next.id,
  });
}
