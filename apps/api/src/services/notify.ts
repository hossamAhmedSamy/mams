import { schema } from "@mams/db";
import type { NotificationType, Permission } from "@mams/shared";
import { and, eq, exists, or, sql } from "drizzle-orm";
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

/**
 * Notify whoever is responsible for this kind of thing: every admin, plus the
 * members explicitly granted the permission. Replaces "notify the admins" now
 * that authority is per user rather than per role.
 */
export async function notifyResponsible(
  tx: Tx,
  permission: Permission,
  n: NotifyInput,
  exceptUserId?: string,
) {
  const recipients = await tx
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(
      and(
        eq(schema.user.banned, false),
        or(
          eq(schema.user.role, "admin"),
          exists(
            tx
              .select({ n: sql`1` })
              .from(schema.userPermissions)
              .where(
                and(
                  eq(schema.userPermissions.userId, schema.user.id),
                  eq(schema.userPermissions.permission, permission),
                ),
              ),
          ),
        ),
      ),
    );
  for (const person of recipients) {
    if (person.id === exceptUserId) continue; // no notifications for one's own actions
    await notifyUser(tx, person.id, n);
  }
}
