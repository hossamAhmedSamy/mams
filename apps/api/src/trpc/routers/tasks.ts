import { zChecklist, zDateISO, zHttpsUrl, zTaskStatus } from "@mams/shared";
import { z } from "zod";
import { previewHandoff } from "../../services/handoff-engine";
import * as taskService from "../../services/task-service";
import { adminProcedure, protectedProcedure, router } from "../trpc";

export const tasksRouter = router({
  myWork: protectedProcedure.query(({ ctx }) => taskService.myWork(ctx.user.id)),

  calendar: protectedProcedure
    .input(z.object({ from: zDateISO, to: zDateISO, userId: z.string().optional() }))
    .query(({ ctx, input }) => taskService.calendar(ctx.user, input)),

  handoffPreview: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .query(({ ctx, input }) => previewHandoff(ctx.db, input.id)),

  list: protectedProcedure
    .input(
      z
        .object({
          projectId: z.uuid().optional(),
          assigneeId: z.string().optional(),
          stageId: z.uuid().optional(),
          clientId: z.uuid().optional(),
          status: zTaskStatus.optional(),
          overdue: z.boolean().optional(),
          unassigned: z.boolean().optional(),
          flagged: z.boolean().optional(),
        })
        .default({}),
    )
    .query(({ input }) => taskService.listTasks(input)),

  get: protectedProcedure.input(z.object({ id: z.uuid() })).query(({ input }) =>
    taskService.getTask(input.id),
  ),

  transition: protectedProcedure
    .input(z.object({ id: z.uuid(), to: zTaskStatus }))
    .mutation(({ ctx, input }) => taskService.transition(input.id, input.to, ctx.user)),

  updateChecklist: protectedProcedure
    .input(z.object({ id: z.uuid(), checklist: zChecklist }))
    .mutation(({ ctx, input }) => taskService.updateChecklist(ctx.user, input)),

  setDriveLink: protectedProcedure
    .input(z.object({ id: z.uuid(), driveLink: zHttpsUrl.nullable() }))
    .mutation(({ ctx, input }) => taskService.setDriveLink(ctx.user, input)),

  create: adminProcedure
    .input(
      z.object({
        projectId: z.uuid(),
        title: z.string().min(1).max(200),
        details: z.string().max(5000).optional(),
        assigneeId: z.string().optional(),
        deadline: zDateISO.optional(),
        driveLink: zHttpsUrl.optional(),
      }),
    )
    .mutation(({ ctx, input }) => taskService.createAdhocTask(ctx.user, input)),

  update: adminProcedure
    .input(
      z.object({
        id: z.uuid(),
        title: z.string().min(1).max(200).optional(),
        details: z.string().max(5000).nullable().optional(),
      }),
    )
    .mutation(({ ctx, input }) => taskService.updateDetails(ctx.user, input)),

  assign: adminProcedure
    .input(z.object({ id: z.uuid(), assigneeId: z.string().nullable() }))
    .mutation(({ ctx, input }) => taskService.assign(ctx.user, input)),

  setHelpers: adminProcedure
    .input(z.object({ id: z.uuid(), userIds: z.array(z.string()).max(10) }))
    .mutation(({ ctx, input }) => taskService.setHelpers(ctx.user, input)),

  setDeadline: adminProcedure
    .input(z.object({ id: z.uuid(), deadline: zDateISO.nullable() }))
    .mutation(({ ctx, input }) => taskService.setDeadline(ctx.user, input)),

  flag: adminProcedure
    .input(z.object({ id: z.uuid(), note: z.string().max(1000).optional() }))
    .mutation(({ ctx, input }) => taskService.setFlag(ctx.user, { ...input, flagged: true })),

  unflag: adminProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(({ ctx, input }) => taskService.setFlag(ctx.user, { id: input.id, flagged: false })),

  delete: adminProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(({ ctx, input }) => taskService.deleteTask(ctx.user, input.id)),
});
