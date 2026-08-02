import { schema } from "@mams/db";
import { leaveBalance, leaveDays, payslipNet } from "@mams/shared";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "../db";
import { makeUser, notificationsFor, type TestActor } from "../test/helpers";
import * as hrService from "./hr-service";

let adham: TestActor;
let mariam: TestActor;
let youssef: TestActor;

const YEAR = new Date().getUTCFullYear();
const d = (month: number, day: number) =>
  `${YEAR}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

beforeAll(async () => {
  adham = await makeUser("HrAdham", "admin");
  mariam = await makeUser("HrMariam", "member");
  youssef = await makeUser("HrYoussef", "member");
});

describe("leave arithmetic", () => {
  it("counts calendar days inclusively", () => {
    expect(leaveDays("2026-08-10", "2026-08-10")).toBe(1);
    expect(leaveDays("2026-08-10", "2026-08-14")).toBe(5);
    expect(leaveDays("2026-12-30", "2027-01-02")).toBe(4);
  });

  it("takes casual days out of the same annual pool", () => {
    const balance = leaveBalance({ annual: 21, casual: 7, sick: 15 }, { annual: 4, casual: 2 });
    expect(balance.annual.used).toBe(6);
    expect(balance.annual.left).toBe(15);
    expect(balance.casual.left).toBe(5);
    expect(balance.sick.left).toBe(15);
  });

  it("caps casual by whatever annual has left, not just its own cap", () => {
    const balance = leaveBalance({ annual: 21, casual: 7, sick: 15 }, { annual: 18, casual: 1 });
    expect(balance.annual.left).toBe(2);
    expect(balance.casual.left).toBe(2); // 6 casual days remain, but only 2 annual do
  });
});

describe("request → decision flow", () => {
  it("a request notifies the owner and reserves nothing until approved", async () => {
    const req = await hrService.requestLeave(mariam, {
      type: "annual",
      startDate: d(3, 2),
      endDate: d(3, 4),
      reason: "Family wedding",
    });
    expect(req.status).toBe("pending");
    expect(req.days).toBe(3);
    expect((await notificationsFor(adham.id)).some((n) => n.type === "leave_requested")).toBe(true);

    const before = await hrService.balanceFor(db, mariam.id, YEAR);
    expect(before.annual.used).toBe(0); // pending reserves nothing

    await hrService.decideLeave(adham, { id: req.id, approve: true, note: "Enjoy it" });
    const after = await hrService.balanceFor(db, mariam.id, YEAR);
    expect(after.annual.used).toBe(3);
    expect(after.annual.left).toBe(18);
    expect((await notificationsFor(mariam.id)).some((n) => n.type === "leave_decided")).toBe(true);
  });

  it("a rejection costs no balance and carries the reason back", async () => {
    const req = await hrService.requestLeave(mariam, {
      type: "annual",
      startDate: d(4, 1),
      endDate: d(4, 2),
    });
    await hrService.decideLeave(adham, {
      id: req.id,
      approve: false,
      note: "We're shooting that week",
    });
    const balance = await hrService.balanceFor(db, mariam.id, YEAR);
    expect(balance.annual.used).toBe(3); // unchanged

    const mine = await hrService.myHr(mariam.id);
    const rejected = mine.requests.find((r) => r.id === req.id);
    expect(rejected?.status).toBe("rejected");
    expect(rejected?.decisionNote).toBe("We're shooting that week");
  });

  it("refuses days that overlap time off already booked", async () => {
    await expect(
      hrService.requestLeave(mariam, { type: "casual", startDate: d(3, 4), endDate: d(3, 5) }),
    ).rejects.toThrow(/overlap/i);
  });

  it("can't be decided twice", async () => {
    const req = await hrService.requestLeave(youssef, {
      type: "sick",
      startDate: d(5, 6),
      endDate: d(5, 6),
    });
    await hrService.decideLeave(adham, { id: req.id, approve: true });
    await expect(
      hrService.decideLeave(adham, { id: req.id, approve: false }),
    ).rejects.toThrow(/already decided/i);
  });

  it("a member withdraws only their own pending request", async () => {
    const req = await hrService.requestLeave(youssef, {
      type: "annual",
      startDate: d(6, 1),
      endDate: d(6, 2),
    });
    await expect(hrService.cancelMyLeave(mariam, req.id)).rejects.toThrow();
    await hrService.cancelMyLeave(youssef, req.id);
    const mine = await hrService.myHr(youssef.id);
    expect(mine.requests.find((r) => r.id === req.id)?.status).toBe("canceled");
  });

  it("the owner logs leave directly, already approved", async () => {
    const row = await hrService.logLeave(adham, {
      userId: youssef.id,
      type: "casual",
      startDate: d(7, 20),
      endDate: d(7, 20),
      reason: "Called in the morning",
    });
    expect(row.status).toBe("approved");
    const balance = await hrService.balanceFor(db, youssef.id, YEAR);
    expect(balance.casual.used).toBe(1);
    expect(balance.annual.used).toBe(1); // casual comes out of annual too
  });
});

describe("payroll", () => {
  const period = `${YEAR}-09`;

  beforeAll(async () => {
    await hrService.setSalary(adham, {
      userId: mariam.id,
      monthlyAmount: 9000,
      effectiveFrom: d(1, 1),
    });
    await hrService.setSalary(adham, {
      userId: youssef.id,
      monthlyAmount: 6000,
      effectiveFrom: d(1, 1),
    });
  });

  it("nets the base against its adjustments", () => {
    expect(
      payslipNet(9000, [
        { kind: "bonus", amount: 500 },
        { kind: "advance", amount: 1000 },
        { kind: "leave_deduction", amount: 300 },
      ]),
    ).toBe(8200);
    expect(payslipNet(1000, [{ kind: "deduction", amount: 5000 }])).toBe(0); // never negative
  });

  it("prepares a draft per salaried person and charges deducted leave once", async () => {
    await hrService.logLeave(adham, {
      userId: mariam.id,
      type: "unpaid",
      startDate: `${period}-10`,
      endDate: `${period}-10`,
      deductAmount: 300,
    });

    const first = await hrService.preparePayroll(adham, { period });
    expect(first.created).toBeGreaterThanOrEqual(2);
    expect(first.charged).toBe(1);

    // preparing twice is harmless — no duplicate slips, no double charge
    const again = await hrService.preparePayroll(adham, { period });
    expect(again.created).toBe(0);
    expect(again.charged).toBe(0);

    const run = await hrService.payroll({ period });
    const hers = run.rows.find((r) => r.userId === mariam.id)!;
    expect(hers.payslip?.baseAmount).toBe(9000);
    expect(hers.payslip?.netAmount).toBe(8700); // 9000 − 300 unpaid day
    expect(hers.payslip?.adjustments).toHaveLength(1);
  });

  it("bonuses and advances move the net, and can be taken back off", async () => {
    const run = await hrService.payroll({ period });
    const slip = run.rows.find((r) => r.userId === youssef.id)!.payslip!;

    await hrService.addAdjustment(adham, {
      payslipId: slip.id,
      kind: "bonus",
      amount: 500,
      note: "Kuja delivery",
    });
    let after = await hrService.payroll({ period });
    let his = after.rows.find((r) => r.userId === youssef.id)!.payslip!;
    expect(his.netAmount).toBe(6500);

    await hrService.removeAdjustment(adham, his.adjustments[0]!.id);
    after = await hrService.payroll({ period });
    his = after.rows.find((r) => r.userId === youssef.id)!.payslip!;
    expect(his.netAmount).toBe(6000);
  });

  it("paying posts the net into the books and freezes the payslip", async () => {
    const run = await hrService.payroll({ period });
    const slip = run.rows.find((r) => r.userId === mariam.id)!.payslip!;

    const { net } = await hrService.markPaid(adham, {
      payslipId: slip.id,
      paidOn: `${period}-28`,
    });
    expect(net).toBe(8700);

    const [paid] = await db.select().from(schema.payslips).where(eq(schema.payslips.id, slip.id));
    expect(paid!.status).toBe("paid");
    expect(paid!.expenseId).not.toBeNull();

    const [expense] = await db
      .select()
      .from(schema.expenses)
      .where(eq(schema.expenses.id, paid!.expenseId!));
    expect(Number(expense!.amount)).toBe(8700);
    expect(expense!.status).toBe("approved");
    expect(expense!.projectId).toBeNull(); // overhead, not project spend

    // a paid payslip is evidence: no more edits
    await expect(
      hrService.addAdjustment(adham, { payslipId: slip.id, kind: "bonus", amount: 100 }),
    ).rejects.toThrow(/already paid/i);
    expect((await notificationsFor(mariam.id)).some((n) => n.type === "payslip_paid")).toBe(true);
  });

  it("only paid payslips reach the person they belong to", async () => {
    const mine = await hrService.myHr(mariam.id);
    expect(mine.salary?.monthlyAmount).toBe(9000);
    expect(mine.payslips).toHaveLength(1);
    expect(mine.payslips[0]!.netAmount).toBe(8700);

    const his = await hrService.myHr(youssef.id);
    expect(his.payslips).toHaveLength(0); // still a draft
  });

  it("setting a salary pauses the old recurring line so pay isn't posted twice", async () => {
    const [category] = await db
      .select()
      .from(schema.expenseCategories)
      .where(eq(schema.expenseCategories.name, "Salaries"));
    await db.insert(schema.recurringExpenses).values({
      name: "Salary — HrYoussef (old)",
      amount: "6000",
      categoryId: category!.id,
      dayOfMonth: 1,
      userId: youssef.id,
    });

    const { pausedRecurring } = await hrService.setSalary(adham, {
      userId: youssef.id,
      monthlyAmount: 6500,
      effectiveFrom: d(10, 1),
    });
    expect(pausedRecurring).toContain("Salary — HrYoussef (old)");
    const still = await db
      .select()
      .from(schema.recurringExpenses)
      .where(
        and(
          eq(schema.recurringExpenses.userId, youssef.id),
          eq(schema.recurringExpenses.active, true),
        ),
      );
    expect(still).toHaveLength(0);
  });
});
