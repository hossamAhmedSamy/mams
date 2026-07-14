import { schema } from "@mams/db";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db";
import { env } from "../env";
import { zonedTimeToUtc } from "../lib/time";

type Tx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

const stageDedupeKey = (taskId: string) => `task:${taskId}:stage-default`;

/**
 * Per-stage auto reminder (PLAN.md §6.2). Only rule in v1: `end_of_last_day` —
 * fires at REMINDER_EOD_HOUR (18:00 Cairo) on the task's deadline day.
 * Upserts on dedupe_key so activation/deadline changes never duplicate.
 */
export async function scheduleStageAutoReminder(
  tx: Tx,
  task: { id: string; assigneeId: string | null; deadline: string | null; title: string },
  reminderRule: string,
) {
  if (reminderRule !== "end_of_last_day" || !task.assigneeId || !task.deadline) return;
  const fireAt = zonedTimeToUtc(task.deadline, env.REMINDER_EOD_HOUR, env.TZ_BUSINESS);
  if (fireAt.getTime() <= Date.now()) return; // deadline already past — overdue sweep owns it
  await tx
    .insert(schema.reminders)
    .values({
      taskId: task.id,
      targetUserId: task.assigneeId,
      fireAt,
      message: `"${task.title}" — today is the last day. Wrap up and mark it done.`,
      source: "auto",
      dedupeKey: stageDedupeKey(task.id),
    })
    .onConflictDoUpdate({
      target: schema.reminders.dedupeKey,
      set: { fireAt, targetUserId: task.assigneeId, firedAt: null, canceledAt: null },
    });
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

/** Retarget unfired auto reminders when a task is reassigned. */
export async function retargetAutoReminders(tx: Tx, taskId: string, newAssigneeId: string) {
  await tx
    .update(schema.reminders)
    .set({ targetUserId: newAssigneeId })
    .where(
      and(
        eq(schema.reminders.taskId, taskId),
        eq(schema.reminders.source, "auto"),
        isNull(schema.reminders.firedAt),
        isNull(schema.reminders.canceledAt),
      ),
    );
}
