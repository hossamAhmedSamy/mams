import { initTRPC, TRPCError } from "@trpc/server";
import type { Context } from "./context";

const t = initTRPC.context<Context>().create({
  errorFormatter({ shape }) {
    // never leak stack traces, regardless of NODE_ENV
    const { stack: _stack, ...data } = shape.data as Record<string, unknown>;
    return { ...shape, data };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

/** Any signed-in, non-banned user. */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { ...ctx, user: ctx.user } });
});

/** Admin only (PLAN.md §3). */
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
  return next({ ctx });
});
