import { schema } from "@mams/db";
import { zDateISO, zHttpsUrl, zMoney } from "@mams/shared";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import * as financeService from "../../services/finance-service";
import { adminProcedure, protectedProcedure, router } from "../trpc";

export const financeRouter = router({
  // --- member-accessible (own money only; never the ledger) -----------------

  listCategories: protectedProcedure.query(({ ctx }) =>
    ctx.db
      .select()
      .from(schema.expenseCategories)
      .where(eq(schema.expenseCategories.active, true))
      .orderBy(asc(schema.expenseCategories.name)),
  ),

  requestExpense: protectedProcedure
    .input(
      z.object({
        projectId: z.uuid().optional(),
        categoryId: z.uuid(),
        amount: zMoney,
        spentOn: zDateISO,
        note: z.string().min(3).max(1000),
        vendor: z.string().max(200).optional(),
        receiptLink: zHttpsUrl.optional(),
      }),
    )
    .mutation(({ ctx, input }) => financeService.requestExpense(ctx.user, input)),

  myExpenses: protectedProcedure.query(({ ctx }) => financeService.myExpenses(ctx.user.id)),

  cancelMyRequest: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(({ ctx, input }) => financeService.cancelMyRequest(ctx.user, input.id)),

  // --- admin ----------------------------------------------------------------

  pendingRequests: adminProcedure.query(() => financeService.listPendingRequests()),

  decide: adminProcedure
    .input(z.object({ id: z.uuid(), approve: z.boolean(), note: z.string().max(500).optional() }))
    .mutation(({ ctx, input }) => financeService.decideExpense(ctx.user, input)),

  addExpense: adminProcedure
    .input(
      z.object({
        projectId: z.uuid().optional(),
        categoryId: z.uuid(),
        amount: zMoney,
        spentOn: zDateISO,
        note: z.string().max(1000).optional(),
        vendor: z.string().max(200).optional(),
        receiptLink: zHttpsUrl.optional(),
      }),
    )
    .mutation(({ ctx, input }) => financeService.addExpense(ctx.user, input)),

  deleteExpense: adminProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(({ ctx, input }) => financeService.deleteExpense(ctx.user, input.id)),

  addIncome: adminProcedure
    .input(
      z.object({
        projectId: z.uuid(),
        amount: zMoney,
        receivedOn: zDateISO,
        note: z.string().max(1000).optional(),
      }),
    )
    .mutation(({ ctx, input }) => financeService.addIncome(ctx.user, input)),

  deleteIncome: adminProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(({ ctx, input }) => financeService.deleteIncome(ctx.user, input.id)),

  projectLedger: adminProcedure
    .input(z.object({ projectId: z.uuid() }))
    .query(({ input }) => financeService.projectLedger(input.projectId)),

  overview: adminProcedure
    .input(z.object({ from: zDateISO, to: zDateISO }))
    .query(({ input }) => financeService.overview(input)),

  categories: router({
    create: adminProcedure
      .input(z.object({ name: z.string().min(1).max(80) }))
      .mutation(async ({ ctx, input }) => {
        const [row] = await ctx.db
          .insert(schema.expenseCategories)
          .values({ name: input.name })
          .onConflictDoNothing()
          .returning();
        return row ?? null;
      }),
    setActive: adminProcedure
      .input(z.object({ id: z.uuid(), active: z.boolean() }))
      .mutation(({ ctx, input }) =>
        ctx.db
          .update(schema.expenseCategories)
          .set({ active: input.active })
          .where(eq(schema.expenseCategories.id, input.id)),
      ),
  }),

  recurring: router({
    list: adminProcedure.query(() => financeService.listRecurring()),
    create: adminProcedure
      .input(
        z.object({
          name: z.string().min(1).max(200),
          amount: zMoney,
          categoryId: z.uuid(),
          dayOfMonth: z.number().int().min(1).max(28),
          userId: z.string().optional(),
        }),
      )
      .mutation(({ ctx, input }) => financeService.createRecurring(ctx.user, input)),
    update: adminProcedure
      .input(
        z.object({
          id: z.uuid(),
          name: z.string().min(1).max(200).optional(),
          amount: zMoney.optional(),
          categoryId: z.uuid().optional(),
          dayOfMonth: z.number().int().min(1).max(28).optional(),
          active: z.boolean().optional(),
        }),
      )
      .mutation(({ ctx, input }) => financeService.updateRecurring(ctx.user, input)),
  }),
});
