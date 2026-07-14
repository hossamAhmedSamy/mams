import { schema } from "@mams/db";
import { and, isNull, lte, sql } from "drizzle-orm";
import { db } from "../db";

/**
 * Idempotent job runner (PLAN.md §6). Called by BOTH the in-process 60s
 * ticker and the external cron's POST /jobs/tick — overlap-safe by
 * construction (FOR UPDATE SKIP LOCKED + job_runs markers).
 *
 * M0/M1 scope: fires due reminders as in-app notifications. Email delivery
 * and the daily digest/overdue sweep land in M4.
 */
export async function runDueJobs(): Promise<{ remindersFired: number }> {
  let remindersFired = 0;

  await db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(schema.reminders)
      .where(
        and(
          isNull(schema.reminders.firedAt),
          isNull(schema.reminders.canceledAt),
          lte(schema.reminders.fireAt, new Date()),
        ),
      )
      .orderBy(schema.reminders.fireAt)
      .limit(50)
      .for("update", { skipLocked: true });

    for (const reminder of due) {
      await tx.insert(schema.notifications).values({
        userId: reminder.targetUserId,
        type: "reminder_fired",
        title: "Reminder",
        body: reminder.message,
        entityType: reminder.taskId ? "task" : "project",
        entityId: reminder.taskId ?? reminder.projectId,
      });
      await tx
        .update(schema.reminders)
        .set({ firedAt: new Date() })
        .where(sql`${schema.reminders.id} = ${reminder.id}`);
      remindersFired += 1;
    }
  });

  return { remindersFired };
}

/** In-process ticker — runs while the service is warm. */
export function startTicker(logger: { error: (obj: unknown, msg: string) => void }) {
  const interval = setInterval(() => {
    runDueJobs().catch((err) => logger.error({ err }, "job tick failed"));
  }, 60_000);
  interval.unref();
  return interval;
}
