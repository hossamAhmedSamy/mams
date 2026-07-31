import { zChecklist, zDateISO, zHttpsUrl, zTaskStatus } from "@mams/shared";
import { z } from "zod";
import { previewHandoff } from "../../services/handoff-engine";
import * as taskService from "../../services/task-service";
import { permissionProcedure, protectedProcedure, router } from "../trpc";

const manageTasks = permissionProcedure("tasks.manage");
const assignTasks = permissionProcedure("tasks.assign");

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

  create: manageTasks
    .input(
      z.object({
        projectId: z.uuid(),
        stageId: z.uuid().optional(),
        details: z.string().max(5000).optional(),
        assigneeIds: z.array(z.string()).max(10).default([]),
        startDate: zDateISO.optional(),
        deadline: zDateISO.optional(),
        driveLink: zHttpsUrl.optional(),
      }),
    )
    .mutation(({ ctx, input }) => taskService.createAdhocTask(ctx.user, input)),

  update: manageTasks
    .input(
      z.object({
        id: z.uuid(),
        stageId: z.uuid().nullable().optional(),
        details: z.string().max(5000).nullable().optional(),
      }),
    )
    .mutation(({ ctx, input }) => taskService.updateDetails(ctx.user, input)),

  /** Everyone on the task, in one call — assignees are equals, not owner+helpers. */
  setAssignees: assignTasks
    .input(z.object({ id: z.uuid(), userIds: z.array(z.string()).max(10) }))
    .mutation(({ ctx, input }) => taskService.setAssignees(ctx.user, input)),

  setSchedule: manageTasks
    .input(
      z.object({
        id: z.uuid(),
        startDate: zDateISO.nullable().optional(),
        deadline: zDateISO.nullable().optional(),
      }),
    )
    .mutation(({ ctx, input }) => taskService.setSchedule(ctx.user, input)),

  flag: manageTasks
    .input(z.object({ id: z.uuid(), note: z.string().max(1000).optional() }))
    .mutation(({ ctx, input }) => taskService.setFlag(ctx.user, { ...input, flagged: true })),

  unflag: manageTasks
    .input(z.object({ id: z.uuid() }))
    .mutation(({ ctx, input }) => taskService.setFlag(ctx.user, { id: input.id, flagged: false })),

  delete: manageTasks
    .input(z.object({ id: z.uuid() }))
    .mutation(({ ctx, input }) => taskService.deleteTask(ctx.user, input.id)),
});
