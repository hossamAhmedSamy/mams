import { zPassword } from "@mams/shared";
import { z } from "zod";
import * as userService from "../../services/user-service";
import { adminProcedure, protectedProcedure, router } from "../trpc";

export const usersRouter = router({
  me: protectedProcedure.query(({ ctx }) => ({
    id: ctx.user.id,
    name: ctx.user.name,
    email: ctx.user.email,
    role: ctx.user.role,
    mustChangePassword: ctx.user.mustChangePassword,
  })),

  changePassword: protectedProcedure
    .input(z.object({ currentPassword: z.string().min(1), newPassword: zPassword }))
    .mutation(({ ctx, input }) => userService.changeOwnPassword(ctx.user.id, input)),

  list: adminProcedure.query(() => userService.listUsers()),

  create: adminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(120),
        email: z.email(),
        tempPassword: zPassword,
        role: z.enum(["admin", "member"]),
        skillIds: z.array(z.uuid()).default([]),
      }),
    )
    .mutation(({ ctx, input }) => userService.createUser(ctx.user.id, input)),

  update: adminProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(120).optional(),
        role: z.enum(["admin", "member"]).optional(),
      }),
    )
    .mutation(({ ctx, input }) => userService.updateUser(ctx.user.id, input)),

  setSkills: adminProcedure
    .input(z.object({ id: z.string(), skillIds: z.array(z.uuid()) }))
    .mutation(({ ctx, input }) => userService.setSkills(ctx.user.id, input)),

  setActive: adminProcedure
    .input(z.object({ id: z.string(), active: z.boolean() }))
    .mutation(({ ctx, input }) => userService.setActive(ctx.user.id, input)),

  resetPassword: adminProcedure
    .input(z.object({ id: z.string(), tempPassword: zPassword }))
    .mutation(({ ctx, input }) => userService.resetPassword(ctx.user.id, input)),
});
