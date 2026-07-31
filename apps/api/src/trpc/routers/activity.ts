import { schema } from "@mams/db";
import { desc, and, eq } from "drizzle-orm";
import { z } from "zod";
import { permissionProcedure, protectedProcedure, router } from "../trpc";

const { activityLog, user } = schema;

const entityTypes = z.enum(["task", "project", "client", "user"]);

export const activityRouter = router({
  forEntity: protectedProcedure
    .input(z.object({ entityType: entityTypes, entityId: z.uuid(), limit: z.number().max(200).default(50) }))
    .query(({ ctx, input }) =>
      ctx.db
        .select({
          id: activityLog.id,
          action: activityLog.action,
          detail: activityLog.detail,
          createdAt: activityLog.createdAt,
          actorName: user.name,
        })
        .from(activityLog)
        .leftJoin(user, eq(activityLog.actorId, user.id))
        .where(
          and(
            eq(activityLog.entityType, input.entityType),
            eq(activityLog.entityId, input.entityId),
          ),
        )
        .orderBy(desc(activityLog.createdAt))
        .limit(input.limit),
    ),

  recent: permissionProcedure("team.viewAll")
    .input(z.object({ limit: z.number().max(100).default(20) }).default({ limit: 20 }))
    .query(({ ctx, input }) =>
      ctx.db
        .select({
          id: activityLog.id,
          entityType: activityLog.entityType,
          entityId: activityLog.entityId,
          action: activityLog.action,
          detail: activityLog.detail,
          createdAt: activityLog.createdAt,
          actorName: user.name,
        })
        .from(activityLog)
        .leftJoin(user, eq(activityLog.actorId, user.id))
        .orderBy(desc(activityLog.createdAt))
        .limit(input.limit),
    ),
});
