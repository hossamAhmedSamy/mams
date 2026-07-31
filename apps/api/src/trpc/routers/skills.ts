import { schema } from "@mams/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { permissionProcedure, protectedProcedure, router } from "../trpc";

const manageWorkflows = permissionProcedure("settings.workflows");

export const skillsRouter = router({
  list: protectedProcedure.query(({ ctx }) =>
    ctx.db.select().from(schema.skills).orderBy(schema.skills.name),
  ),

  create: manageWorkflows
    .input(z.object({ name: z.string().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(schema.skills)
        .values({ name: input.name })
        .onConflictDoNothing()
        .returning();
      return row ?? null;
    }),

  rename: manageWorkflows
    .input(z.object({ id: z.uuid(), name: z.string().min(1).max(80) }))
    .mutation(({ ctx, input }) =>
      ctx.db.update(schema.skills).set({ name: input.name }).where(eq(schema.skills.id, input.id)),
    ),

  setActive: manageWorkflows
    .input(z.object({ id: z.uuid(), active: z.boolean() }))
    .mutation(({ ctx, input }) =>
      ctx.db
        .update(schema.skills)
        .set({ active: input.active })
        .where(eq(schema.skills.id, input.id)),
    ),
});
