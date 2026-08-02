import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { expenses } from "./app";
import { user } from "./auth";

// The mini HR module: time off on one side, pay on the other, joined at the
// single point where they touch — a day off that costs salary becomes a line
// on that month's payslip. Closed sets live in @mams/shared; the CHECK
// constraints here are their mirror.

/**
 * One request = one continuous stretch of days. `days` is stored rather than
 * derived so a decided request keeps the number it was decided on, even if the
 * counting rule is ever changed.
 */
export const leaveRequests = pgTable(
  "leave_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    days: integer("days").notNull(),
    reason: text("reason"),
    status: text("status").notNull().default("pending"),
    /**
     * Set when the admin decides that these days come off the person's pay
     * (always true for unpaid leave). The amount is materialized onto the
     * payslip when payroll for that month is prepared.
     */
    deductFromSalary: numeric("deduct_from_salary", { precision: 12, scale: 2 }),
    decidedBy: text("decided_by").references(() => user.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    /** Set when an admin logged the leave on someone's behalf. */
    createdBy: text("created_by").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("leave_requests_user_start_idx").on(t.userId, t.startDate),
    index("leave_requests_status_idx").on(t.status),
    index("leave_requests_span_idx").on(t.startDate, t.endDate),
    check("leave_requests_type_check", sql`${t.type} IN ('annual','casual','sick','unpaid')`),
    check(
      "leave_requests_status_check",
      sql`${t.status} IN ('pending','approved','rejected','canceled')`,
    ),
    check("leave_requests_span_check", sql`${t.endDate} >= ${t.startDate}`),
    check("leave_requests_days_check", sql`${t.days} > 0`),
  ],
);

/**
 * Per-person yearly allowance. A missing row means the defaults in
 * @mams/shared apply — nobody has to be set up before they can ask for a day.
 */
export const leaveAllowances = pgTable(
  "leave_allowances",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    annualDays: integer("annual_days").notNull(),
    casualDays: integer("casual_days").notNull(),
    sickDays: integer("sick_days").notNull(),
    updatedBy: text("updated_by").references(() => user.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.year] })],
);

/**
 * Pay history, not a single mutable figure: a raise is a new row, so an old
 * payslip can always be explained by the salary that was in force then.
 */
export const salaries = pgTable(
  "salaries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    monthlyAmount: numeric("monthly_amount", { precision: 12, scale: 2 }).notNull(),
    effectiveFrom: date("effective_from").notNull(),
    note: text("note"),
    createdBy: text("created_by").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("salaries_user_effective_uq").on(t.userId, t.effectiveFrom),
    check("salaries_amount_check", sql`${t.monthlyAmount} >= 0`),
  ],
);

/**
 * One month's pay for one person. Drafts are editable; once paid the row is
 * frozen and carries the overhead expense it posted into the books, so Money
 * and HR can never tell two different stories about the same payment.
 */
export const payslips = pgTable(
  "payslips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    period: text("period").notNull(), // YYYY-MM
    baseAmount: numeric("base_amount", { precision: 12, scale: 2 }).notNull(),
    netAmount: numeric("net_amount", { precision: 12, scale: 2 }).notNull(),
    status: text("status").notNull().default("draft"),
    note: text("note"),
    paidOn: date("paid_on"),
    paidBy: text("paid_by").references(() => user.id),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    expenseId: uuid("expense_id").references(() => expenses.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payslips_user_period_uq").on(t.userId, t.period),
    index("payslips_period_idx").on(t.period),
    check("payslips_period_check", sql`${t.period} ~ '^[0-9]{4}-[0-9]{2}$'`),
    check("payslips_status_check", sql`${t.status} IN ('draft','paid')`),
  ],
);

/** Everything that moves a payslip off its base figure. Amounts are positive. */
export const payrollAdjustments = pgTable(
  "payroll_adjustments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    payslipId: uuid("payslip_id")
      .notNull()
      .references(() => payslips.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    note: text("note"),
    /** Set for the unpaid-days line, so the payslip points back at the leave. */
    leaveRequestId: uuid("leave_request_id").references(() => leaveRequests.id, {
      onDelete: "set null",
    }),
    createdBy: text("created_by").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("payroll_adjustments_payslip_idx").on(t.payslipId),
    // one leave can only ever be charged once, which is what makes preparing
    // payroll twice in the same month harmless
    uniqueIndex("payroll_adjustments_leave_uq")
      .on(t.payslipId, t.leaveRequestId)
      .where(sql`${t.leaveRequestId} IS NOT NULL`),
    check(
      "payroll_adjustments_kind_check",
      sql`${t.kind} IN ('bonus','deduction','advance','leave_deduction')`,
    ),
    check("payroll_adjustments_amount_check", sql`${t.amount} > 0`),
  ],
);
