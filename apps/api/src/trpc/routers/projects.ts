import { zDateISO, zHttpsUrl, zPriority, zProjectStatus } from "@mams/shared";
import { z } from "zod";
import * as projectService from "../../services/project-service";
import { adminProcedure, protectedProcedure, router } from "../trpc";

export const projectsRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          clientId: z.uuid().optional(),
          status: zProjectStatus.optional(),
          priority: zPriority.optional(),
        })
        .default({}),
    )
    .query(({ input }) => projectService.listProjects(input)),

  get: protectedProcedure.input(z.object({ id: z.uuid() })).query(({ input }) =>
    projectService.getProject(input.id),
  ),

  create: adminProcedure
    .input(
      z.object({
        clientId: z.uuid(),
        title: z.string().min(1).max(200),
        campaign: z.string().max(200).optional(),
        priority: zPriority.default("medium"),
        startDate: zDateISO.optional(),
        dueDate: zDateISO.optional(),
        driveLink: zHttpsUrl.optional(),
        notes: z.string().max(5000).optional(),
        workflowTemplateId: z.uuid().optional(),
        firstAssigneeId: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => projectService.createProject(ctx.user, input)),

  update: adminProcedure
    .input(
      z.object({
        id: z.uuid(),
        title: z.string().min(1).max(200).optional(),
        campaign: z.string().max(200).nullable().optional(),
        priority: zPriority.optional(),
        startDate: zDateISO.nullable().optional(),
        dueDate: zDateISO.nullable().optional(),
        driveLink: zHttpsUrl.nullable().optional(),
        notes: z.string().max(5000).nullable().optional(),
      }),
    )
    .mutation(({ ctx, input }) => projectService.updateProject(ctx.user, input)),

  setStatus: adminProcedure
    .input(z.object({ id: z.uuid(), status: zProjectStatus }))
    .mutation(({ ctx, input }) => projectService.setProjectStatus(ctx.user, input)),
});
