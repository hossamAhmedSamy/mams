import { schema } from "@mams/db";
import { isLegalTransition, type Checklist, type TaskStatus } from "@mams/shared";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { env } from "../env";
import { addDaysISO, todayISO } from "../lib/time";
import { logActivity } from "./activity";
import { handleReopen, runHandoff } from "./handoff-engine";
import { notifyAdmins, notifyUser } from "./notify";
import {
  cancelAutoReminders,
  retargetAutoReminders,
  scheduleStageAutoReminder,
} from "./reminder-service";

const { tasks, projects, clients, stages, user, taskAssignees } = schema;

type Actor = { id: string; role: "admin" | "member"; name: string };

/** Owner or helper? (tasks.assignee_id is always mirrored into task_assignees) */
async function isOnTask(dbc: typeof db, taskId: string, userId: string) {
  const [row] = await dbc
    .select({ userId: taskAssignees.userId })
    .from(taskAssignees)
    .where(and(eq(taskAssignees.taskId, taskId), eq(taskAssignees.userId, userId)))
    .limit(1);
  return !!row;
}

/** Helpers (non-owner assignees) with names, for a set of tasks. */
async function helpersFor(taskIds: string[]) {
  if (taskIds.length === 0) return [];
  return db
    .select({
      taskId: taskAssignees.taskId,
      userId: taskAssignees.userId,
      name: user.name,
    })
    .from(taskAssignees)
    .innerJoin(user, eq(taskAssignees.userId, user.id))
    .where(inArray(taskAssignees.taskId, taskIds));
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const taskListSelect = {
  id: tasks.id,
  projectId: tasks.projectId,
  title: tasks.title,
  status: tasks.status,
  chainPosition: tasks.chainPosition,
  deadline: tasks.deadline,
  startDate: tasks.startDate,
  flagged: tasks.flagged,
  flagNote: tasks.flagNote,
  requiresApproval: tasks.requiresApproval,
  assigneeId: tasks.assigneeId,
  checklist: tasks.checklist,
  driveLink: tasks.driveLink,
  projectTitle: projects.title,
  clientName: clients.name,
  stageName: stages.name,
  assigneeName: user.name,
} as const;

function taskListQuery() {
  return db
    .select(taskListSelect)
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .leftJoin(stages, eq(tasks.stageId, stages.id))
    .leftJoin(user, eq(tasks.assigneeId, user.id));
}

/** My Work (PLAN.md §8.2): open tasks + last 7 days of done — owner OR helper. */
export async function myWork(userId: string) {
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const rows = await taskListQuery()
    .innerJoin(
      taskAssignees,
      and(eq(taskAssignees.taskId, tasks.id), eq(taskAssignees.userId, userId)),
    )
    .where(
      sql`(${tasks.status} IN ('todo','in_progress','awaiting_approval') OR (${tasks.status} = 'done' AND ${tasks.completedAt} >= ${weekAgo}))`,
    )
    .orderBy(sql`${tasks.deadline} ASC NULLS LAST`);
  return { today: todayISO(env.TZ_BUSINESS), tasks: rows };
}

/**
 * Calendar feed: open tasks overlapping [from, to] by their start→deadline
 * span (tasks without a deadline are excluded — nothing to place on a day).
 * Members see their own; admin sees everyone (optionally one person).
 */
export async function calendar(viewer: Actor, input: { from: string; to: string; userId?: string }) {
  const conds = [
    isNotNull(tasks.deadline),
    inArray(tasks.status, ["todo", "in_progress", "awaiting_approval"]),
    sql`COALESCE(${tasks.startDate}, ${tasks.deadline}) <= ${input.to}`,
    gte(tasks.deadline, input.from),
  ];
  const scopeUser = viewer.role === "admin" ? input.userId : viewer.id;
  let query = taskListQuery();
  if (scopeUser) {
    query = query.innerJoin(
      taskAssignees,
      and(eq(taskAssignees.taskId, tasks.id), eq(taskAssignees.userId, scopeUser)),
    ) as typeof query;
  }
  const rows = await query.where(and(...conds)).orderBy(sql`${tasks.deadline} ASC`);
  return { today: todayISO(env.TZ_BUSINESS), tasks: rows };
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
  if (filters.assigneeId) conds.push(eq(tasks.assigneeId, filters.assigneeId));
  if (filters.stageId) conds.push(eq(tasks.stageId, filters.stageId));
  if (filters.clientId) conds.push(eq(projects.clientId, filters.clientId));
  if (filters.status) conds.push(eq(tasks.status, filters.status));
  if (filters.flagged) conds.push(eq(tasks.flagged, true));
  if (filters.unassigned)
    conds.push(and(isNull(tasks.assigneeId), inArray(tasks.status, ["todo", "in_progress"])));
  if (filters.overdue) {
    conds.push(
      and(
        lt(tasks.deadline, todayISO(env.TZ_BUSINESS)),
        inArray(tasks.status, ["todo", "in_progress", "awaiting_approval"]),
      ),
    );
  }
  return taskListQuery()
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(sql`${tasks.deadline} ASC NULLS LAST`)
    .limit(500);
}

export async function getTask(id: string) {
  const [row] = await taskListQuery().where(eq(tasks.id, id));
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  const [full] = await db.select().from(tasks).where(eq(tasks.id, id));
  const helpers = (await helpersFor([id])).filter((h) => h.userId !== row.assigneeId);
  return {
    ...row,
    details: full!.details,
    createdAt: full!.createdAt,
    activatedAt: full!.activatedAt,
    completedAt: full!.completedAt,
    helpers: helpers.map((h) => ({ id: h.userId, name: h.name })),
  };
}

// ---------------------------------------------------------------------------
// The single gate for status changes (PLAN.md §5.3)
// ---------------------------------------------------------------------------

export async function transition(taskId: string, to: TaskStatus, actor: Actor) {
  return db.transaction(async (tx) => {
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, taskId)).for("update");
    if (!task) throw new TRPCError({ code: "NOT_FOUND" });

    const from = task.status as TaskStatus;
    let target = to;

    // member "done" on an approval-gated task becomes an approval request
    if (
      target === "done" &&
      task.requiresApproval &&
      actor.role !== "admin" &&
      from === "in_progress"
    ) {
      target = "awaiting_approval";
    }

    // --- object-level authorization (PLAN.md §3) ---------------------------
    if (actor.role !== "admin") {
      const onTask = task.assigneeId === actor.id || (await isOnTask(db, taskId, actor.id));
      const memberAllowed =
        onTask &&
        ((from === "todo" && target === "in_progress") ||
          (from === "in_progress" && (target === "done" || target === "awaiting_approval")));
      if (!memberAllowed) throw new TRPCError({ code: "FORBIDDEN" });
    } else if (from === "todo" && target === "waiting") {
      // system-only transition; not even the admin may request it
      throw new TRPCError({ code: "BAD_REQUEST", message: "Illegal transition" });
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
      await notifyAdmins(
        tx,
        {
          type: "stage_completed",
          title: `${actor.name} finished "${task.title}"`,
          entityType: "task",
          entityId: taskId,
        },
        actor.id,
      );
      await runHandoff(tx, { ...task, status: "done" }, actor.id);
      return { status: "done" as const };
    }

    if (from === "waiting" && target === "todo") {
      // manual activation by admin — same activation semantics as a handoff
      const today = todayISO(env.TZ_BUSINESS);
      let deadline = task.deadline;
      let reminderRule = "none";
      if (task.stageId) {
        const [stage] = await tx.select().from(stages).where(eq(stages.id, task.stageId));
        if (stage) {
          reminderRule = stage.reminderRule;
          if (!deadline) deadline = addDaysISO(today, stage.defaultDurationDays);
        }
      }
      await tx
        .update(tasks)
        .set({ status: "todo", activatedAt: new Date(), startDate: today, deadline })
        .where(eq(tasks.id, taskId));
      if (task.assigneeId) {
        await scheduleStageAutoReminder(
          tx,
          { id: taskId, assigneeId: task.assigneeId, deadline, title: task.title },
          reminderRule,
        );
      }
    } else if (from === "done" && target === "in_progress") {
      await tx
        .update(tasks)
        .set({ status: "in_progress", completedAt: null })
        .where(eq(tasks.id, taskId));
      await handleReopen(tx, task, actor.id);
    } else if (from === "awaiting_approval" && target === "in_progress") {
      // admin rejection → back to work, flagged
      await tx
        .update(tasks)
        .set({ status: "in_progress", flagged: true })
        .where(eq(tasks.id, taskId));
      if (task.assigneeId) {
        await notifyUser(tx, task.assigneeId, {
          type: "task_flagged",
          title: `Changes requested: "${task.title}"`,
          entityType: "task",
          entityId: taskId,
        });
      }
    } else {
      await tx.update(tasks).set({ status: target }).where(eq(tasks.id, taskId));
      if (target === "awaiting_approval") {
        await notifyAdmins(
          tx,
          {
            type: "approval_requested",
            title: `Awaiting approval: "${task.title}"`,
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
// Admin mutations
// ---------------------------------------------------------------------------

export async function createAdhocTask(
  actor: Actor,
  input: {
    projectId: string;
    title: string;
    details?: string;
    assigneeId?: string;
    deadline?: string;
    driveLink?: string;
  },
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(tasks)
      .values({
        projectId: input.projectId,
        title: input.title,
        details: input.details ?? null,
        assigneeId: input.assigneeId ?? null,
        deadline: input.deadline ?? null,
        driveLink: input.driveLink ?? null,
        status: "todo",
        activatedAt: new Date(),
        startDate: todayISO(env.TZ_BUSINESS),
        createdBy: actor.id,
      })
      .returning();
    if (input.assigneeId) {
      await tx
        .insert(taskAssignees)
        .values({ taskId: row!.id, userId: input.assigneeId })
        .onConflictDoNothing();
    }
    await logActivity(tx, {
      actorId: actor.id,
      entityType: "task",
      entityId: row!.id,
      action: "created",
      detail: { adhoc: true },
    });
    if (input.assigneeId) {
      await notifyUser(tx, input.assigneeId, {
        type: "task_assigned",
        title: `New task: ${input.title}`,
        body: input.deadline ? `Due ${input.deadline}` : undefined,
        entityType: "task",
        entityId: row!.id,
      });
    }
    return row!;
  });
}

export async function assign(actor: Actor, input: { id: string; assigneeId: string | null }) {
  return db.transaction(async (tx) => {
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, input.id)).for("update");
    if (!task) throw new TRPCError({ code: "NOT_FOUND" });
    if (input.assigneeId) {
      const [assignee] = await tx.select().from(user).where(eq(user.id, input.assigneeId));
      if (!assignee || assignee.banned) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Assignee is not an active user" });
      }
    }
    await tx.update(tasks).set({ assigneeId: input.assigneeId }).where(eq(tasks.id, input.id));
    // keep task_assignees mirrored: old owner off (helpers stay), new owner on
    if (task.assigneeId && task.assigneeId !== input.assigneeId) {
      await tx
        .delete(taskAssignees)
        .where(and(eq(taskAssignees.taskId, input.id), eq(taskAssignees.userId, task.assigneeId)));
    }
    if (input.assigneeId) {
      await tx
        .insert(taskAssignees)
        .values({ taskId: input.id, userId: input.assigneeId })
        .onConflictDoNothing();
    }
    await logActivity(tx, {
      actorId: actor.id,
      entityType: "task",
      entityId: input.id,
      action: "assigned",
      detail: { from: task.assigneeId, to: input.assigneeId },
    });
    if (input.assigneeId && task.status !== "waiting") {
      await retargetAutoReminders(tx, input.id, input.assigneeId);
      if (input.assigneeId !== actor.id) {
        await notifyUser(tx, input.assigneeId, {
          type: "task_assigned",
          title: `New task: ${task.title}`,
          body: task.deadline ? `Due ${task.deadline}` : undefined,
          entityType: "task",
          entityId: input.id,
        });
      }
      // activation may have skipped scheduling (no assignee then) — ensure it now
      if (task.stageId && task.deadline) {
        const [stage] = await tx.select().from(stages).where(eq(stages.id, task.stageId));
        if (stage) {
          await scheduleStageAutoReminder(
            tx,
            { id: input.id, assigneeId: input.assigneeId, deadline: task.deadline, title: task.title },
            stage.reminderRule,
          );
        }
      }
    }
  });
}

/** Replace the helper set (owner is managed by assign(), never touched here). */
export async function setHelpers(actor: Actor, input: { id: string; userIds: string[] }) {
  return db.transaction(async (tx) => {
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, input.id)).for("update");
    if (!task) throw new TRPCError({ code: "NOT_FOUND" });
    const helperIds = [...new Set(input.userIds)].filter((id) => id !== task.assigneeId);
    if (helperIds.length > 0) {
      const activeUsers = await tx
        .select({ id: user.id })
        .from(user)
        .where(and(inArray(user.id, helperIds), eq(user.banned, false)));
      if (activeUsers.length !== helperIds.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "All helpers must be active users" });
      }
    }
    const existing = await tx
      .select({ userId: taskAssignees.userId })
      .from(taskAssignees)
      .where(eq(taskAssignees.taskId, input.id));
    const keep = new Set([...(task.assigneeId ? [task.assigneeId] : []), ...helperIds]);
    const toRemove = existing.map((e) => e.userId).filter((id) => !keep.has(id));
    const existingSet = new Set(existing.map((e) => e.userId));
    const toAdd = helperIds.filter((id) => !existingSet.has(id));

    if (toRemove.length > 0) {
      await tx
        .delete(taskAssignees)
        .where(and(eq(taskAssignees.taskId, input.id), inArray(taskAssignees.userId, toRemove)));
    }
    if (toAdd.length > 0) {
      await tx
        .insert(taskAssignees)
        .values(toAdd.map((userId) => ({ taskId: input.id, userId })))
        .onConflictDoNothing();
    }
    await logActivity(tx, {
      actorId: actor.id,
      entityType: "task",
      entityId: input.id,
      action: "helpers_changed",
      detail: { helpers: helperIds },
    });
    for (const userId of toAdd) {
      if (userId !== actor.id && task.status !== "waiting") {
        await notifyUser(tx, userId, {
          type: "task_assigned",
          title: `You were added to: ${task.title}`,
          body: task.deadline ? `Due ${task.deadline}` : undefined,
          entityType: "task",
          entityId: input.id,
        });
      }
    }
  });
}

export async function setDeadline(actor: Actor, input: { id: string; deadline: string | null }) {
  return db.transaction(async (tx) => {
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, input.id)).for("update");
    if (!task) throw new TRPCError({ code: "NOT_FOUND" });
    await tx.update(tasks).set({ deadline: input.deadline }).where(eq(tasks.id, input.id));
    await logActivity(tx, {
      actorId: actor.id,
      entityType: "task",
      entityId: input.id,
      action: "deadline_changed",
      detail: { from: task.deadline, to: input.deadline },
    });
    if (task.status !== "waiting" && task.status !== "done") {
      if (!input.deadline) {
        await cancelAutoReminders(tx, input.id);
      } else if (task.stageId && task.assigneeId) {
        const [stage] = await tx.select().from(stages).where(eq(stages.id, task.stageId));
        if (stage) {
          await scheduleStageAutoReminder(
            tx,
            { id: input.id, assigneeId: task.assigneeId, deadline: input.deadline, title: task.title },
            stage.reminderRule,
          );
        }
      }
    }
  });
}

export async function setFlag(actor: Actor, input: { id: string; flagged: boolean; note?: string }) {
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
    if (input.flagged && task.assigneeId && task.assigneeId !== actor.id) {
      await notifyUser(tx, task.assigneeId, {
        type: "task_flagged",
        title: `⚑ Needs attention: "${task.title}"`,
        body: input.note,
        entityType: "task",
        entityId: input.id,
      });
    }
  });
}

export async function updateDetails(
  actor: Actor,
  input: { id: string; title?: string; details?: string | null },
) {
  return db.transaction(async (tx) => {
    await tx
      .update(tasks)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
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
  return db.transaction(async (tx) => {
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, id)).for("update");
    if (!task) throw new TRPCError({ code: "NOT_FOUND" });
    if (task.chainPosition !== null) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Chain tasks cannot be deleted — archive the project instead",
      });
    }
    await tx.delete(tasks).where(eq(tasks.id, id));
    await logActivity(tx, {
      actorId: actor.id,
      entityType: "task",
      entityId: id,
      action: "deleted",
      detail: { title: task.title },
    });
  });
}

// ---------------------------------------------------------------------------
// Assignee-or-admin mutations (object-level check)
// ---------------------------------------------------------------------------

async function assertCanTouch(taskId: string, task: { assigneeId: string | null }, actor: Actor) {
  if (actor.role === "admin" || task.assigneeId === actor.id) return;
  if (await isOnTask(db, taskId, actor.id)) return;
  throw new TRPCError({ code: "FORBIDDEN" });
}

export async function updateChecklist(actor: Actor, input: { id: string; checklist: Checklist }) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, input.id));
  if (!task) throw new TRPCError({ code: "NOT_FOUND" });
  await assertCanTouch(input.id, task, actor);
  await db.update(tasks).set({ checklist: input.checklist }).where(eq(tasks.id, input.id));
}

export async function setDriveLink(actor: Actor, input: { id: string; driveLink: string | null }) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, input.id));
  if (!task) throw new TRPCError({ code: "NOT_FOUND" });
  await assertCanTouch(input.id, task, actor);
  await db.update(tasks).set({ driveLink: input.driveLink }).where(eq(tasks.id, input.id));
  await logActivity(db, {
    actorId: actor.id,
    entityType: "task",
    entityId: input.id,
    action: "drive_link_set",
  });
}
