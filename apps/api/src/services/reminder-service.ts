import { schema } from "@mams/db";
import { and, eq, isNull, notInArray } from "drizzle-orm";
import type { Db } from "../db";
import { env } from "../env";
import { zonedTimeToUtc } from "../lib/time";

type Tx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/** One reminder row per person on the task — everyone assigned gets nudged. */
const stageDedupeKey = (taskId: string, userId: string) =>
  `task:${taskId}:stage-default:${userId}`;

/**
 * Per-stage auto reminder (PLAN.md §6.2). Only rule in v1: `end_of_last_day` —
 * fires at REMINDER_EOD_HOUR (18:00 Cairo) on the task's deadline day.
 * Upserts on dedupe_key so activation/deadline/assignee changes never
 * duplicate, and drops the rows of anyone taken off the task.
 */
export async function scheduleStageAutoReminder(
  tx: Tx,
  task: { id: string; assigneeIds: string[]; deadline: string | null; label: string },
  reminderRule: string,
) {
  await cancelAutoRemindersExcept(tx, task.id, task.assigneeIds);
  if (reminderRule !== "end_of_last_day" || task.assigneeIds.length === 0 || !task.deadline) return;
  const fireAt = zonedTimeToUtc(task.deadline, env.REMINDER_EOD_HOUR, env.TZ_BUSINESS);
  if (fireAt.getTime() <= Date.now()) return; // deadline already past — overdue sweep owns it
  for (const userId of task.assigneeIds) {
    await tx
      .insert(schema.reminders)
      .values({
        taskId: task.id,
        targetUserId: userId,
        fireAt,
        message: `"${task.label}" — today is the last day. Wrap up and mark it done.`,
        source: "auto",
        dedupeKey: stageDedupeKey(task.id, userId),
      })
      .onConflictDoUpdate({
        target: schema.reminders.dedupeKey,
        set: { fireAt, targetUserId: userId, firedAt: null, canceledAt: null },
      });
  }
}

/** Someone left the task → their pending nudge is no longer theirs to get. */
async function cancelAutoRemindersExcept(tx: Tx, taskId: string, keepUserIds: string[]) {
  const stillPending = and(
    eq(schema.reminders.taskId, taskId),
    eq(schema.reminders.source, "auto"),
    isNull(schema.reminders.firedAt),
    isNull(schema.reminders.canceledAt),
  );
  await tx
    .update(schema.reminders)
    .set({ canceledAt: new Date() })
    .where(
      keepUserIds.length === 0
        ? stillPending
        : and(stillPending, notInArray(schema.reminders.targetUserId, keepUserIds)),
    );
}

/** Cancel unfired auto reminders when a task completes or reverts to waiting. */
export async function cancelAutoReminders(tx: Tx, taskId: string) {
  await tx
    .update(schema.reminders)
    .set({ canceledAt: new Date() })
    .where(
      and(
        eq(schema.reminders.taskId, taskId),
        eq(schema.reminders.source, "auto"),
        isNull(schema.reminders.firedAt),
        isNull(schema.reminders.canceledAt),
      ),
    );
}
