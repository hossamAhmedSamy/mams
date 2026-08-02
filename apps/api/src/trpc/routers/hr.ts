import { ADJUSTMENT_KINDS, LEAVE_TYPES, zDateISO, zMoney } from "@mams/shared";
import { z } from "zod";
import * as hrService from "../../services/hr-service";
import { permissionProcedure, protectedProcedure, router } from "../trpc";

const manageHr = permissionProcedure("hr.manage");

const zLeaveType = z.enum(LEAVE_TYPES);
const zPeriod = z.string().regex(/^\d{4}-\d{2}$/, "Expected YYYY-MM");
const zYear = z.number().int().min(2020).max(2100);
/** Deductions may be zero (= don't touch the pay), so not zMoney. */
const zDeduction = z.number().min(0).multipleOf(0.01).max(1_000_000);

export const hrRouter = router({
  // --- everyone: their own time off and their own pay ------------------------

  me: protectedProcedure.query(({ ctx }) => hrService.myHr(ctx.user.id)),

  requestLeave: protectedProcedure
    .input(
      z.object({
        type: zLeaveType,
        startDate: zDateISO,
        endDate: zDateISO,
        reason: z.string().max(1000).optional(),
      }),
    )
    .mutation(({ ctx, input }) => hrService.requestLeave(ctx.user, input)),

  cancelMyLeave: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(({ ctx, input }) => hrService.cancelMyLeave(ctx.user, input.id)),

  /** Who is off, for the team calendar. Names and dates only, never reasons. */
  calendar: protectedProcedure
    .input(z.object({ from: zDateISO, to: zDateISO }))
    .query(({ input }) => hrService.leaveCalendar(input)),

  // --- hr.manage: the queue, the team, the payroll ---------------------------

  pending: manageHr.query(() => hrService.pendingLeaves()),

  decideLeave: manageHr
    .input(
      z.object({
        id: z.uuid(),
        approve: z.boolean(),
        note: z.string().max(500).optional(),
        deductAmount: zDeduction.optional(),
      }),
    )
    .mutation(({ ctx, input }) => hrService.decideLeave(ctx.user, input)),

  logLeave: manageHr
    .input(
      z.object({
        userId: z.string(),
        type: zLeaveType,
        startDate: zDateISO,
        endDate: zDateISO,
        reason: z.string().max(1000).optional(),
        deductAmount: zDeduction.optional(),
      }),
    )
    .mutation(({ ctx, input }) => hrService.logLeave(ctx.user, input)),

  deleteLeave: manageHr
    .input(z.object({ id: z.uuid() }))
    .mutation(({ ctx, input }) => hrService.deleteLeave(ctx.user, input.id)),

  team: manageHr
    .input(z.object({ year: zYear }).optional())
    .query(({ input }) => hrService.teamLeave({ year: input?.year ?? hrService.currentYear() })),

  setAllowance: manageHr
    .input(
      z.object({
        userId: z.string(),
        year: zYear,
        annualDays: z.number().int().min(0).max(365),
        casualDays: z.number().int().min(0).max(365),
        sickDays: z.number().int().min(0).max(365),
      }),
    )
    .mutation(({ ctx, input }) => hrService.setAllowance(ctx.user, input)),

  // --- pay -------------------------------------------------------------------

  salaries: manageHr.query(() => hrService.listSalaries()),

  setSalary: manageHr
    .input(
      z.object({
        userId: z.string(),
        monthlyAmount: z.number().min(0).multipleOf(0.01).max(10_000_000),
        effectiveFrom: zDateISO,
        note: z.string().max(500).optional(),
      }),
    )
    .mutation(({ ctx, input }) => hrService.setSalary(ctx.user, input)),

  personPay: manageHr
    .input(z.object({ userId: z.string() }))
    .query(({ input }) => hrService.personPay(input.userId)),

  payroll: manageHr
    .input(z.object({ period: zPeriod }))
    .query(({ input }) => hrService.payroll(input)),

  preparePayroll: manageHr
    .input(z.object({ period: zPeriod }))
    .mutation(({ ctx, input }) => hrService.preparePayroll(ctx.user, input)),

  addAdjustment: manageHr
    .input(
      z.object({
        payslipId: z.uuid(),
        kind: z.enum(ADJUSTMENT_KINDS),
        amount: zMoney,
        note: z.string().max(500).optional(),
      }),
    )
    .mutation(({ ctx, input }) => hrService.addAdjustment(ctx.user, input)),

  removeAdjustment: manageHr
    .input(z.object({ id: z.uuid() }))
    .mutation(({ ctx, input }) => hrService.removeAdjustment(ctx.user, input.id)),

  markPaid: manageHr
    .input(z.object({ payslipId: z.uuid(), paidOn: zDateISO.optional() }))
    .mutation(({ ctx, input }) => hrService.markPaid(ctx.user, input)),

  deletePayslip: manageHr
    .input(z.object({ id: z.uuid() }))
    .mutation(({ ctx, input }) => hrService.deletePayslip(ctx.user, input.id)),
});
