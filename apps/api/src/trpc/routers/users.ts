import { PERMISSIONS, zPassword } from "@mams/shared";
import { z } from "zod";
import * as userService from "../../services/user-service";
import { permissionProcedure, protectedProcedure, router } from "../trpc";

const manageTeam = permissionProcedure("settings.team");
const zPermissions = z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length);

export const usersRouter = router({
  me: protectedProcedure.query(({ ctx }) => ({
    id: ctx.user.id,
    name: ctx.user.name,
    email: ctx.user.email,
    role: ctx.user.role,
    permissions: ctx.user.permissions,
    mustChangePassword: ctx.user.mustChangePassword,
  })),

  changePassword: protectedProcedure
    .input(z.object({ currentPassword: z.string().min(1), newPassword: zPassword }))
    .mutation(({ ctx, input }) => userService.changeOwnPassword(ctx.user.id, input)),

  /** Everyone needs the roster to see who is on a task. */
  list: protectedProcedure.query(() => userService.listUsers()),

  create: manageTeam
    .input(
      z.object({
        name: z.string().min(1).max(120),
        email: z.email(),
        tempPassword: zPassword,
        role: z.enum(["admin", "member"]),
        skillIds: z.array(z.uuid()).default([]),
        permissions: zPermissions.default([]),
      }),
    )
    .mutation(({ ctx, input }) => userService.createUser(ctx.user.id, input)),

  update: manageTeam
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(120).optional(),
        role: z.enum(["admin", "member"]).optional(),
      }),
    )
    .mutation(({ ctx, input }) => userService.updateUser(ctx.user.id, input)),

  setSkills: manageTeam
    .input(z.object({ id: z.string(), skillIds: z.array(z.uuid()) }))
    .mutation(({ ctx, input }) => userService.setSkills(ctx.user.id, input)),

  setPermissions: manageTeam
    .input(z.object({ id: z.string(), permissions: zPermissions }))
    .mutation(({ ctx, input }) => userService.setPermissions(ctx.user.id, input)),

  setActive: manageTeam
    .input(z.object({ id: z.string(), active: z.boolean() }))
    .mutation(({ ctx, input }) => userService.setActive(ctx.user.id, input)),

  resetPassword: manageTeam
    .input(z.object({ id: z.string(), tempPassword: zPassword }))
    .mutation(({ ctx, input }) => userService.resetPassword(ctx.user.id, input)),
});
