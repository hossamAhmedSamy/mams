import { schema } from "@mams/db";
import type { Db } from "../db";

type Tx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Append-only audit trail (PLAN.md §2.1). Call inside the same transaction as
 * the mutation it records. actorId null = the system (handoff engine, jobs).
 */
export async function logActivity(
  tx: Tx,
  entry: {
    actorId: string | null;
    entityType: "task" | "project" | "client" | "expense" | "income" | "user" | "settings";
    entityId: string;
    action: string;
    detail?: Record<string, unknown>;
  },
) {
  await tx.insert(schema.activityLog).values({
    actorId: entry.actorId,
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    detail: entry.detail ?? null,
  });
}
