import { schema } from "@mams/db";
import {
  can,
  isLegalTransition,
  taskLabel,
  type Checklist,
  type Permission,
  type TaskStatus,
} from "@mams/shared";
import { TRPCError } from "@trpc/server";
import { and, eq, gte, inArray, isNotNull, lt, notExists, sql } from "drizzle-orm";
import { db } from "../db";
import { env } from "../env";
import { addDaysISO, todayISO } from "../lib/time";
import { logActivity } from "./activity";
import { handleReopen, runHandoff } from "./handoff-engine";
import { notifyResponsible, notifyUser } from "./notify";
import { cancelAutoReminders, scheduleStageAutoReminder } from "./reminder-service";

const { tasks, projects, clients, stages, user, taskAssignees } = schema;

type Actor = {
  id: string;
  role: "admin" | "member";
  name: string;
  permissions: readonly Permission[];
};

function assertCan(actor: Actor, permission: Permission) {
  if (!can(actor, permission)) throw new TRPCError({ code: "FORBIDDEN" });
}

/** Is this person on the task? Assignees are equals — there is no owner. */
async function isOnTask(dbc: typeof db, taskId: string, userId: string) {
  const [row] = await dbc
    .select({ userId: taskAssignees.userId })
    .from(taskAssignees)
    .where(and(eq(taskAssignees.taskId, taskId), eq(taskAssignees.userId, userId)))
    .limit(1);
  return !!row;
}

async function assigneeIdsOf(dbc: typeof db, taskId: string): Promise<string[]> {
  const rows = await dbc
    .select({ userId: taskAssignees.userId })
    .from(taskAssignees)
    .where(eq(taskAssignees.taskId, taskId));
  return rows.map((r) => r.userId);
}

/** Everyone on each of these tasks, with names, in one round trip. */
async function assigneesFor(taskIds: string[]) {
  if (taskIds.length === 0) return [];
  return db
    .select({ taskId: taskAssignees.taskId, userId: taskAssignees.userId, name: user.name })
    .from(taskAssignees)
    .innerJoin(user, eq(taskAssignees.userId, user.id))
    .where(inArray(taskAssignees.taskId, taskIds))
    .orderBy(user.name);
}

type TaskRowBase = { id: string };

/** Attach the assignee list to task rows so no caller has to fan out itself. */
async function withAssignees<T extends TaskRowBase>(rows: T[]) {
  const links = await assigneesFor(rows.map((r) => r.id));
  return rows.map((row) => {
    const mine = links.filter((l) => l.taskId === row.id);
    return {
      ...row,
      assignees: mine.map((l) => ({ id: l.userId, name: l.name })),
      assigneeIds: mine.map((l) => l.userId),
    };
  });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const taskListSelect = {
  id: tasks.id,
  projectId: tasks.projectId,
  status: tasks.status,
  chainPosition: tasks.chainPosition,
  deadline: tasks.deadline,
  startDate: tasks.startDate,
  flagged: tasks.flagged,
  flagNote: tasks.flagNote,
  requiresApproval: tasks.requiresApproval,
  checklist: tasks.checklist,
  driveLink: tasks.driveLink,
  projectTitle: projects.title,
  clientName: clients.name,
  stageName: stages.name,
} as const;

function taskListQuery() {
  return db
    .select(taskListSelect)
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .leftJoin(stages, eq(tasks.stageId, stages.id));
}

/** Tasks this person is on. */
function onTaskOf(userId: string) {
  return sql`EXISTS (SELECT 1 FROM ${taskAssignees} ta WHERE ta.task_id = ${tasks.id} AND ta.user_id = ${userId})`;
}

/** My Work (PLAN.md §8.2): open tasks + the last 7 days of done. */
export async function myWork(userId: string) {
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const rows = await taskListQuery()
    .where(
      and(
        onTaskOf(userId),
        sql`(${tasks.status} IN ('todo','in_progress','awaiting_approval') OR (${tasks.status} = 'done' AND ${tasks.completedAt} >= ${weekAgo}))`,
      ),
    )
    .orderBy(sql`${tasks.deadline} ASC NULLS LAST`);
  return { today: todayISO(env.TZ_BUSINESS), tasks: await withAssignees(rows) };
}

/**
 * Calendar feed: open tasks overlapping [from, to] by their start→deadline
 * span (tasks without a deadline are excluded — nothing to place on a day).
 * Seeing the whole team is a permission (`team.viewAll`), not a role.
 */
export async function calendar(viewer: Actor, input: { from: string; to: string; userId?: string }) {
  const conds = [
    isNotNull(tasks.deadline),
    inArray(tasks.status, ["todo", "in_progress", "awaiting_approval"]),
    sql`COALESCE(${tasks.startDate}, ${tasks.deadline}) <= ${input.to}`,
    gte(tasks.deadline, input.from),
  ];
  const scopeUser = can(viewer, "team.viewAll") ? input.userId : viewer.id;
  if (scopeUser) conds.push(onTaskOf(scopeUser));
  const rows = await taskListQuery()
    .where(and(...conds))
    .orderBy(sql`${tasks.deadline} ASC`);
  return { today: todayISO(env.TZ_BUSINESS), tasks: await withAssignees(rows) };
}

export async function listTasks(filters: {
  projectId?: string;
  assigneeId?: string;
  stageId?: string;
  clientId?: string;
  status?: TaskStatus;
  overdue?: boolean;
  unassigned?: boolean;
  flagged?: boolean;
}) {
  const conds = [];
  if (filters.projectId) conds.push(eq(tasks.projectId, filters.projectId));
  if (filters.assigneeId) conds.push(onTaskOf(filters.assigneeId));
  if (filters.stageId) conds.push(eq(tasks.stageId, filters.stageId));
  if (filters.clientId) conds.push(eq(projects.clientId, filters.clientId));
  if (filters.status) conds.push(eq(tasks.status, filters.status));
  if (filters.flagged) conds.push(eq(tasks.flagged, true));
  if (filters.unassigned) {
    conds.push(
      and(
        notExists(
          db.select({ n: sql`1` }).from(taskAssignees).where(eq(taskAssignees.taskId, tasks.id)),
        ),
        inArray(tasks.status, ["todo", "in_progress"]),
      ),
    );
  }
  if (filters.overdue) {
    conds.push(
      and(
        lt(tasks.deadline, todayISO(env.TZ_BUSINESS)),
        inArray(tasks.status, ["todo", "in_progress", "awaiting_approval"]),
      ),
    );
  }
  const rows = await taskListQuery()
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(sql`${tasks.deadline} ASC NULLS LAST`)
    .limit(500);
  return withAssignees(rows);
}

export async function getTask(id: string) {
  const [row] = await taskListQuery().where(eq(tasks.id, id));
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  const [full] = await db.select().from(tasks).where(eq(tasks.id, id));
  const [withPeople] = await withAssignees([row]);
  return {
    ...withPeople!,
    details: full!.details,
    stageId: full!.stageId,
    createdAt: full!.createdAt,
    activatedAt: full!.activatedAt,
    completedAt: full!.completedAt,
  };
}

// ---------------------------------------------------------------------------
// Shared helpers for the mutations below
// ---------------------------------------------------------------------------

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The task's display name — its stage. */
async function labelOf(tx: Tx, task: { stageId: string | null }): Promise<string> {
  if (!task.stageId) return taskLabel(null);
  const [stage] = await tx.select().from(stages).where(eq(stages.id, task.stageId));
  return taskLabel(stage?.name ?? null);
}

async function reminderRuleOf(tx: Tx, stageId: string | null): Promise<string> {
  if (!stageId) return "none";
  const [stage] = await tx.select().from(stages).where(eq(stages.id, stageId));
  return stage?.reminderRule ?? "none";
}

async function assigneesInTx(tx: Tx, taskId: string): Promise<string[]> {
  const rows = await tx
    .select({ userId: taskAssignees.userId })
    .from(taskAssignees)
    .where(eq(taskAssignees.taskId, taskId));
  return rows.map((r) => r.userId);
}

// ---------------------------------------------------------------------------
// The single gate for status changes (PLAN.md §5.3)
// ---------------------------------------------------------------------------

export async function transition(taskId: string, to: TaskStatus, actor: Actor) {
  return db.transaction(async (tx) => {
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, taskId)).for("update");
    if (!task) throw new TRPCError({ code: "NOT_FOUND" });

    const from = task.status as TaskStatus;
    const label = await labelOf(tx, task);
    const canApprove = can(actor, "tasks.approve");
    const canManage = can(actor, "tasks.manage");
    let target = to;

    // "done" on an approval-gated task becomes an approval request unless the
    // person is allowed to approve
    if (target === "done" && task.requiresApproval && !canApprove && from === "in_progress") {
      target = "awaiting_approval";
    }

    // --- object-level authorization (PLAN.md §3) ---------------------------
    const onTask = await isOnTask(db, taskId, actor.id);
    if (from === "todo" && target === "waiting") {
      // system-only transition; nobody may request it
      throw new TRPCError({ code: "BAD_REQUEST", message: "Illegal transition" });
    }
    if (from === "waiting" && target === "todo") {
      if (!canManage) throw new TRPCError({ code: "FORBIDDEN" });
    } else if (from === "awaiting_approval" || (from === "done" && target === "in_progress")) {
      if (!canApprove) throw new TRPCError({ code: "FORBIDDEN" });
    } else if (!onTask && !canManage) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }

    if (!isLegalTransition(from, target)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Illegal transition ${from} → ${target}` });
    }

    // --- apply -------------------------------------------------------------
    if (target === "done") {
      // conditional update guards the concurrent double-complete race
      const [updated] = await tx
        .update(tasks)
        .set({ status: "done", completedAt: new Date() })
        .where(and(eq(tasks.id, taskId), inArray(tasks.status, ["in_progress", "awaiting_approval"])))
        .returning();
      if (!updated) throw new TRPCError({ code: "CONFLICT", message: "Task already completed" });
      await logActivity(tx, {
        actorId: actor.id,
        entityType: "task",
        entityId: taskId,
        action: "status_changed",
        detail: { from, to: "done" },
      });
      await cancelAutoReminders(tx, taskId);
      await notifyResponsible(
        tx,
        "tasks.manage",
        {
          type: "stage_completed",
          title: `${actor.name} finished "${label}"`,
          entityType: "task",
          entityId: taskId,
        },
        actor.id,
      );
      await runHandoff(tx, { ...task, status: "done" }, actor.id);
      return { status: "done" as const };
    }

    if (from === "waiting" && target === "todo") {
      // manual activation — same activation semantics as a handoff
      const today = todayISO(env.TZ_BUSINESS);
      let deadline = task.deadline;
      if (!deadline && task.stageId) {
        const [stage] = await tx.select().from(stages).where(eq(stages.id, task.stageId));
        if (stage) deadline = addDaysISO(task.startDate ?? today, stage.defaultDurationDays);
      }
      await tx
        .update(tasks)
        .set({
          status: "todo",
          activatedAt: new Date(),
          startDate: task.startDate ?? today,
          deadline,
        })
        .where(eq(tasks.id, taskId));
      await scheduleStageAutoReminder(
        tx,
        { id: taskId, assigneeIds: await assigneesInTx(tx, taskId), deadline, label },
        await reminderRuleOf(tx, task.stageId),
      );
    } else if (from === "done" && target === "in_progress") {
      await tx
        .update(tasks)
        .set({ status: "in_progress", completedAt: null })
        .where(eq(tasks.id, taskId));
      await handleReopen(tx, task, actor.id);
    } else if (from === "awaiting_approval" && target === "in_progress") {
      // rejection → back to work, flagged
      await tx
        .update(tasks)
        .set({ status: "in_progress", flagged: true })
        .where(eq(tasks.id, taskId));
      for (const userId of await assigneesInTx(tx, taskId)) {
        if (userId === actor.id) continue;
        await notifyUser(tx, userId, {
          type: "task_flagged",
          title: `Changes requested: "${label}"`,
          entityType: "task",
          entityId: taskId,
        });
      }
    } else {
      await tx.update(tasks).set({ status: target }).where(eq(tasks.id, taskId));
      if (target === "awaiting_approval") {
        await notifyResponsible(
          tx,
          "tasks.approve",
          {
            type: "approval_requested",
            title: `Awaiting approval: "${label}"`,
            entityType: "task",
            entityId: taskId,
          },
          actor.id,
        );
      }
    }

    await logActivity(tx, {
      actorId: actor.id,
      entityType: "task",
      entityId: taskId,
      action: "status_changed",
      detail: { from, to: target },
    });
    return { status: target };
  });
}

// ---------------------------------------------------------------------------
// Managing mutations (each gated on its own permission)
// ---------------------------------------------------------------------------

export async function createAdhocTask(
  actor: Actor,
  input: {
    projectId: string;
    stageId?: string;
    details?: string;
    assigneeIds?: string[];
    startDate?: string;
    deadline?: string;
    driveLink?: string;
  },
) {
  assertCan(actor, "tasks.manage");
  return db.transaction(async (tx) => {
    const today = todayISO(env.TZ_BUSINESS);
    const [row] = await tx
      .insert(tasks)
      .values({
        projectId: input.projectId,
        stageId: input.stageId ?? null,
        details: input.details ?? null,
        startDate: input.startDate ?? today,
        deadline: input.deadline ?? null,
        driveLink: input.driveLink ?? null,
        status: "todo",
        activatedAt: new Date(),
        createdBy: actor.id,
      })
      .returning();
    const assigneeIds = await replaceAssignees(tx, row!.id, input.assigneeIds ?? []);
    const label = await labelOf(tx, row!);
    await logActivity(tx, {
      actorId: actor.id,
      entityType: "task",
      entityId: row!.id,
      action: "created",
      detail: { adhoc: true, label },
    });
    for (const userId of assigneeIds) {
      if (userId === actor.id) continue;
      await notifyUser(tx, userId, {
        type: "task_assigned",
        title: `New task: ${label}`,
        body: row!.deadline ? `Due ${row!.deadline}` : undefined,
        entityType: "task",
        entityId: row!.id,
      });
    }
    await scheduleStageAutoReminder(
      tx,
      { id: row!.id, assigneeIds, deadline: row!.deadline, label },
      await reminderRuleOf(tx, row!.stageId),
    );
    return row!;
  });
}

/** Set the exact set of people on a task; returns the validated set. */
async function replaceAssignees(tx: Tx, taskId: string, userIds: string[]): Promise<string[]> {
  const wanted = [...new Set(userIds)];
  if (wanted.length > 0) {
    const active = await tx
      .select({ id: user.id })
      .from(user)
      .where(and(inArray(user.id, wanted), eq(user.banned, false)));
    if (active.length !== wanted.length) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Everyone assigned must be an active user" });
    }
  }
  await tx.delete(taskAssignees).where(eq(taskAssignees.taskId, taskId));
  if (wanted.length > 0) {
    await tx
      .insert(taskAssignees)
      .values(wanted.map((userId) => ({ taskId, userId })))
      .onConflictDoNothing();
  }
  return wanted;
}

/**
 * Replace the people on a task. Everyone listed is an equal assignee — there
 * is no owner, so this one call covers what assign()/setHelpers() used to do.
 */
export async function setAssignees(actor: Actor, input: { id: string; userIds: string[] }) {
  assertCan(actor, "tasks.assign");
  return db.transaction(async (tx) => {
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, input.id)).for("update");
    if (!task) throw new TRPCError({ code: "NOT_FOUND" });
    const before = await assigneesInTx(tx, input.id);
    const after = await replaceAssignees(tx, input.id, input.userIds);
    const label = await labelOf(tx, task);

    await logActivity(tx, {
      actorId: actor.id,
      entityType: "task",
      entityId: input.id,
      action: "assignees_changed",
      detail: { from: before, to: after },
    });

    if (task.status !== "waiting") {
      for (const userId of after) {
        if (before.includes(userId) || userId === actor.id) continue;
        await notifyUser(tx, userId, {
          type: "task_assigned",
          title: `New task: ${label}`,
          body: task.deadline ? `Due ${task.deadline}` : undefined,
          entityType: "task",
          entityId: input.id,
        });
      }
      await scheduleStageAutoReminder(
        tx,
        { id: input.id, assigneeIds: after, deadline: task.deadline, label },
        await reminderRuleOf(tx, task.stageId),
      );
    }
  });
}

/**
 * Start date + deadline in one call — the two ends of the same span, so they
 * are never edited independently into an impossible order.
 */
export async function setSchedule(
  actor: Actor,
  input: { id: string; startDate?: string | null; deadline?: string | null },
) {
  assertCan(actor, "tasks.manage");
  return db.transaction(async (tx) => {
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, input.id)).for("update");
    if (!task) throw new TRPCError({ code: "NOT_FOUND" });
    const startDate = input.startDate === undefined ? task.startDate : input.startDate;
    const deadline = input.deadline === undefined ? task.deadline : input.deadline;
    if (startDate && deadline && startDate > deadline) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Start date must be on or before the deadline" });
    }
    await tx.update(tasks).set({ startDate, deadline }).where(eq(tasks.id, input.id));
    await logActivity(tx, {
      actorId: actor.id,
      entityType: "task",
      entityId: input.id,
      action: "schedule_changed",
      detail: {
        from: { startDate: task.startDate, deadline: task.deadline },
        to: { startDate, deadline },
      },
    });
    if (task.status !== "waiting" && task.status !== "done") {
      if (!deadline) {
        await cancelAutoReminders(tx, input.id);
      } else {
        await scheduleStageAutoReminder(
          tx,
          {
            id: input.id,
            assigneeIds: await assigneesInTx(tx, input.id),
            deadline,
            label: await labelOf(tx, task),
          },
          await reminderRuleOf(tx, task.stageId),
        );
      }
    }
  });
}

export async function setFlag(actor: Actor, input: { id: string; flagged: boolean; note?: string }) {
  assertCan(actor, "tasks.manage");
  return db.transaction(async (tx) => {
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, input.id)).for("update");
    if (!task) throw new TRPCError({ code: "NOT_FOUND" });
    await tx
      .update(tasks)
      .set({ flagged: input.flagged, flagNote: input.flagged ? (input.note ?? null) : null })
      .where(eq(tasks.id, input.id));
    await logActivity(tx, {
      actorId: actor.id,
      entityType: "task",
      entityId: input.id,
      action: input.flagged ? "flagged" : "unflagged",
      detail: { note: input.note },
    });
    if (!input.flagged) return;
    const label = await labelOf(tx, task);
    for (const userId of await assigneesInTx(tx, input.id)) {
      if (userId === actor.id) continue;
      await notifyUser(tx, userId, {
        type: "task_flagged",
        title: `⚑ Needs attention: "${label}"`,
        body: input.note,
        entityType: "task",
        entityId: input.id,
      });
    }
  });
}

export async function updateDetails(
  actor: Actor,
  input: { id: string; stageId?: string | null; details?: string | null },
) {
  assertCan(actor, "tasks.manage");
  return db.transaction(async (tx) => {
    await tx
      .update(tasks)
      .set({
        ...(input.stageId !== undefined ? { stageId: input.stageId } : {}),
        ...(input.details !== undefined ? { details: input.details } : {}),
      })
      .where(eq(tasks.id, input.id));
    await logActivity(tx, {
      actorId: actor.id,
      entityType: "task",
      entityId: input.id,
      action: "updated",
    });
  });
}

export async function deleteTask(actor: Actor, id: string) {
  assertCan(actor, "tasks.manage");
  return db.transaction(async (tx) => {
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, id)).for("update");
    if (!task) throw new TRPCError({ code: "NOT_FOUND" });
    if (task.chainPosition !== null) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Chain tasks cannot be deleted — archive the project instead",
      });
    }
    const label = await labelOf(tx, task);
    await tx.delete(tasks).where(eq(tasks.id, id));
    await logActivity(tx, {
      actorId: actor.id,
      entityType: "task",
      entityId: id,
      action: "deleted",
      detail: { label },
    });
  });
}

// ---------------------------------------------------------------------------
// Assignee-or-manager mutations (object-level check)
// ---------------------------------------------------------------------------

async function assertCanTouch(taskId: string, actor: Actor) {
  if (can(actor, "tasks.manage")) return;
  if (await isOnTask(db, taskId, actor.id)) return;
  throw new TRPCError({ code: "FORBIDDEN" });
}

export async function updateChecklist(actor: Actor, input: { id: string; checklist: Checklist }) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, input.id));
  if (!task) throw new TRPCError({ code: "NOT_FOUND" });
  await assertCanTouch(input.id, actor);
  await db.update(tasks).set({ checklist: input.checklist }).where(eq(tasks.id, input.id));
}

export async function setDriveLink(actor: Actor, input: { id: string; driveLink: string | null }) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, input.id));
  if (!task) throw new TRPCError({ code: "NOT_FOUND" });
  await assertCanTouch(input.id, actor);
  await db.update(tasks).set({ driveLink: input.driveLink }).where(eq(tasks.id, input.id));
  await logActivity(db, {
    actorId: actor.id,
    entityType: "task",
    entityId: input.id,
    action: "drive_link_set",
  });
}

export { assigneeIdsOf };
