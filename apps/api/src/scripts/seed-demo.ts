/**
 * Wipes the database and refills it with one coherent week of agency life.
 *
 * The shape it demonstrates is the shape the portal is for: the owner regulates
 * the work (he approves, he decides, he pays) and the crew do it. Every
 * campaign runs the one chain — Shooting → Editing — and the edit comes back to
 * him before it counts as delivered.
 *
 * Usage: pnpm --filter @mams/api seed:demo   [DEMO_PASSWORD=…]
 * Destructive by design; refuses to run against a non-local database unless
 * DEMO_FORCE=1 is set.
 */
import { randomUUID } from "node:crypto";
import { schema } from "@mams/db";
import { seedDomain } from "@mams/db/seed-data";
import type { Permission } from "@mams/shared";
import { eq, sql } from "drizzle-orm";
import { auth } from "../auth";
import { db } from "../db";
import { env } from "../env";
import { addDaysISO, todayISO } from "../lib/time";
import * as financeService from "../services/finance-service";
import * as hrService from "../services/hr-service";
import * as projectService from "../services/project-service";
import * as taskService from "../services/task-service";

const PASSWORD = process.env.DEMO_PASSWORD ?? "mams-demo-2026";
const LOCAL = /localhost|127\.0\.0\.1/.test(env.DATABASE_URL);
if (!LOCAL && process.env.DEMO_FORCE !== "1") {
  console.error(
    "Refusing to wipe a remote database. Set DEMO_FORCE=1 if you really mean it.",
  );
  process.exit(1);
}

const today = todayISO(env.TZ_BUSINESS);
const day = (offset: number) => addDaysISO(today, offset);
const period = (monthsBack: number) => {
  const [y, m] = today.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 - monthsBack, 1)).toISOString().slice(0, 7);
};

type Actor = { id: string; role: "admin" | "member"; name: string; permissions: Permission[] };

// ---------------------------------------------------------------------------
// 1. Empty the place out
// ---------------------------------------------------------------------------

async function wipe() {
  // one statement, so foreign keys never argue about ordering
  await db.execute(sql`
    TRUNCATE TABLE
      payroll_adjustments, payslips, salaries, leave_allowances, leave_requests,
      activity_log, notifications, reminders, comments,
      task_assignees, tasks, incomes, expenses, recurring_expenses, projects, clients,
      template_stages, workflow_templates, stage_skills, stages, user_skills, skills,
      expense_categories, user_permissions, job_runs,
      "session", "account", "verification", "user"
    RESTART IDENTITY CASCADE
  `);
}

// ---------------------------------------------------------------------------
// 2. The people: one owner, and the company
// ---------------------------------------------------------------------------

async function makePerson(input: {
  name: string;
  email: string;
  role: "admin" | "member";
  skills?: string[];
  permissions?: Permission[];
}): Promise<Actor> {
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(PASSWORD);
  const id = randomUUID();

  await db.insert(schema.user).values({
    id,
    name: input.name,
    email: input.email,
    emailVerified: true,
    role: input.role,
    // a demo account you cannot log into is not a demo
    mustChangePassword: false,
  });
  await db.insert(schema.account).values({
    id: randomUUID(),
    accountId: id,
    providerId: "credential",
    userId: id,
    password: hash,
  });

  if (input.skills?.length) {
    const rows = await db.select().from(schema.skills);
    await db.insert(schema.userSkills).values(
      input.skills.map((name) => {
        const skill = rows.find((s) => s.name === name);
        if (!skill) throw new Error(`demo: unknown skill ${name}`);
        return { userId: id, skillId: skill.id };
      }),
    );
  }
  if (input.role === "member" && input.permissions?.length) {
    await db
      .insert(schema.userPermissions)
      .values(input.permissions.map((permission) => ({ userId: id, permission })));
  }

  return {
    id,
    role: input.role,
    name: input.name,
    permissions: input.role === "admin" ? ALL_PERMISSIONS : (input.permissions ?? []),
  };
}

const ALL_PERMISSIONS: Permission[] = [
  "projects.manage",
  "tasks.manage",
  "tasks.assign",
  "tasks.approve",
  "team.viewAll",
  "money.view",
  "money.manage",
  "hr.manage",
  "settings.workflows",
  "settings.team",
];

// ---------------------------------------------------------------------------
// 3. Run it
// ---------------------------------------------------------------------------

async function main() {
  await wipe();
  await seedDomain(db);

  // --- the owner, and everyone who works for him ---------------------------
  const adham = await makePerson({
    name: "Adham",
    email: "adham@mams.local",
    role: "admin", // the owner: every permission, implicitly
  });

  const hazem = await makePerson({
    name: "Hazem Adel",
    email: "hazem@mams.local",
    role: "member",
    skills: ["Videographer"],
    // the one lead: he can see everyone's calendar and put people on a shoot
    permissions: ["team.viewAll", "tasks.assign"],
  });
  const sama = await makePerson({
    name: "Sama Nabil",
    email: "sama@mams.local",
    role: "member",
    skills: ["Photographer", "Videographer"],
  });
  const youssef = await makePerson({
    name: "Youssef Zaki",
    email: "youssef@mams.local",
    role: "member",
    skills: ["Editor"],
  });
  const mariam = await makePerson({
    name: "Mariam Fathy",
    email: "mariam@mams.local",
    role: "member",
    skills: ["Editor"],
  });
  const crew = [hazem, sama, youssef, mariam];

  // --- clients and their campaigns -----------------------------------------
  const clientRows = await db
    .insert(schema.clients)
    .values([
      { name: "Kuja", notes: "Streetwear label. Fast turnarounds, always wants reels." },
      { name: "Nola Bakery", notes: "Monthly menu shoots, plus Ramadan and Eid pushes." },
      { name: "Zeit Café", notes: "Two locations. Photography first, video occasionally." },
      { name: "Amaya Skincare", notes: "Product launches, studio work." },
    ])
    .returning();
  const client = (name: string) => {
    const row = clientRows.find((c) => c.name === name);
    if (!row) throw new Error(`demo: unknown client ${name}`);
    return row.id;
  };

  const [template] = await db
    .select()
    .from(schema.workflowTemplates)
    .where(eq(schema.workflowTemplates.name, "Campaign"));
  if (!template) throw new Error("demo: Campaign template missing");

  /** Every campaign is the same chain; only its position in it differs. */
  async function campaign(input: {
    clientName: string;
    title: string;
    campaign: string;
    budget: number;
    startDate: string;
    dueDate: string;
    shooters: Actor[];
    priority?: "high" | "medium" | "low";
  }) {
    const project = await projectService.createProject(adham, {
      clientId: client(input.clientName),
      title: input.title,
      campaign: input.campaign,
      priority: input.priority ?? "medium",
      startDate: input.startDate,
      dueDate: input.dueDate,
      budget: input.budget,
      workflowTemplateId: template!.id,
      firstAssigneeIds: input.shooters.map((s) => s.id),
    });
    const chain = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.projectId, project.id))
      .orderBy(schema.tasks.chainPosition);
    return { project, shooting: chain[0]!, editing: chain[1]! };
  }

  // 1) Shot and edited, signed off — last month's job, in the books
  const done = await campaign({
    clientName: "Nola Bakery",
    title: "Eid menu",
    campaign: "Eid",
    budget: 45000,
    startDate: day(-26),
    dueDate: day(-14),
    shooters: [sama],
  });
  await taskService.transition(done.shooting.id, "in_progress", sama);
  await taskService.transition(done.shooting.id, "done", sama);
  await taskService.setAssignees(adham, { id: done.editing.id, userIds: [youssef.id] });
  await taskService.transition(done.editing.id, "in_progress", youssef);
  await taskService.transition(done.editing.id, "awaiting_approval", youssef);
  await taskService.transition(done.editing.id, "done", adham); // the owner signs it off
  await taskService.setSchedule(adham, {
    id: done.editing.id,
    startDate: day(-20),
    deadline: day(-15),
  });

  // 2) The edit is on the owner's desk right now — the control point
  const waiting = await campaign({
    clientName: "Kuja",
    title: "Autumn drop",
    campaign: "Autumn 26",
    budget: 60000,
    startDate: day(-9),
    dueDate: day(2),
    shooters: [hazem, sama],
    priority: "high",
  });
  await taskService.transition(waiting.shooting.id, "in_progress", hazem);
  await taskService.transition(waiting.shooting.id, "done", hazem);
  await taskService.setAssignees(adham, { id: waiting.editing.id, userIds: [mariam.id] });
  await taskService.transition(waiting.editing.id, "in_progress", mariam);
  await taskService.transition(waiting.editing.id, "awaiting_approval", mariam);
  await taskService.setSchedule(adham, {
    id: waiting.editing.id,
    startDate: day(-6),
    deadline: day(1),
  });

  // 3) Being edited now, due in three days
  const editing = await campaign({
    clientName: "Zeit Café",
    title: "New branch opening",
    campaign: "Zamalek",
    budget: 30000,
    startDate: day(-7),
    dueDate: day(3),
    shooters: [sama],
  });
  await taskService.transition(editing.shooting.id, "in_progress", sama);
  await taskService.transition(editing.shooting.id, "done", sama);
  // two editors qualify, so the handoff parks it in the queue and the owner
  // picks — which is the routing rule doing its job, not a gap
  await taskService.setAssignees(adham, { id: editing.editing.id, userIds: [youssef.id] });
  await taskService.transition(editing.editing.id, "in_progress", youssef);
  await taskService.setSchedule(adham, {
    id: editing.editing.id,
    startDate: day(-3),
    deadline: day(3),
  });

  // 4) Shooting today
  const shootingToday = await campaign({
    clientName: "Amaya Skincare",
    title: "Serum launch",
    campaign: "Launch",
    budget: 52000,
    startDate: today,
    dueDate: day(6),
    shooters: [hazem, sama],
    priority: "high",
  });
  await taskService.transition(shootingToday.shooting.id, "in_progress", hazem);

  // 5) Late: the shoot slipped and the owner has flagged it
  const late = await campaign({
    clientName: "Kuja",
    title: "Lookbook stills",
    campaign: "Autumn 26",
    budget: 25000,
    startDate: day(-4),
    dueDate: day(4),
    shooters: [sama],
  });
  await taskService.setSchedule(adham, {
    id: late.shooting.id,
    startDate: day(-4),
    deadline: day(-2),
  });
  await taskService.setFlag(adham, {
    id: late.shooting.id,
    flagged: true,
    note: "Client is asking. Can we shoot the rest tomorrow morning?",
  });

  // 6) Booked for next week, nobody assigned yet — lands in the owner's queue
  await campaign({
    clientName: "Nola Bakery",
    title: "Autumn drinks",
    campaign: "Autumn 26",
    budget: 28000,
    startDate: day(5),
    dueDate: day(11),
    shooters: [],
  });

  // --- money ---------------------------------------------------------------
  const categories = await db.select().from(schema.expenseCategories);
  const category = (name: string) => {
    const row = categories.find((c) => c.name === name);
    if (!row) throw new Error(`demo: unknown category ${name}`);
    return row.id;
  };

  await financeService.addIncome(adham, {
    projectId: done.project.id,
    amount: 45000,
    receivedOn: day(-12),
    note: "Eid menu — paid in full",
  });
  await financeService.addIncome(adham, {
    projectId: waiting.project.id,
    amount: 30000,
    receivedOn: day(-8),
    note: "Autumn drop — 50% up front",
  });
  await financeService.addExpense(adham, {
    projectId: done.project.id,
    categoryId: category("Talent"),
    amount: 4000,
    spentOn: day(-24),
    note: "Two models, half day",
  });
  await financeService.addExpense(adham, {
    projectId: waiting.project.id,
    categoryId: category("Equipment rental"),
    amount: 6500,
    spentOn: day(-9),
    note: "Ronin + 85mm for the drop",
  });
  await financeService.addExpense(adham, {
    categoryId: category("Other"),
    amount: 9000,
    spentOn: day(-3),
    note: "Studio rent",
  });
  // a couple of entries inside the current month, so the owner's deck has
  // something honest to show on the 2nd as well as the 28th
  await financeService.addIncome(adham, {
    projectId: shootingToday.project.id,
    amount: 26000,
    receivedOn: today,
    note: "Serum launch — deposit",
  });
  await financeService.addExpense(adham, {
    projectId: shootingToday.project.id,
    categoryId: category("Location"),
    amount: 3500,
    spentOn: today,
    note: "Studio day rate for the serum shoot",
  });
  // waiting on the owner
  await financeService.requestExpense(sama, {
    projectId: shootingToday.project.id,
    categoryId: category("Transport"),
    amount: 850,
    spentOn: today,
    note: "Van to the studio and back for the serum shoot",
  });
  await financeService.requestExpense(youssef, {
    categoryId: category("Other"),
    amount: 1200,
    spentOn: day(-1),
    note: "Renewed the stock music subscription",
  });

  // --- the company's pay and time off --------------------------------------
  // The owner has neither: he is not on the payroll and does not book leave.
  const salaries: [Actor, number][] = [
    [hazem, 12000],
    [sama, 9000],
    [youssef, 8500],
    [mariam, 8000],
  ];
  for (const [person, amount] of salaries) {
    await hrService.setSalary(adham, {
      userId: person.id,
      monthlyAmount: amount,
      effectiveFrom: `${period(6)}-01`,
    });
  }

  // last month: prepared and paid, so everyone has a payslip to look at
  const lastMonth = period(1);
  await hrService.preparePayroll(adham, { period: lastMonth });
  const lastRun = await hrService.payroll({ period: lastMonth });
  for (const row of lastRun.rows) {
    if (!row.payslip) continue;
    if (row.userId === hazem.id) {
      await hrService.addAdjustment(adham, {
        payslipId: row.payslip.id,
        kind: "bonus",
        amount: 1500,
        note: "Kuja delivered a week early",
      });
    }
    if (row.userId === mariam.id) {
      await hrService.addAdjustment(adham, {
        payslipId: row.payslip.id,
        kind: "advance",
        amount: 2000,
        note: "Advance taken mid-month",
      });
    }
    await hrService.markPaid(adham, { payslipId: row.payslip.id, paidOn: `${lastMonth}-28` });
  }

  // time off: one decided, one refused, one taken as a casual day off pay, and
  // two sitting in the owner's queue
  const approved = await hrService.requestLeave(sama, {
    type: "annual",
    startDate: day(9),
    endDate: day(13),
    reason: "Sister's wedding in Alexandria",
  });
  await hrService.decideLeave(adham, {
    id: approved.id,
    approve: true,
    note: "Fine — hand the Zeit stills over before you go.",
  });

  const refused = await hrService.requestLeave(youssef, {
    type: "annual",
    startDate: day(1),
    endDate: day(3),
    reason: "Long weekend in Dahab",
  });
  await hrService.decideLeave(adham, {
    id: refused.id,
    approve: false,
    note: "Kuja is due that week — try the week after and it's yours.",
  });

  await hrService.logLeave(adham, {
    userId: mariam.id,
    type: "casual",
    startDate: day(-11),
    endDate: day(-11),
    reason: "Called in the morning",
  });
  await hrService.logLeave(adham, {
    userId: hazem.id,
    type: "unpaid",
    startDate: day(-18),
    endDate: day(-18),
    reason: "Took the day, no balance left that month",
    deductAmount: 400,
  });

  await hrService.requestLeave(mariam, {
    type: "annual",
    startDate: day(15),
    endDate: day(19),
    reason: "Family trip to Hurghada — booked already",
  });
  await hrService.requestLeave(youssef, {
    type: "sick",
    startDate: day(-1),
    endDate: today,
    reason: "Food poisoning, saw a doctor",
  });

  // --- what the owner should find waiting for him --------------------------
  console.log(`Demo data ready. Everyone signs in with: ${PASSWORD}`);
  console.log("");
  console.log("  Owner    adham@mams.local     — sees everything, decides everything");
  console.log("  Crew     hazem@mams.local     — videographer, team lead (sees the team's calendar)");
  console.log("           sama@mams.local      — photographer");
  console.log("           youssef@mams.local   — editor");
  console.log("           mariam@mams.local    — editor");
  console.log("");
  console.log("  Waiting on Adham: 1 edit to approve · 2 leave requests · 2 expense claims");
  console.log("  On the floor:     1 shoot today · 1 shoot overdue and flagged · 1 edit due in 3 days");
  console.log(`  Paid already:     ${lastRun.rows.length} payslips for ${lastMonth}`);
}

await main();
process.exit(0);
