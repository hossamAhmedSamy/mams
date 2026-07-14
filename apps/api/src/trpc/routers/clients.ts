import { schema } from "@mams/db";
import { TRPCError } from "@trpc/server";
import { and, asc, count, eq } from "drizzle-orm";
import { z } from "zod";
import { logActivity } from "../../services/activity";
import { adminProcedure, protectedProcedure, router } from "../trpc";

const { clients, projects } = schema;

export const clientsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: clients.id,
        name: clients.name,
        status: clients.status,
        notes: clients.notes,
        activeProjects: count(projects.id),
      })
      .from(clients)
      .leftJoin(projects, and(eq(projects.clientId, clients.id), eq(projects.status, "active")))
      .groupBy(clients.id)
      .orderBy(asc(clients.name));
    return rows;
  }),

  create: adminProcedure
    .input(z.object({ name: z.string().min(1).max(200), notes: z.string().max(5000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(clients)
        .values({ name: input.name, notes: input.notes ?? null })
        .onConflictDoNothing()
        .returning();
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Client already exists" });
      await logActivity(ctx.db, {
        actorId: ctx.user.id,
        entityType: "client",
        entityId: row.id,
        action: "created",
        detail: { name: input.name },
      });
      return row;
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.uuid(),
        name: z.string().min(1).max(200).optional(),
        notes: z.string().max(5000).nullable().optional(),
        status: z.enum(["active", "archived"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...fields } = input;
      await ctx.db.update(clients).set(fields).where(eq(clients.id, id));
      await logActivity(ctx.db, {
        actorId: ctx.user.id,
        entityType: "client",
        entityId: id,
        action: "updated",
        detail: fields,
      });
    }),
});
