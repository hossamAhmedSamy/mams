import { schema } from "@mams/db";
import type { NotificationType } from "@mams/shared";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db";

type Tx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export type NotifyInput = {
  type: NotificationType;
  title: string;
  body?: string;
  entityType?: "task" | "project";
  entityId?: string;
};

/**
 * In-app notification rows (PLAN.md §9). Written in the same transaction as
 * the triggering mutation — the in-app row is the source of truth; email
 * delivery (M4) piggybacks on these.
 */
export async function notifyUser(tx: Tx, userId: string, n: NotifyInput) {
  await tx.insert(schema.notifications).values({
    userId,
    type: n.type,
    title: n.title,
    body: n.body ?? null,
    entityType: n.entityType ?? null,
    entityId: n.entityId ?? null,
  });
}

export async function notifyAdmins(tx: Tx, n: NotifyInput, exceptUserId?: string) {
  const admins = await tx
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(and(eq(schema.user.role, "admin"), eq(schema.user.banned, false)));
  for (const admin of admins) {
    if (admin.id === exceptUserId) continue; // no notifications for one's own actions
    await notifyUser(tx, admin.id, n);
  }
}
