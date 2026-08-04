import { schema } from "@mams/db";
import { can, type LeaveType, type Permission } from "@mams/shared";
import { and, asc, desc, eq, gte, inArray, lte, ne, notExists, sql } from "drizzle-orm";
import { db } from "../db";
import { env } from "../env";
import { addDaysISO, todayISO } from "../lib/time";

const {
  tasks,
  taskAssignees,
  projects,
  clients,
  stages,
  user,
  leaveRequests,
  expenses,
  expenseCategories,
  incomes,
} = schema;

type Viewer = { id: string; role: "admin" | "member"; permissions: readonly Permission[] };

const OPEN = ["todo", "in_progress", "awaiting_approval"] as const;

/**
 * The owner's deck.
 *
 * The portal is meant to regulate the work, which means the first screen has to
 * answer two questions in the order he actually asks them: *what is stuck on
 * me*, and *what is the floor doing*. Every block is permission-gated and comes
 * back empty rather than missing, so a member who is granted one slice of
 * authority (say approvals) gets that slice and nothing else.
 */
export async function ownerDeck(viewer: Viewer) {
  const today = todayISO(env.TZ_BUSINESS);
  const weekEnd = addDaysISO(today, 7);
  const fortnight = addDaysISO(today, 14);

  const mayApprove = can(viewer, "tasks.approve");
  const mayHr = can(viewer, "hr.manage");
  const mayDecideMoney = can(viewer, "money.manage");
  const maySeeMoney = can(viewer, "money.view");
  const seesTeam = can(viewer, "team.viewAll");

  // --- waiting on this person ----------------------------------------------
  const approvals = mayApprove
    ? await db
        .select({
          id: tasks.id,
          projectTitle: projects.title,
          clientName: clients.name,
          stageName: stages.name,
          deadline: tasks.deadline,
        })
        .from(tasks)
        .innerJoin(projects, eq(tasks.projectId, projects.id))
        .innerJoin(clients, eq(projects.clientId, clients.id))
        .leftJoin(stages, eq(tasks.stageId, stages.id))
        .where(eq(tasks.status, "awaiting_approval"))
        .orderBy(sql`${tasks.deadline} ASC NULLS LAST`)
        .limit(20)
    : [];
  const approvalPeople = await peopleOn(approvals.map((a) => a.id));

  const leave = mayHr
    ? await db
        .select({
          id: leaveRequests.id,
          userName: user.name,
          type: leaveRequests.type,
          startDate: leaveRequests.startDate,
          endDate: leaveRequests.endDate,
          days: leaveRequests.days,
          reason: leaveRequests.reason,
        })
        .from(leaveRequests)
        .innerJoin(user, eq(leaveRequests.userId, user.id))
        .where(eq(leaveRequests.status, "pending"))
        .orderBy(asc(leaveRequests.startDate))
        .limit(20)
    : [];

  const claims = mayDecideMoney
    ? await db
        .select({
          id: expenses.id,
          amount: expenses.amount,
          note: expenses.note,
          requesterName: user.name,
          categoryName: expenseCategories.name,
          spentOn: expenses.spentOn,
        })
        .from(expenses)
        .innerJoin(expenseCategories, eq(expenses.categoryId, expenseCategories.id))
        .leftJoin(user, eq(expenses.createdBy, user.id))
        .where(eq(expenses.status, "pending"))
        .orderBy(desc(expenses.createdAt))
        .limit(20)
    : [];

  // --- what the floor is doing ---------------------------------------------
  const floor = seesTeam
    ? await (async () => {
        const openTasks = await db
          .select({
            id: tasks.id,
            status: tasks.status,
            deadline: tasks.deadline,
            startDate: tasks.startDate,
            flagged: tasks.flagged,
            flagNote: tasks.flagNote,
            projectId: tasks.projectId,
            projectTitle: projects.title,
            clientName: clients.name,
            stageName: stages.name,
          })
          .from(tasks)
          .innerJoin(projects, eq(tasks.projectId, projects.id))
          .innerJoin(clients, eq(projects.clientId, clients.id))
          .leftJoin(stages, eq(tasks.stageId, stages.id))
          .where(inArray(tasks.status, [...OPEN]))
          .orderBy(sql`${tasks.deadline} ASC NULLS LAST`);
        const people = await peopleOn(openTasks.map((t) => t.id));
        const withPeople = openTasks.map((t) => ({
          ...t,
          assignees: people.get(t.id) ?? [],
        }));

        const unassigned = await db
          .select({ id: tasks.id })
          .from(tasks)
          .where(
            and(
              inArray(tasks.status, ["todo", "in_progress"]),
              notExists(
                db
                  .select({ n: sql`1` })
                  .from(taskAssignees)
                  .where(eq(taskAssignees.taskId, tasks.id)),
              ),
            ),
          );
        const unassignedIds = new Set(unassigned.map((u) => u.id));

        return {
          late: withPeople.filter((t) => t.deadline !== null && t.deadline < today),
          today: withPeople.filter(
            (t) =>
              t.deadline === today ||
              (t.status === "in_progress" &&
                t.startDate !== null &&
                t.startDate <= today &&
                (t.deadline === null || t.deadline >= today)),
          ),
          soon: withPeople.filter(
            (t) => t.deadline !== null && t.deadline > today && t.deadline <= weekEnd,
          ),
          flagged: withPeople.filter((t) => t.flagged),
          unassigned: withPeople.filter((t) => unassignedIds.has(t.id)),
          openCount: withPeople.length,
        };
      })()
    : null;

  // --- who is away ----------------------------------------------------------
  const away = await db
    .select({
      id: leaveRequests.id,
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
        lte(leaveRequests.startDate, fortnight),
        gte(leaveRequests.endDate, today),
      ),
    )
    .orderBy(asc(leaveRequests.startDate));

  // --- the month's money ----------------------------------------------------
  const monthStart = `${today.slice(0, 7)}-01`;
  const money = maySeeMoney
    ? await (async () => {
        const [spend] = await db
          .select({ total: sql<string>`COALESCE(SUM(${expenses.amount}), 0)` })
          .from(expenses)
          .where(
            and(
              eq(expenses.status, "approved"),
              gte(expenses.spentOn, monthStart),
              lte(expenses.spentOn, today),
            ),
          );
        const [income] = await db
          .select({ total: sql<string>`COALESCE(SUM(${incomes.amount}), 0)` })
          .from(incomes)
          .where(and(gte(incomes.receivedOn, monthStart), lte(incomes.receivedOn, today)));
        const [pending] = await db
          .select({ total: sql<string>`COALESCE(SUM(${expenses.amount}), 0)` })
          .from(expenses)
          .where(eq(expenses.status, "pending"));
        return {
          inThisMonth: Number(income?.total ?? 0),
          outThisMonth: Number(spend?.total ?? 0),
          waiting: Number(pending?.total ?? 0),
        };
      })()
    : null;

  // --- the company at a glance ---------------------------------------------
  const [projectCounts] = await db
    .select({
      active: sql<string>`COUNT(*) FILTER (WHERE ${projects.status} = 'active')`,
      dueThisWeek: sql<string>`COUNT(*) FILTER (WHERE ${projects.status} = 'active' AND ${projects.dueDate} IS NOT NULL AND ${projects.dueDate} <= ${weekEnd})`,
    })
    .from(projects);
  const [headcount] = await db
    .select({ n: sql<string>`COUNT(*)` })
    .from(user)
    .where(and(eq(user.banned, false), ne(user.role, "admin")));

  return {
    today,
    needs: {
      approvals: approvals.map((a) => ({ ...a, assignees: approvalPeople.get(a.id) ?? [] })),
      leave: leave.map((l) => ({ ...l, type: l.type as LeaveType })),
      claims: claims.map((c) => ({ ...c, amount: Number(c.amount) })),
    },
    floor,
    away: {
      today: away.filter((a) => a.startDate <= today && a.endDate >= today),
      upcoming: away.filter((a) => a.startDate > today),
    },
    money,
    company: {
      activeProjects: Number(projectCounts?.active ?? 0),
      dueThisWeek: Number(projectCounts?.dueThisWeek ?? 0),
      headcount: Number(headcount?.n ?? 0),
    },
  };
}

async function peopleOn(taskIds: string[]) {
  const map = new Map<string, { id: string; name: string }[]>();
  if (taskIds.length === 0) return map;
  const rows = await db
    .select({ taskId: taskAssignees.taskId, id: user.id, name: user.name })
    .from(taskAssignees)
    .innerJoin(user, eq(taskAssignees.userId, user.id))
    .where(inArray(taskAssignees.taskId, taskIds));
  for (const row of rows) {
    map.set(row.taskId, [...(map.get(row.taskId) ?? []), { id: row.id, name: row.name }]);
  }
  return map;
}
