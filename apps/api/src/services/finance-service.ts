import { schema } from "@mams/db";
import { formatMoney } from "@mams/shared";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { env } from "../env";
import { todayISO } from "../lib/time";
import { logActivity } from "./activity";
import { notifyAdmins, notifyUser } from "./notify";

const { expenses, incomes, expenseCategories, recurringExpenses, projects, clients, user } = schema;

type Actor = { id: string; role: "admin" | "member"; name: string };

// ---------------------------------------------------------------------------
// Member: request an expense, see own requests
// ---------------------------------------------------------------------------

export async function requestExpense(
  actor: Actor,
  input: {
    projectId?: string;
    categoryId: string;
    amount: number;
    spentOn: string;
    note: string;
    vendor?: string;
    receiptLink?: string;
  },
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(expenses)
      .values({
        projectId: input.projectId ?? null,
        categoryId: input.categoryId,
        amount: String(input.amount),
        spentOn: input.spentOn,
        note: input.note,
        vendor: input.vendor ?? null,
        receiptLink: input.receiptLink ?? null,
        status: "pending",
        createdBy: actor.id,
      })
      .returning();
    await logActivity(tx, {
      actorId: actor.id,
      entityType: "expense",
      entityId: row!.id,
      action: "requested",
      detail: { amount: input.amount },
    });
    await notifyAdmins(
      tx,
      {
        type: "expense_requested",
        title: `${actor.name} requests ${formatMoney(input.amount)}`,
        body: input.note,
      },
      actor.id,
    );
    return row!;
  });
}

export async function myExpenses(actorId: string) {
  return db
    .select({
      id: expenses.id,
      amount: expenses.amount,
      spentOn: expenses.spentOn,
      note: expenses.note,
      status: expenses.status,
      decisionNote: expenses.decisionNote,
      categoryName: expenseCategories.name,
      projectTitle: projects.title,
      createdAt: expenses.createdAt,
    })
    .from(expenses)
    .innerJoin(expenseCategories, eq(expenses.categoryId, expenseCategories.id))
    .leftJoin(projects, eq(expenses.projectId, projects.id))
    .where(eq(expenses.createdBy, actorId))
    .orderBy(desc(expenses.createdAt))
    .limit(100);
}

/** A member may cancel their own still-pending request. */
export async function cancelMyRequest(actor: Actor, id: string) {
  const [row] = await db
    .delete(expenses)
    .where(and(eq(expenses.id, id), eq(expenses.createdBy, actor.id), eq(expenses.status, "pending")))
    .returning();
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "No pending request to cancel" });
}

// ---------------------------------------------------------------------------
// Admin: decide, record, ledger, overview
// ---------------------------------------------------------------------------

export async function decideExpense(
  actor: Actor,
  input: { id: string; approve: boolean; note?: string },
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(expenses)
      .set({
        status: input.approve ? "approved" : "rejected",
        decidedBy: actor.id,
        decidedAt: new Date(),
        decisionNote: input.note ?? null,
      })
      .where(and(eq(expenses.id, input.id), eq(expenses.status, "pending")))
      .returning();
    if (!row) throw new TRPCError({ code: "CONFLICT", message: "Request already decided" });
    await logActivity(tx, {
      actorId: actor.id,
      entityType: "expense",
      entityId: row.id,
      action: input.approve ? "approved" : "rejected",
      detail: { note: input.note },
    });
    if (row.createdBy && row.createdBy !== actor.id) {
      await notifyUser(tx, row.createdBy, {
        type: "expense_decided",
        title: `${formatMoney(row.amount)} ${input.approve ? "approved ✓" : "rejected"}`,
        body: input.note,
      });
    }
    return row;
  });
}

export async function addExpense(
  actor: Actor,
  input: {
    projectId?: string;
    categoryId: string;
    amount: number;
    spentOn: string;
    note?: string;
    vendor?: string;
    receiptLink?: string;
  },
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(expenses)
      .values({
        projectId: input.projectId ?? null,
        categoryId: input.categoryId,
        amount: String(input.amount),
        spentOn: input.spentOn,
        note: input.note ?? null,
        vendor: input.vendor ?? null,
        receiptLink: input.receiptLink ?? null,
        status: "approved",
        decidedBy: actor.id,
        decidedAt: new Date(),
        createdBy: actor.id,
      })
      .returning();
    await logActivity(tx, {
      actorId: actor.id,
      entityType: "expense",
      entityId: row!.id,
      action: "created",
      detail: { amount: input.amount },
    });
    return row!;
  });
}

export async function deleteExpense(actor: Actor, id: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx.delete(expenses).where(eq(expenses.id, id)).returning();
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    await logActivity(tx, {
      actorId: actor.id,
      entityType: "expense",
      entityId: id,
      action: "deleted",
      detail: { amount: row.amount },
    });
  });
}

export async function addIncome(
  actor: Actor,
  input: { projectId: string; amount: number; receivedOn: string; note?: string },
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(incomes)
      .values({
        projectId: input.projectId,
        amount: String(input.amount),
        receivedOn: input.receivedOn,
        note: input.note ?? null,
        createdBy: actor.id,
      })
      .returning();
    await logActivity(tx, {
      actorId: actor.id,
      entityType: "income",
      entityId: row!.id,
      action: "created",
      detail: { amount: input.amount },
    });
    return row!;
  });
}

export async function deleteIncome(actor: Actor, id: string) {
  const [row] = await db.delete(incomes).where(eq(incomes.id, id)).returning();
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  await logActivity(db, {
    actorId: actor.id,
    entityType: "income",
    entityId: id,
    action: "deleted",
    detail: { amount: row.amount },
  });
}

export async function listPendingRequests() {
  return db
    .select({
      id: expenses.id,
      amount: expenses.amount,
      spentOn: expenses.spentOn,
      note: expenses.note,
      vendor: expenses.vendor,
      receiptLink: expenses.receiptLink,
      categoryName: expenseCategories.name,
      projectTitle: projects.title,
      requesterName: user.name,
      createdAt: expenses.createdAt,
    })
    .from(expenses)
    .innerJoin(expenseCategories, eq(expenses.categoryId, expenseCategories.id))
    .leftJoin(projects, eq(expenses.projectId, projects.id))
    .leftJoin(user, eq(expenses.createdBy, user.id))
    .where(eq(expenses.status, "pending"))
    .orderBy(desc(expenses.createdAt));
}

/** Full ledger for one project: entries + totals + budget position. */
export async function projectLedger(projectId: string) {
  const [project] = await db
    .select({ id: projects.id, title: projects.title, budget: projects.budget })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND" });

  const expenseRows = await db
    .select({
      id: expenses.id,
      amount: expenses.amount,
      spentOn: expenses.spentOn,
      note: expenses.note,
      vendor: expenses.vendor,
      status: expenses.status,
      categoryName: expenseCategories.name,
      requesterName: user.name,
      receiptLink: expenses.receiptLink,
    })
    .from(expenses)
    .innerJoin(expenseCategories, eq(expenses.categoryId, expenseCategories.id))
    .leftJoin(user, eq(expenses.createdBy, user.id))
    .where(eq(expenses.projectId, projectId))
    .orderBy(desc(expenses.spentOn));

  const incomeRows = await db
    .select()
    .from(incomes)
    .where(eq(incomes.projectId, projectId))
    .orderBy(desc(incomes.receivedOn));

  const spent = sum(expenseRows.filter((e) => e.status === "approved").map((e) => e.amount));
  const pendingAmount = sum(expenseRows.filter((e) => e.status === "pending").map((e) => e.amount));
  const income = sum(incomeRows.map((i) => i.amount));
  const budget = project.budget ? Number(project.budget) : null;

  return {
    budget,
    income,
    spent,
    pendingAmount,
    profit: income - spent,
    remainingBudget: budget !== null ? budget - spent : null,
    expenses: expenseRows,
    incomes: incomeRows,
  };
}

/** Admin Money screen: month totals, spend by category, budget vs spend. */
export async function overview(input: { from: string; to: string }) {
  const monthExpenses = await db
    .select({
      amount: expenses.amount,
      projectId: expenses.projectId,
      categoryName: expenseCategories.name,
    })
    .from(expenses)
    .innerJoin(expenseCategories, eq(expenses.categoryId, expenseCategories.id))
    .where(
      and(eq(expenses.status, "approved"), gte(expenses.spentOn, input.from), lte(expenses.spentOn, input.to)),
    );
  const monthIncome = await db
    .select({ amount: incomes.amount })
    .from(incomes)
    .where(and(gte(incomes.receivedOn, input.from), lte(incomes.receivedOn, input.to)));

  const byCategory = new Map<string, number>();
  for (const e of monthExpenses) {
    byCategory.set(e.categoryName, (byCategory.get(e.categoryName) ?? 0) + Number(e.amount));
  }

  // budget position of active projects (all-time spend per project)
  const activeProjects = await db
    .select({
      id: projects.id,
      title: projects.title,
      budget: projects.budget,
      clientName: clients.name,
    })
    .from(projects)
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(eq(projects.status, "active"));
  const projectSpend =
    activeProjects.length === 0
      ? []
      : await db
          .select({
            projectId: expenses.projectId,
            total: sql<string>`SUM(${expenses.amount})`,
          })
          .from(expenses)
          .where(
            and(
              eq(expenses.status, "approved"),
              inArray(
                expenses.projectId,
                activeProjects.map((p) => p.id),
              ),
            ),
          )
          .groupBy(expenses.projectId);

  return {
    totalSpend: sum(monthExpenses.map((e) => e.amount)),
    overheadSpend: sum(monthExpenses.filter((e) => !e.projectId).map((e) => e.amount)),
    totalIncome: sum(monthIncome.map((i) => i.amount)),
    spendByCategory: [...byCategory.entries()]
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total),
    projects: activeProjects.map((p) => ({
      ...p,
      budget: p.budget ? Number(p.budget) : null,
      spent: Number(projectSpend.find((s) => s.projectId === p.id)?.total ?? 0),
    })),
  };
}

// ---------------------------------------------------------------------------
// Recurring (salaries, rent, subscriptions)
// ---------------------------------------------------------------------------

export async function listRecurring() {
  return db
    .select({
      id: recurringExpenses.id,
      name: recurringExpenses.name,
      amount: recurringExpenses.amount,
      dayOfMonth: recurringExpenses.dayOfMonth,
      active: recurringExpenses.active,
      lastPostedPeriod: recurringExpenses.lastPostedPeriod,
      categoryId: recurringExpenses.categoryId,
      categoryName: expenseCategories.name,
      userName: user.name,
    })
    .from(recurringExpenses)
    .innerJoin(expenseCategories, eq(recurringExpenses.categoryId, expenseCategories.id))
    .leftJoin(user, eq(recurringExpenses.userId, user.id))
    .orderBy(recurringExpenses.name);
}

export async function createRecurring(
  actor: Actor,
  input: {
    name: string;
    amount: number;
    categoryId: string;
    dayOfMonth: number;
    userId?: string;
  },
) {
  const [row] = await db
    .insert(recurringExpenses)
    .values({
      name: input.name,
      amount: String(input.amount),
      categoryId: input.categoryId,
      dayOfMonth: input.dayOfMonth,
      userId: input.userId ?? null,
      createdBy: actor.id,
    })
    .returning();
  await logActivity(db, {
    actorId: actor.id,
    entityType: "expense",
    entityId: row!.id,
    action: "recurring_created",
    detail: { name: input.name, amount: input.amount },
  });
  return row!;
}

export async function updateRecurring(
  actor: Actor,
  input: {
    id: string;
    name?: string;
    amount?: number;
    categoryId?: string;
    dayOfMonth?: number;
    active?: boolean;
  },
) {
  const { id, amount, ...fields } = input;
  await db
    .update(recurringExpenses)
    .set({ ...fields, ...(amount !== undefined ? { amount: String(amount) } : {}) })
    .where(eq(recurringExpenses.id, id));
  await logActivity(db, {
    actorId: actor.id,
    entityType: "expense",
    entityId: id,
    action: "recurring_updated",
    detail: { ...fields, amount },
  });
}

/**
 * Posts due recurring items as approved overhead expenses. Called by the daily
 * job. Idempotent per (item, month) via last_posted_period; catches up if the
 * service slept past the posting day.
 */
export async function postDueRecurring(now = new Date()): Promise<number> {
  const today = todayISO(env.TZ_BUSINESS, now);
  const period = today.slice(0, 7); // YYYY-MM
  const dayOfMonth = Number(today.slice(8, 10));
  let posted = 0;

  await db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(recurringExpenses)
      .where(
        and(
          eq(recurringExpenses.active, true),
          lte(recurringExpenses.dayOfMonth, dayOfMonth),
          sql`(${recurringExpenses.lastPostedPeriod} IS NULL OR ${recurringExpenses.lastPostedPeriod} < ${period})`,
        ),
      )
      .for("update", { skipLocked: true });

    for (const item of due) {
      const spentOn = `${period}-${String(item.dayOfMonth).padStart(2, "0")}`;
      const [expense] = await tx
        .insert(expenses)
        .values({
          projectId: null,
          categoryId: item.categoryId,
          amount: item.amount,
          spentOn,
          note: item.name,
          status: "approved",
          recurringId: item.id,
          createdBy: item.createdBy,
        })
        .returning();
      await tx
        .update(recurringExpenses)
        .set({ lastPostedPeriod: period })
        .where(eq(recurringExpenses.id, item.id));
      await logActivity(tx, {
        actorId: null,
        entityType: "expense",
        entityId: expense!.id,
        action: "recurring_posted",
        detail: { name: item.name, period },
      });
      posted += 1;
    }
  });
  return posted;
}

function sum(values: (string | number)[]): number {
  return values.reduce<number>((acc, v) => acc + Number(v), 0);
}
