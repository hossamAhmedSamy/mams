import { schema } from "@mams/db";
import { asc, eq } from "drizzle-orm";
import { protectedProcedure, router } from "../trpc";

const { workflowTemplates, templateStages, stages } = schema;

export const workflowsRouter = router({
  listTemplates: protectedProcedure.query(async ({ ctx }) => {
    const templates = await ctx.db
      .select()
      .from(workflowTemplates)
      .where(eq(workflowTemplates.active, true))
      .orderBy(asc(workflowTemplates.name));
    const chains = await ctx.db
      .select({
        templateId: templateStages.templateId,
        position: templateStages.position,
        stageName: stages.name,
        requiresApproval: templateStages.requiresApproval,
      })
      .from(templateStages)
      .innerJoin(stages, eq(templateStages.stageId, stages.id))
      .orderBy(asc(templateStages.position));
    return templates.map((t) => ({
      ...t,
      chain: chains.filter((c) => c.templateId === t.id),
    }));
  }),

  listStages: protectedProcedure.query(({ ctx }) =>
    ctx.db.select().from(stages).where(eq(stages.active, true)).orderBy(asc(stages.sortOrder)),
  ),
});
