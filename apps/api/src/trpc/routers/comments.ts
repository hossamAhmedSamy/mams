import { schema } from "@mams/db";
import { taskLabel } from "@mams/shared";
import { TRPCError } from "@trpc/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { notifyUser } from "../../services/notify";
import { protectedProcedure, router } from "../trpc";

const { comments, tasks, stages, taskAssignees, user } = schema;

export const commentsRouter = router({
  listByTask: protectedProcedure.input(z.object({ taskId: z.uuid() })).query(({ ctx, input }) =>
    ctx.db
      .select({
        id: comments.id,
        body: comments.body,
        createdAt: comments.createdAt,
        authorId: comments.authorId,
        authorName: user.name,
      })
      .from(comments)
      .innerJoin(user, eq(comments.authorId, user.id))
      .where(eq(comments.taskId, input.taskId))
      .orderBy(asc(comments.createdAt)),
  ),

  create: protectedProcedure
    .input(z.object({ taskId: z.uuid(), body: z.string().min(1).max(5000) }))
    .mutation(async ({ ctx, input }) => {
      const [task] = await ctx.db.select().from(tasks).where(eq(tasks.id, input.taskId));
      if (!task) throw new TRPCError({ code: "NOT_FOUND" });
      const [row] = await ctx.db
        .insert(comments)
        .values({ taskId: input.taskId, authorId: ctx.user.id, body: input.body })
        .returning();
      const [stage] = task.stageId
        ? await ctx.db.select().from(stages).where(eq(stages.id, task.stageId))
        : [];
      const label = taskLabel(stage?.name ?? null);
      for (const person of await ctx.db
        .select({ userId: taskAssignees.userId })
        .from(taskAssignees)
        .where(eq(taskAssignees.taskId, task.id))) {
        if (person.userId === ctx.user.id) continue;
        await notifyUser(ctx.db, person.userId, {
          type: "comment_added",
          title: `${ctx.user.name} commented on "${label}"`,
          body: input.body.slice(0, 200),
          entityType: "task",
          entityId: task.id,
        });
      }
      return row;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [comment] = await ctx.db.select().from(comments).where(eq(comments.id, input.id));
      if (!comment) throw new TRPCError({ code: "NOT_FOUND" });
      if (ctx.user.role !== "admin" && comment.authorId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await ctx.db.delete(comments).where(eq(comments.id, input.id));
    }),
});
