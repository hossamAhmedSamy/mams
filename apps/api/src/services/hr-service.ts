import { schema } from "@mams/db";
import {
  type AdjustmentKind,
  DEFAULT_ALLOWANCE,
  dailyRate,
  daysBeyondBalance,
  formatMoney,
  type LeaveBalance,
  leaveBalance,
  leaveDays,
  type LeaveType,
  LEAVE_TYPE_LABELS,
  payslipNet,
  type Permission,
  periodLabel,
} from "@mams/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, inArray, lte, ne, type SQL, sql } from "drizzle-orm";
import type { Db } from "../db";
import { db } from "../db";
import { env } from "../env";
import { todayISO } from "../lib/time";
import { logActivity } from "./activity";
import { notifyResponsible, notifyUser } from "./notify";

const {
  leaveRequests,
  leaveAllowances,
  salaries,
  payslips,
  payrollAdjustments,
  expenses,
  expenseCategories,
  recurringExpenses,
  user,
} = schema;

type Tx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

type Actor = {
  id: string;
  role: "admin" | "member";
  name: string;
  permissions: readonly Permission[];
};

/** The category paid payslips post into, created on first payroll if missing. */
const SALARY_CATEGORY = "Salaries";

// ---------------------------------------------------------------------------
// Balances
//
// A leave is counted against the year it *starts* in. Splitting a New Year's
// stretch across two balances would be more correct on paper and impossible to
// explain to the person taking the days — the whole request lands in one year.
// ---------------------------------------------------------------------------

export function currentYear(): number {
  return Number(todayISO(env.TZ_BUSINESS).slice(0, 4));
}

export async function allowanceFor(tx: Tx, userId: string, year: number) {
  const [row] = await tx
    .select()
    .from(leaveAllowances)
    .where(and(eq(leaveAllowances.userId, userId), eq(leaveAllowances.year, year)));
  return row
    ? { annual: row.annualDays, casual: row.casualDays, sick: row.sickDays }
    : { ...DEFAULT_ALLOWANCE };
}

async function usedDaysByType(tx: Tx, userIds: string[], year: number) {
  if (userIds.length === 0) return new Map<string, Partial<Record<LeaveType, number>>>();
  const rows = await tx
    .select({
      userId: leaveRequests.userId,
      type: leaveRequests.type,
      days: sql<string>`SUM(${leaveRequests.days})`,
    })
    .from(leaveRequests)
    .where(
      and(
        inArray(leaveRequests.userId, userIds),
        eq(leaveRequests.status, "approved"),
        gte(leaveRequests.startDate, `${year}-01-01`),
        lte(leaveRequests.startDate, `${year}-12-31`),
      ),
    )
    .groupBy(leaveRequests.userId, leaveRequests.type);

  const byUser = new Map<string, Partial<Record<LeaveType, number>>>();
  for (const row of rows) {
    const entry = byUser.get(row.userId) ?? {};
    entry[row.type as LeaveType] = Number(row.days);
    byUser.set(row.userId, entry);
  }
  return byUser;
}

export async function balanceFor(tx: Tx, userId: string, year: number): Promise<LeaveBalance> {
  const allowance = await allowanceFor(tx, userId, year);
  const used = (await usedDaysByType(tx, [userId], year)).get(userId) ?? {};
  return leaveBalance(allowance, used);
}

// ---------------------------------------------------------------------------
// Member: ask for days, see what's left, see own pay
// ---------------------------------------------------------------------------

export async function requestLeave(
  actor: Actor,
  input: { type: LeaveType; startDate: string; endDate: string; reason?: string },
) {
  const days = assertSpan(input.startDate, input.endDate);
  await assertNoOverlap(db, actor.id, input.startDate, input.endDate);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(leaveRequests)
      .values({
        userId: actor.id,
        type: input.type,
        startDate: input.startDate,
        endDate: input.endDate,
        days,
        reason: input.reason ?? null,
        status: "pending",
        createdBy: actor.id,
      })
      .returning();
    await logActivity(tx, {
      actorId: actor.id,
      entityType: "leave",
      entityId: row!.id,
      action: "requested",
      detail: { type: input.type, days, from: input.startDate, to: input.endDate },
    });
    await notifyResponsible(
      tx,
      "hr.manage",
      {
        type: "leave_requested",
        title: `${actor.name} asks for ${days} day${days === 1 ? "" : "s"} off`,
        body: `${LEAVE_TYPE_LABELS[input.type]} · ${input.startDate} → ${input.endDate}${
          input.reason ? ` · ${input.reason}` : ""
        }`,
      },
      actor.id,
    );
    return row!;
  });
}

/** A member may withdraw a request only while nobody has acted on it. */
export async function cancelMyLeave(actor: Actor, id: string) {
  const [row] = await db
    .update(leaveRequests)
    .set({ status: "canceled" })
    .where(
      and(
        eq(leaveRequests.id, id),
        eq(leaveRequests.userId, actor.id),
        eq(leaveRequests.status, "pending"),
      ),
    )
    .returning();
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "No pending request to cancel" });
  await logActivity(db, {
    actorId: actor.id,
    entityType: "leave",
    entityId: id,
    action: "canceled",
  });
}

/**
 * Everything one person needs about themselves: what's left, what they asked
 * for, what they earn and what they were paid. Own figures only — a member
 * never sees another person's balance or pay through this.
 */
export async function myHr(actorId: string) {
  const year = currentYear();
  const balance = await balanceFor(db, actorId, year);
  const requests = await db
    .select({
      id: leaveRequests.id,
      type: leaveRequests.type,
      startDate: leaveRequests.startDate,
      endDate: leaveRequests.endDate,
      days: leaveRequests.days,
      reason: leaveRequests.reason,
      status: leaveRequests.status,
      decisionNote: leaveRequests.decisionNote,
      deductFromSalary: leaveRequests.deductFromSalary,
      createdAt: leaveRequests.createdAt,
    })
    .from(leaveRequests)
    .where(eq(leaveRequests.userId, actorId))
    .orderBy(desc(leaveRequests.startDate))
    .limit(100);

  const salary = await currentSalary(db, actorId);
  // Paid slips only: a draft is the owner's working copy for the month and
  // showing it would promise a figure he is still deciding.
  const slips = await payslipsWithLines(
    db,
    and(eq(payslips.userId, actorId), eq(payslips.status, "paid")),
  );

  return {
    year,
    balance,
    requests,
    salary: salary ? { monthlyAmount: Number(salary.monthlyAmount), from: salary.effectiveFrom } : null,
    payslips: slips,
  };
}

// ---------------------------------------------------------------------------
// Admin: the leave queue
// ---------------------------------------------------------------------------

export async function pendingLeaves() {
  const rows = await db
    .select({
      id: leaveRequests.id,
      userId: leaveRequests.userId,
      userName: user.name,
      type: leaveRequests.type,
      startDate: leaveRequests.startDate,
      endDate: leaveRequests.endDate,
      days: leaveRequests.days,
      reason: leaveRequests.reason,
      createdAt: leaveRequests.createdAt,
    })
    .from(leaveRequests)
    .innerJoin(user, eq(leaveRequests.userId, user.id))
    .where(eq(leaveRequests.status, "pending"))
    .orderBy(asc(leaveRequests.startDate));

  // Each row carries the decision context with it: what the person has left,
  // and what the days would cost if they came off pay instead of balance.
  return Promise.all(
    rows.map(async (row) => {
      const year = Number(row.startDate.slice(0, 4));
      const balance = await balanceFor(db, row.userId, year);
      const salary = await currentSalary(db, row.userId);
      const beyond = daysBeyondBalance(row.type as LeaveType, row.days, balance);
      return {
        ...row,
        type: row.type as LeaveType,
        balance,
        daysBeyondBalance: beyond,
        suggestedDeduction: salary ? round2(dailyRate(salary.monthlyAmount) * beyond) : 0,
        monthlyAmount: salary?.monthlyAmount ?? null,
      };
    }),
  );
}

/**
 * Approve or reject. `deductAmount` is the owner's lever: any approved leave
 * can be sent to that month's payslip instead of (or as well as) the balance —
 * it is materialized as a line when payroll for the month is prepared.
 */
export async function decideLeave(
  actor: Actor,
  input: { id: string; approve: boolean; note?: string; deductAmount?: number },
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(leaveRequests)
      .set({
        status: input.approve ? "approved" : "rejected",
        decidedBy: actor.id,
        decidedAt: new Date(),
        decisionNote: input.note ?? null,
        deductFromSalary:
          input.approve && input.deductAmount && input.deductAmount > 0
            ? String(round2(input.deductAmount))
            : null,
      })
      .where(and(eq(leaveRequests.id, input.id), eq(leaveRequests.status, "pending")))
      .returning();
    if (!row) throw new TRPCError({ code: "CONFLICT", message: "Request already decided" });

    await logActivity(tx, {
      actorId: actor.id,
      entityType: "leave",
      entityId: row.id,
      action: input.approve ? "approved" : "rejected",
      detail: { note: input.note, deduct: input.deductAmount },
    });
    await notifyUser(tx, row.userId, {
      type: "leave_decided",
      title: input.approve
        ? `${row.days} day${row.days === 1 ? "" : "s"} off approved ✓`
        : `Time off ${row.startDate} → ${row.endDate} was rejected`,
      body: [
        input.note,
        input.approve && row.deductFromSalary
          ? `${formatMoney(row.deductFromSalary)} will come off that month's pay.`
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
    });
    return row;
  });
}

/**
 * The owner logging days off himself — "Mariam took a casual day yesterday" —
 * without waiting for a request. Born approved, because he is the approval.
 */
export async function logLeave(
  actor: Actor,
  input: {
    userId: string;
    type: LeaveType;
    startDate: string;
    endDate: string;
    reason?: string;
    deductAmount?: number;
  },
) {
  const days = assertSpan(input.startDate, input.endDate);
  await assertNoOverlap(db, input.userId, input.startDate, input.endDate);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(leaveRequests)
      .values({
        userId: input.userId,
        type: input.type,
        startDate: input.startDate,
        endDate: input.endDate,
        days,
        reason: input.reason ?? null,
        status: "approved",
        deductFromSalary:
          input.deductAmount && input.deductAmount > 0 ? String(round2(input.deductAmount)) : null,
        decidedBy: actor.id,
        decidedAt: new Date(),
        createdBy: actor.id,
      })
      .returning();
    await logActivity(tx, {
      actorId: actor.id,
      entityType: "leave",
      entityId: row!.id,
      action: "logged",
      detail: { type: input.type, days, for: input.userId, deduct: input.deductAmount },
    });
    if (input.userId !== actor.id) {
      await notifyUser(tx, input.userId, {
        type: "leave_decided",
        title: `${days} day${days === 1 ? "" : "s"} of ${LEAVE_TYPE_LABELS[
          input.type
        ].toLowerCase()} recorded for you`,
        body: `${input.startDate} → ${input.endDate}${
          input.deductAmount
            ? ` · ${formatMoney(input.deductAmount)} comes off that month's pay`
            : ""
        }`,
      });
    }
    return row!;
  });
}

/** Undo a mistake. Refused once the days have been paid out on a payslip. */
export async function deleteLeave(actor: Actor, id: string) {
  await db.transaction(async (tx) => {
    const charged = await tx
      .select({ payslipId: payslips.id, status: payslips.status })
      .from(payrollAdjustments)
      .innerJoin(payslips, eq(payrollAdjustments.payslipId, payslips.id))
      .where(eq(payrollAdjustments.leaveRequestId, id));
    if (charged.some((c) => c.status === "paid")) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "These days were already deducted on a paid payslip",
      });
    }
    await tx.delete(payrollAdjustments).where(eq(payrollAdjustments.leaveRequestId, id));
    const [row] = await tx.delete(leaveRequests).where(eq(leaveRequests.id, id)).returning();
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    // the draft payslips that were carrying the deduction owe that money back
    for (const slipId of new Set(charged.map((c) => c.payslipId))) {
      await recomputeNet(tx, slipId);
    }
    await logActivity(tx, {
      actorId: actor.id,
      entityType: "leave",
      entityId: id,
      action: "deleted",
      detail: { for: row.userId, days: row.days },
    });
  });
}

/** The team's year at a glance: what each person has left and what's booked. */
export async function teamLeave(input: { year: number }) {
  const people = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(eq(user.banned, false))
    .orderBy(asc(user.name));
  const ids = people.map((p) => p.id);
  const used = await usedDaysByType(db, ids, input.year);

  const allowances = ids.length
    ? await db
        .select()
        .from(leaveAllowances)
        .where(and(inArray(leaveAllowances.userId, ids), eq(leaveAllowances.year, input.year)))
    : [];

  const today = todayISO(env.TZ_BUSINESS);
  const booked = ids.length
    ? await db
        .select({
          id: leaveRequests.id,
          userId: leaveRequests.userId,
          type: leaveRequests.type,
          startDate: leaveRequests.startDate,
          endDate: leaveRequests.endDate,
          days: leaveRequests.days,
          status: leaveRequests.status,
        })
        .from(leaveRequests)
        .where(
          and(
            inArray(leaveRequests.userId, ids),
            inArray(leaveRequests.status, ["approved", "pending"]),
            gte(leaveRequests.endDate, today),
          ),
        )
        .orderBy(asc(leaveRequests.startDate))
    : [];

  return people.map((person) => {
    const row = allowances.find((a) => a.userId === person.id);
    const allowance = row
      ? { annual: row.annualDays, casual: row.casualDays, sick: row.sickDays }
      : { ...DEFAULT_ALLOWANCE };
    return {
      ...person,
      allowance,
      customAllowance: Boolean(row),
      balance: leaveBalance(allowance, used.get(person.id) ?? {}),
      upcoming: booked
        .filter((b) => b.userId === person.id)
        .map((b) => ({ ...b, type: b.type as LeaveType })),
      offToday: booked.some(
        (b) => b.status === "approved" && b.startDate <= today && b.endDate >= today,
      ),
    };
  });
}

export async function setAllowance(
  actor: Actor,
  input: { userId: string; year: number; annualDays: number; casualDays: number; sickDays: number },
) {
  await db
    .insert(leaveAllowances)
    .values({
      userId: input.userId,
      year: input.year,
      annualDays: input.annualDays,
      casualDays: input.casualDays,
      sickDays: input.sickDays,
      updatedBy: actor.id,
    })
    .onConflictDoUpdate({
      target: [leaveAllowances.userId, leaveAllowances.year],
      set: {
        annualDays: input.annualDays,
        casualDays: input.casualDays,
        sickDays: input.sickDays,
        updatedBy: actor.id,
        updatedAt: new Date(),
      },
    });
  await logActivity(db, {
    actorId: actor.id,
    entityType: "user",
    entityId: input.userId,
    action: "allowance_changed",
    detail: { ...input },
  });
}

/**
 * Who is off between two dates. Deliberately thin — names, dates and type, no
 * reasons — because the whole team reads it on the calendar to plan around
 * each other.
 */
export async function leaveCalendar(input: { from: string; to: string }) {
  return db
    .select({
      id: leaveRequests.id,
      userId: leaveRequests.userId,
      userName: user.name,
      type: leaveRequests.type,
      startDate: leaveRequests.startDate,
      endDate: leaveRequests.endDate,
    })
    .from(leaveRequests)
    .innerJoin(user, eq(leaveRequests.userId, user.id))
    .where(
      and(
        eq(leaveRequests.status, "approved"),
        lte(leaveRequests.startDate, input.to),
        gte(leaveRequests.endDate, input.from),
      ),
    )
    .orderBy(asc(leaveRequests.startDate));
}

// ---------------------------------------------------------------------------
// Salaries
// ---------------------------------------------------------------------------

/** The salary in force on a date — a raise is a new row, never an overwrite. */
async function salaryOn(tx: Tx, userId: string, dateISO: string) {
  const [row] = await tx
    .select()
    .from(salaries)
    .where(and(eq(salaries.userId, userId), lte(salaries.effectiveFrom, dateISO)))
    .orderBy(desc(salaries.effectiveFrom))
    .limit(1);
  return row ?? null;
}

async function currentSalary(tx: Tx, userId: string) {
  return salaryOn(tx, userId, todayISO(env.TZ_BUSINESS));
}

export async function listSalaries() {
  const people = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(eq(user.banned, false))
    .orderBy(asc(user.name));

  const today = todayISO(env.TZ_BUSINESS);
  const rows = await db
    .select()
    .from(salaries)
    .where(lte(salaries.effectiveFrom, today))
    .orderBy(desc(salaries.effectiveFrom));
  const upcoming = await db
    .select()
    .from(salaries)
    .where(sql`${salaries.effectiveFrom} > ${today}`)
    .orderBy(asc(salaries.effectiveFrom));

  return people.map((person) => {
    const current = rows.find((r) => r.userId === person.id);
    const next = upcoming.find((r) => r.userId === person.id);
    return {
      ...person,
      monthlyAmount: current ? Number(current.monthlyAmount) : null,
      effectiveFrom: current?.effectiveFrom ?? null,
      upcoming: next ? { amount: Number(next.monthlyAmount), from: next.effectiveFrom } : null,
    };
  });
}

/**
 * Set (or change) someone's monthly pay. Any old recurring "salary" line for
 * the same person is paused on the spot — payroll posts the salary now, and
 * two systems posting the same wage would quietly double the books.
 */
export async function setSalary(
  actor: Actor,
  input: { userId: string; monthlyAmount: number; effectiveFrom: string; note?: string },
) {
  return db.transaction(async (tx) => {
    await tx
      .insert(salaries)
      .values({
        userId: input.userId,
        monthlyAmount: String(input.monthlyAmount),
        effectiveFrom: input.effectiveFrom,
        note: input.note ?? null,
        createdBy: actor.id,
      })
      .onConflictDoUpdate({
        target: [salaries.userId, salaries.effectiveFrom],
        set: { monthlyAmount: String(input.monthlyAmount), note: input.note ?? null },
      });

    const paused = await tx
      .update(recurringExpenses)
      .set({ active: false })
      .where(and(eq(recurringExpenses.userId, input.userId), eq(recurringExpenses.active, true)))
      .returning({ id: recurringExpenses.id, name: recurringExpenses.name });

    await logActivity(tx, {
      actorId: actor.id,
      entityType: "user",
      entityId: input.userId,
      action: "salary_set",
      detail: {
        amount: input.monthlyAmount,
        from: input.effectiveFrom,
        pausedRecurring: paused.map((p) => p.name),
      },
    });
    return { pausedRecurring: paused.map((p) => p.name) };
  });
}

/** One person's pay file: every raise, every payslip. */
export async function personPay(userId: string) {
  const [person] = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(eq(user.id, userId));
  if (!person) throw new TRPCError({ code: "NOT_FOUND" });
  const history = await db
    .select()
    .from(salaries)
    .where(eq(salaries.userId, userId))
    .orderBy(desc(salaries.effectiveFrom));
  return {
    person,
    history: history.map((h) => ({ ...h, monthlyAmount: Number(h.monthlyAmount) })),
    payslips: await payslipsWithLines(db, eq(payslips.userId, userId)),
  };
}

// ---------------------------------------------------------------------------
// Payroll
// ---------------------------------------------------------------------------

function periodBounds(period: string) {
  const [y, m] = period.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: `${period}-01`, last: `${period}-${String(last).padStart(2, "0")}` };
}

/** Payslips plus their lines, in one round trip per call site. */
async function payslipsWithLines(tx: Tx, where: SQL | undefined) {
  const slips = await tx
    .select()
    .from(payslips)
    .where(where)
    .orderBy(desc(payslips.period))
    .limit(36);
  if (slips.length === 0) return [];
  const lines = await tx
    .select()
    .from(payrollAdjustments)
    .where(
      inArray(
        payrollAdjustments.payslipId,
        slips.map((s) => s.id),
      ),
    )
    .orderBy(asc(payrollAdjustments.createdAt));
  return slips.map((slip) => ({
    ...slip,
    baseAmount: Number(slip.baseAmount),
    netAmount: Number(slip.netAmount),
    adjustments: lines
      .filter((l) => l.payslipId === slip.id)
      .map((l) => ({
        id: l.id,
        kind: l.kind as AdjustmentKind,
        amount: Number(l.amount),
        note: l.note,
        leaveRequestId: l.leaveRequestId,
      })),
  }));
}

/** The month's payroll as it stands, whether or not it has been prepared. */
export async function payroll(input: { period: string }) {
  const { last } = periodBounds(input.period);
  const people = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(eq(user.banned, false))
    .orderBy(asc(user.name));

  const slips = await payslipsWithLines(db, eq(payslips.period, input.period));
  const rows = await Promise.all(
    people.map(async (person) => {
      const salary = await salaryOn(db, person.id, last);
      const slip = slips.find((s) => s.userId === person.id) ?? null;
      return {
        userId: person.id,
        name: person.name,
        monthlyAmount: salary ? Number(salary.monthlyAmount) : null,
        payslip: slip,
      };
    }),
  );

  const payable = rows.filter((r) => r.monthlyAmount !== null || r.payslip);
  return {
    period: input.period,
    label: periodLabel(input.period),
    rows: payable,
    prepared: payable.some((r) => r.payslip !== null),
    totalNet: payable.reduce(
      (sum, r) => sum + (r.payslip ? r.payslip.netAmount : (r.monthlyAmount ?? 0)),
      0,
    ),
    totalPaid: payable.reduce(
      (sum, r) => sum + (r.payslip?.status === "paid" ? r.payslip.netAmount : 0),
      0,
    ),
    unpaidCount: payable.filter((r) => !r.payslip || r.payslip.status === "draft").length,
  };
}

/**
 * Materialize the month: a draft payslip per person on a salary, with the
 * unpaid days the owner marked already charged against it. Safe to run twice —
 * existing drafts keep their edits, paid slips are never touched.
 */
export async function preparePayroll(actor: Actor, input: { period: string }) {
  const { first, last } = periodBounds(input.period);

  return db.transaction(async (tx) => {
    const people = await tx
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(eq(user.banned, false));

    let created = 0;
    let charged = 0;

    for (const person of people) {
      const salary = await salaryOn(tx, person.id, last);
      if (!salary) continue;

      const [existing] = await tx
        .select()
        .from(payslips)
        .where(and(eq(payslips.userId, person.id), eq(payslips.period, input.period)));
      if (existing?.status === "paid") continue;

      let slip = existing;
      if (!slip) {
        const [row] = await tx
          .insert(payslips)
          .values({
            userId: person.id,
            period: input.period,
            baseAmount: salary.monthlyAmount,
            netAmount: salary.monthlyAmount,
            status: "draft",
            createdBy: actor.id,
          })
          .returning();
        slip = row!;
        created += 1;
        await logActivity(tx, {
          actorId: actor.id,
          entityType: "payslip",
          entityId: slip.id,
          action: "created",
          detail: { period: input.period, base: Number(salary.monthlyAmount), for: person.id },
        });
      }

      // Approved days off that the owner said should come off pay, for leave
      // starting inside this month and not already charged to this payslip.
      const deductible = await tx
        .select()
        .from(leaveRequests)
        .where(
          and(
            eq(leaveRequests.userId, person.id),
            eq(leaveRequests.status, "approved"),
            gte(leaveRequests.startDate, first),
            lte(leaveRequests.startDate, last),
            sql`${leaveRequests.deductFromSalary} IS NOT NULL`,
          ),
        );
      for (const leave of deductible) {
        const inserted = await tx
          .insert(payrollAdjustments)
          .values({
            payslipId: slip.id,
            kind: "leave_deduction",
            amount: leave.deductFromSalary!,
            // the span, never a day count — the amount is the owner's figure
            // and may cover fewer days than the leave itself
            note: `${LEAVE_TYPE_LABELS[leave.type as LeaveType]} · ${leave.startDate}${
              leave.endDate === leave.startDate ? "" : ` → ${leave.endDate}`
            }`,
            leaveRequestId: leave.id,
            createdBy: actor.id,
          })
          .onConflictDoNothing()
          .returning();
        charged += inserted.length;
      }

      await recomputeNet(tx, slip.id);
    }

    return { created, charged };
  });
}

export async function addAdjustment(
  actor: Actor,
  input: { payslipId: string; kind: AdjustmentKind; amount: number; note?: string },
) {
  return db.transaction(async (tx) => {
    await assertDraft(tx, input.payslipId);
    await tx.insert(payrollAdjustments).values({
      payslipId: input.payslipId,
      kind: input.kind,
      amount: String(round2(input.amount)),
      note: input.note ?? null,
      createdBy: actor.id,
    });
    const net = await recomputeNet(tx, input.payslipId);
    await logActivity(tx, {
      actorId: actor.id,
      entityType: "payslip",
      entityId: input.payslipId,
      action: "adjusted",
      detail: { kind: input.kind, amount: input.amount, note: input.note },
    });
    return { net };
  });
}

export async function removeAdjustment(actor: Actor, id: string) {
  return db.transaction(async (tx) => {
    const [line] = await tx.select().from(payrollAdjustments).where(eq(payrollAdjustments.id, id));
    if (!line) throw new TRPCError({ code: "NOT_FOUND" });
    await assertDraft(tx, line.payslipId);
    await tx.delete(payrollAdjustments).where(eq(payrollAdjustments.id, id));
    const net = await recomputeNet(tx, line.payslipId);
    await logActivity(tx, {
      actorId: actor.id,
      entityType: "payslip",
      entityId: line.payslipId,
      action: "adjustment_removed",
      detail: { kind: line.kind, amount: line.amount },
    });
    return { net };
  });
}

/**
 * Paying is the point where HR touches the books: the net figure posts itself
 * as an approved overhead expense under "Salaries", and the payslip keeps the
 * id of that expense so the two can always be reconciled.
 */
export async function markPaid(actor: Actor, input: { payslipId: string; paidOn?: string }) {
  const paidOn = input.paidOn ?? todayISO(env.TZ_BUSINESS);

  return db.transaction(async (tx) => {
    const slip = await assertDraft(tx, input.payslipId);
    const net = await recomputeNet(tx, slip.id);
    const [person] = await tx
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, slip.userId));

    const categoryId = await salaryCategoryId(tx);
    const [expense] = await tx
      .insert(expenses)
      .values({
        projectId: null,
        categoryId,
        amount: String(net),
        spentOn: paidOn,
        note: `Salary — ${person?.name ?? "team member"} — ${periodLabel(slip.period)}`,
        status: "approved",
        decidedBy: actor.id,
        decidedAt: new Date(),
        createdBy: actor.id,
      })
      .returning();

    await tx
      .update(payslips)
      .set({
        status: "paid",
        paidOn,
        paidBy: actor.id,
        paidAt: new Date(),
        expenseId: expense!.id,
      })
      .where(eq(payslips.id, slip.id));

    await logActivity(tx, {
      actorId: actor.id,
      entityType: "payslip",
      entityId: slip.id,
      action: "paid",
      detail: { period: slip.period, net, for: slip.userId },
    });
    await notifyUser(tx, slip.userId, {
      type: "payslip_paid",
      title: `${periodLabel(slip.period)} salary paid — ${formatMoney(net)}`,
      body: "Your payslip is on your Time off & pay screen.",
    });
    return { net };
  });
}

/** Drafts only — a paid payslip is evidence and stays put. */
export async function deletePayslip(actor: Actor, id: string) {
  return db.transaction(async (tx) => {
    const slip = await assertDraft(tx, id);
    await tx.delete(payslips).where(eq(payslips.id, id));
    await logActivity(tx, {
      actorId: actor.id,
      entityType: "payslip",
      entityId: id,
      action: "deleted",
      detail: { period: slip.period, for: slip.userId },
    });
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function assertDraft(tx: Tx, payslipId: string) {
  const [slip] = await tx.select().from(payslips).where(eq(payslips.id, payslipId));
  if (!slip) throw new TRPCError({ code: "NOT_FOUND" });
  if (slip.status === "paid") {
    throw new TRPCError({ code: "CONFLICT", message: "This payslip is already paid" });
  }
  return slip;
}

async function recomputeNet(tx: Tx, payslipId: string): Promise<number> {
  const [slip] = await tx.select().from(payslips).where(eq(payslips.id, payslipId));
  if (!slip) throw new TRPCError({ code: "NOT_FOUND" });
  const lines = await tx
    .select({ kind: payrollAdjustments.kind, amount: payrollAdjustments.amount })
    .from(payrollAdjustments)
    .where(eq(payrollAdjustments.payslipId, payslipId));
  const net = payslipNet(
    slip.baseAmount,
    lines.map((l) => ({ kind: l.kind as AdjustmentKind, amount: l.amount })),
  );
  await tx.update(payslips).set({ netAmount: String(net) }).where(eq(payslips.id, payslipId));
  return net;
}

async function salaryCategoryId(tx: Tx): Promise<string> {
  const [existing] = await tx
    .select({ id: expenseCategories.id })
    .from(expenseCategories)
    .where(eq(expenseCategories.name, SALARY_CATEGORY));
  if (existing) return existing.id;
  const [created] = await tx
    .insert(expenseCategories)
    .values({ name: SALARY_CATEGORY })
    .returning({ id: expenseCategories.id });
  return created!.id;
}

function assertSpan(startDate: string, endDate: string): number {
  const days = leaveDays(startDate, endDate);
  if (days < 1) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "The last day can't be before the first" });
  }
  if (days > 90) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "That's longer than three months" });
  }
  return days;
}

/** Two overlapping requests would double-count the same day off the balance. */
async function assertNoOverlap(
  tx: Tx,
  userId: string,
  startDate: string,
  endDate: string,
  exceptId?: string,
) {
  const clashes = await tx
    .select({ id: leaveRequests.id, startDate: leaveRequests.startDate })
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.userId, userId),
        inArray(leaveRequests.status, ["pending", "approved"]),
        lte(leaveRequests.startDate, endDate),
        gte(leaveRequests.endDate, startDate),
        exceptId ? ne(leaveRequests.id, exceptId) : undefined,
      ),
    );
  if (clashes.length > 0) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Those days overlap time off that is already booked",
    });
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
