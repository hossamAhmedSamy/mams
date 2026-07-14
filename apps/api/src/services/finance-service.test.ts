import { schema } from "@mams/db";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "../db";
import * as financeService from "./finance-service";
import * as projectService from "./project-service";
import { makeClient, makeUser, notificationsFor, type TestActor } from "../test/helpers";

let adham: TestActor;
let hazem: TestActor;
let sama: TestActor;
let projectId: string;
let categoryId: string;

beforeAll(async () => {
  adham = await makeUser("FinAdmin", "admin");
  hazem = await makeUser("FinHazem", "member");
  sama = await makeUser("FinSama", "member");
  const client = await makeClient();
  const project = await projectService.createProject(adham, {
    clientId: client.id,
    title: "Finance test project",
    priority: "medium",
    budget: 20000,
  });
  projectId = project.id;
  const [cat] = await db
    .select()
    .from(schema.expenseCategories)
    .where(eq(schema.expenseCategories.name, "Equipment rental"));
  categoryId = cat!.id;
});

describe("expense request → decision flow", () => {
  it("member requests, admin is notified, approval counts in the ledger", async () => {
    const req = await financeService.requestExpense(hazem, {
      projectId,
      categoryId,
      amount: 3000,
      spentOn: "2026-07-14",
      note: "Rented 85mm lens for the shoot",
    });
    expect(req.status).toBe("pending");
    expect(
      (await notificationsFor(adham.id)).some((n) => n.type === "expense_requested"),
    ).toBe(true);

    let ledger = await financeService.projectLedger(projectId);
    expect(ledger.spent).toBe(0); // pending doesn't count
    expect(ledger.pendingAmount).toBe(3000);

    await financeService.decideExpense(adham, { id: req.id, approve: true });
    ledger = await financeService.projectLedger(projectId);
    expect(ledger.spent).toBe(3000);
    expect(ledger.remainingBudget).toBe(17000); // 20000 budget
    expect(
      (await notificationsFor(hazem.id)).some((n) => n.type === "expense_decided"),
    ).toBe(true);
  });

  it("rejection keeps money out of the ledger and tells the requester why", async () => {
    const req = await financeService.requestExpense(hazem, {
      projectId,
      categoryId,
      amount: 999,
      spentOn: "2026-07-14",
      note: "Extra batteries",
    });
    await financeService.decideExpense(adham, { id: req.id, approve: false, note: "Use the studio's" });
    const ledger = await financeService.projectLedger(projectId);
    expect(ledger.spent).toBe(3000); // unchanged
    const mine = await financeService.myExpenses(hazem.id);
    const rejected = mine.find((e) => e.id === req.id);
    expect(rejected?.status).toBe("rejected");
    expect(rejected?.decisionNote).toBe("Use the studio's");
  });

  it("a decision can't be made twice", async () => {
    const req = await financeService.requestExpense(sama, {
      categoryId,
      amount: 100,
      spentOn: "2026-07-14",
      note: "Transport to location",
    });
    await financeService.decideExpense(adham, { id: req.id, approve: true });
    await expect(
      financeService.decideExpense(adham, { id: req.id, approve: false }),
    ).rejects.toThrow();
  });

  it("member can cancel only their own pending request", async () => {
    const req = await financeService.requestExpense(sama, {
      categoryId,
      amount: 50,
      spentOn: "2026-07-14",
      note: "Parking fees",
    });
    await expect(financeService.cancelMyRequest(hazem, req.id)).rejects.toThrow(); // not hers
    await financeService.cancelMyRequest(sama, req.id);
    const mine = await financeService.myExpenses(sama.id);
    expect(mine.some((e) => e.id === req.id)).toBe(false);
  });

  it("income minus approved spend = profit", async () => {
    await financeService.addIncome(adham, {
      projectId,
      amount: 15000,
      receivedOn: "2026-07-10",
    });
    const ledger = await financeService.projectLedger(projectId);
    expect(ledger.income).toBe(15000);
    expect(ledger.profit).toBe(12000); // 15000 - 3000
  });
});

describe("recurring expenses (salaries etc.)", () => {
  it("posts once per month, idempotently, as approved overhead", async () => {
    const [salaryCat] = await db
      .select()
      .from(schema.expenseCategories)
      .where(eq(schema.expenseCategories.name, "Freelancer fees"));
    await financeService.createRecurring(adham, {
      name: "Salary — FinHazem",
      amount: 8000,
      categoryId: salaryCat!.id,
      dayOfMonth: 1,
      userId: hazem.id,
    });

    const first = await financeService.postDueRecurring();
    expect(first).toBeGreaterThanOrEqual(1);
    const again = await financeService.postDueRecurring();
    expect(again).toBe(0); // same period → nothing to post

    const posted = await db
      .select()
      .from(schema.expenses)
      .where(eq(schema.expenses.note, "Salary — FinHazem"));
    expect(posted).toHaveLength(1);
    expect(posted[0]!.status).toBe("approved");
    expect(posted[0]!.projectId).toBeNull(); // overhead, not project spend
  });
});
