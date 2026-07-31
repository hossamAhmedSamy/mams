import { schema } from "@mams/db";
import { REMINDER_RULES } from "@mams/shared";
import { TRPCError } from "@trpc/server";
import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { logActivity } from "../../services/activity";
import { permissionProcedure, protectedProcedure, router } from "../trpc";

const manageWorkflows = permissionProcedure("settings.workflows");

const { workflowTemplates, templateStages, stages, stageSkills, skills } = schema;

const zTemplateChain = z
  .array(z.object({ stageId: z.uuid(), requiresApproval: z.boolean().default(false) }))
  .min(1)
  .max(12);

export const workflowsRouter = router({
  listTemplates: protectedProcedure.query(async ({ ctx }) => {
    const templates = await ctx.db
      .select()
      .from(workflowTemplates)
      .orderBy(asc(workflowTemplates.name));
    const chains = await ctx.db
      .select({
        templateId: templateStages.templateId,
        stageId: templateStages.stageId,
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

  listStages: protectedProcedure.query(async ({ ctx }) => {
    const stageRows = await ctx.db.select().from(stages).orderBy(asc(stages.sortOrder));
    const links = await ctx.db
      .select({ stageId: stageSkills.stageId, skillId: stageSkills.skillId, name: skills.name })
      .from(stageSkills)
      .innerJoin(skills, eq(stageSkills.skillId, skills.id));
    return stageRows.map((s) => ({
      ...s,
      skills: links
        .filter((l) => l.stageId === s.id)
        .map((l) => ({ id: l.skillId, name: l.name })),
    }));
  }),

  // --- template builder (admin creates flows and saves them for reuse) ------

  createTemplate: manageWorkflows
    .input(z.object({ name: z.string().min(1).max(120), chain: zTemplateChain }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.transaction(async (tx) => {
        const [tpl] = await tx
          .insert(workflowTemplates)
          .values({ name: input.name })
          .onConflictDoNothing()
          .returning();
        if (!tpl) throw new TRPCError({ code: "CONFLICT", message: "A flow with this name exists" });
        await tx.insert(templateStages).values(
          input.chain.map((s, i) => ({
            templateId: tpl.id,
            stageId: s.stageId,
            position: i + 1,
            requiresApproval: s.requiresApproval,
          })),
        );
        await logActivity(tx, {
          actorId: ctx.user.id,
          entityType: "settings",
          entityId: tpl.id,
          action: "template_created",
          detail: { name: input.name },
        });
        return tpl;
      });
    }),

  /** Replaces the chain. Running projects are untouched (snapshot semantics). */
  updateTemplate: manageWorkflows
    .input(
      z.object({
        id: z.uuid(),
        name: z.string().min(1).max(120).optional(),
        chain: zTemplateChain.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.transaction(async (tx) => {
        if (input.name) {
          await tx
            .update(workflowTemplates)
            .set({ name: input.name })
            .where(eq(workflowTemplates.id, input.id));
        }
        if (input.chain) {
          await tx.delete(templateStages).where(eq(templateStages.templateId, input.id));
          await tx.insert(templateStages).values(
            input.chain.map((s, i) => ({
              templateId: input.id,
              stageId: s.stageId,
              position: i + 1,
              requiresApproval: s.requiresApproval,
            })),
          );
        }
        await logActivity(tx, {
          actorId: ctx.user.id,
          entityType: "settings",
          entityId: input.id,
          action: "template_updated",
        });
      });
    }),

  setTemplateActive: manageWorkflows
    .input(z.object({ id: z.uuid(), active: z.boolean() }))
    .mutation(({ ctx, input }) =>
      ctx.db
        .update(workflowTemplates)
        .set({ active: input.active })
        .where(eq(workflowTemplates.id, input.id)),
    ),

  // --- stage catalog ---------------------------------------------------------

  createStage: manageWorkflows
    .input(
      z.object({
        name: z.string().min(1).max(120),
        defaultDurationDays: z.number().int().min(0).max(60).default(3),
        reminderRule: z.enum(REMINDER_RULES).default("none"),
        skillIds: z.array(z.uuid()).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.transaction(async (tx) => {
        const [maxSort] = await tx
          .select({ sortOrder: stages.sortOrder })
          .from(stages)
          .orderBy(desc(stages.sortOrder))
          .limit(1);
        const [stage] = await tx
          .insert(stages)
          .values({
            name: input.name,
            defaultDurationDays: input.defaultDurationDays,
            reminderRule: input.reminderRule,
            sortOrder: (maxSort?.sortOrder ?? 0) + 100,
          })
          .onConflictDoNothing()
          .returning();
        if (!stage) throw new TRPCError({ code: "CONFLICT", message: "A stage with this name exists" });
        if (input.skillIds.length > 0) {
          await tx
            .insert(stageSkills)
            .values(input.skillIds.map((skillId) => ({ stageId: stage.id, skillId })));
        }
        await logActivity(tx, {
          actorId: ctx.user.id,
          entityType: "settings",
          entityId: stage.id,
          action: "stage_created",
          detail: { name: input.name },
        });
        return stage;
      });
    }),

  updateStage: manageWorkflows
    .input(
      z.object({
        id: z.uuid(),
        name: z.string().min(1).max(120).optional(),
        defaultDurationDays: z.number().int().min(0).max(60).optional(),
        reminderRule: z.enum(REMINDER_RULES).optional(),
        skillIds: z.array(z.uuid()).optional(),
        active: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.transaction(async (tx) => {
        const { id, skillIds, ...fields } = input;
        if (Object.keys(fields).length > 0) {
          await tx.update(stages).set(fields).where(eq(stages.id, id));
        }
        if (skillIds) {
          await tx.delete(stageSkills).where(eq(stageSkills.stageId, id));
          if (skillIds.length > 0) {
            await tx.insert(stageSkills).values(skillIds.map((skillId) => ({ stageId: id, skillId })));
          }
        }
        await logActivity(tx, {
          actorId: ctx.user.id,
          entityType: "settings",
          entityId: id,
          action: "stage_updated",
          detail: fields,
        });
      });
    }),
});
