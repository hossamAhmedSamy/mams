import { schema } from "@mams/db";
import { can, taskLabel, type Permission, type Priority, type ProjectStatus } from "@mams/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { env } from "../env";
import { addDaysISO, todayISO } from "../lib/time";
import { logActivity } from "./activity";
import { notifyUser } from "./notify";
import { scheduleStageAutoReminder } from "./reminder-service";

const { projects, clients, tasks, stages, templateStages, workflowTemplates, taskAssignees, user } =
  schema;

type Actor = {
  id: string;
  role: "admin" | "member";
  name: string;
  permissions: readonly Permission[];
};

function assertCan(actor: Actor, permission: Permission) {
  if (!can(actor, permission)) throw new TRPCError({ code: "FORBIDDEN" });
}

type Person = { id: string; name: string };

/** taskId → the people on it, for the task sets the project screens render. */
async function assigneesByTask(taskIds: string[]): Promise<Map<string, Person[]>> {
  const map = new Map<string, Person[]>();
  if (taskIds.length === 0) return map;
  const rows = await db
    .select({ taskId: taskAssignees.taskId, userId: taskAssignees.userId, name: user.name })
    .from(taskAssignees)
    .innerJoin(user, eq(taskAssignees.userId, user.id))
    .where(inArray(taskAssignees.taskId, taskIds))
    .orderBy(user.name);
  for (const row of rows) {
    map.set(row.taskId, [...(map.get(row.taskId) ?? []), { id: row.userId, name: row.name }]);
  }
  return map;
}

export async function listProjects(filters: {
  clientId?: string;
  status?: ProjectStatus;
  priority?: Priority;
}) {
  const conds = [];
  if (filters.clientId) conds.push(eq(projects.clientId, filters.clientId));
  if (filters.status) conds.push(eq(projects.status, filters.status));
  if (filters.priority) conds.push(eq(projects.priority, filters.priority));

  const rows = await db
    .select({
      id: projects.id,
      title: projects.title,
      campaign: projects.campaign,
      priority: projects.priority,
      status: projects.status,
      startDate: projects.startDate,
      dueDate: projects.dueDate,
      clientId: projects.clientId,
      clientName: clients.name,
    })
    .from(projects)
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(projects.dueDate));

  if (rows.length === 0) return [];
  const chainTasks = await db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      status: tasks.status,
      chainPosition: tasks.chainPosition,
      stageName: stages.name,
    })
    .from(tasks)
    .leftJoin(stages, eq(tasks.stageId, stages.id))
    .where(
      inArray(
        tasks.projectId,
        rows.map((r) => r.id),
      ),
    );
  const peopleByTask = await assigneesByTask(chainTasks.map((t) => t.id));

  const today = todayISO(env.TZ_BUSINESS);
  return rows.map((p) => {
    const chain = chainTasks
      .filter((t) => t.projectId === p.id && t.chainPosition !== null)
      .sort((a, b) => a.chainPosition! - b.chainPosition!);
    const current = chain.find((t) => t.status !== "done");
    return {
      ...p,
      stagesDone: chain.filter((t) => t.status === "done").length,
      stagesTotal: chain.length,
      currentStage: current ? taskLabel(current.stageName) : null,
      currentAssignees: current ? (peopleByTask.get(current.id) ?? []).map((p) => p.name) : [],
      isLate: p.status === "active" && p.dueDate !== null && p.dueDate < today,
    };
  });
}

export async function getProject(id: string) {
  const [project] = await db
    .select({
      id: projects.id,
      title: projects.title,
      campaign: projects.campaign,
      priority: projects.priority,
      status: projects.status,
      startDate: projects.startDate,
      dueDate: projects.dueDate,
      driveLink: projects.driveLink,
      notes: projects.notes,
      clientId: projects.clientId,
      clientName: clients.name,
      workflowTemplateId: projects.workflowTemplateId,
      createdAt: projects.createdAt,
      completedAt: projects.completedAt,
    })
    .from(projects)
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(eq(projects.id, id));
  if (!project) throw new TRPCError({ code: "NOT_FOUND" });

  const projectTasks = await db
    .select({
      id: tasks.id,
      status: tasks.status,
      chainPosition: tasks.chainPosition,
      deadline: tasks.deadline,
      startDate: tasks.startDate,
      flagged: tasks.flagged,
      requiresApproval: tasks.requiresApproval,
      stageId: tasks.stageId,
      stageName: stages.name,
      checklist: tasks.checklist,
      driveLink: tasks.driveLink,
    })
    .from(tasks)
    .leftJoin(stages, eq(tasks.stageId, stages.id))
    .where(eq(tasks.projectId, id))
    .orderBy(asc(tasks.chainPosition), asc(tasks.createdAt));
  const peopleByTask = await assigneesByTask(projectTasks.map((t) => t.id));

  return {
    ...project,
    tasks: projectTasks.map((t) => {
      const assignees = peopleByTask.get(t.id) ?? [];
      return { ...t, assignees, assigneeIds: assignees.map((a) => a.id) };
    }),
  };
}

/** Create a project; snapshot the template into task rows (PLAN.md §5.2). */
export async function createProject(
  actor: Actor,
  input: {
    clientId: string;
    title: string;
    campaign?: string;
    priority: Priority;
    startDate?: string;
    dueDate?: string;
    driveLink?: string;
    notes?: string;
    budget?: number;
    workflowTemplateId?: string;
    firstAssigneeIds?: string[];
  },
) {
  assertCan(actor, "projects.manage");
  return db.transaction(async (tx) => {
    const [project] = await tx
      .insert(projects)
      .values({
        clientId: input.clientId,
        title: input.title,
        campaign: input.campaign ?? null,
        priority: input.priority,
        startDate: input.startDate ?? null,
        dueDate: input.dueDate ?? null,
        driveLink: input.driveLink ?? null,
        notes: input.notes ?? null,
        budget: input.budget !== undefined ? String(input.budget) : null,
        workflowTemplateId: input.workflowTemplateId ?? null,
        createdBy: actor.id,
      })
      .returning();
    await logActivity(tx, {
      actorId: actor.id,
      entityType: "project",
      entityId: project!.id,
      action: "created",
      detail: { title: input.title },
    });

    if (!input.workflowTemplateId) return project!;

    const chain = await tx
      .select({
        stageId: templateStages.stageId,
        position: templateStages.position,
        requiresApproval: templateStages.requiresApproval,
        stageName: stages.name,
        defaultDurationDays: stages.defaultDurationDays,
        reminderRule: stages.reminderRule,
      })
      .from(templateStages)
      .innerJoin(stages, eq(templateStages.stageId, stages.id))
      .where(eq(templateStages.templateId, input.workflowTemplateId))
      .orderBy(asc(templateStages.position));
    if (chain.length === 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Template has no stages" });
    }

    // the first stage starts when the project does (or today, if unspecified)
    const kickoff = input.startDate ?? todayISO(env.TZ_BUSINESS);
    const firstAssignees = [...new Set(input.firstAssigneeIds ?? [])];
    for (const stage of chain) {
      const isFirst = stage.position === chain[0]!.position;
      const deadline = isFirst ? addDaysISO(kickoff, stage.defaultDurationDays) : null;
      const [task] = await tx
        .insert(tasks)
        .values({
          projectId: project!.id,
          stageId: stage.stageId,
          chainPosition: stage.position,
          requiresApproval: stage.requiresApproval,
          status: isFirst ? "todo" : "waiting",
          activatedAt: isFirst ? new Date() : null,
          startDate: isFirst ? kickoff : null,
          deadline,
          createdBy: actor.id,
        })
        .returning();
      if (!isFirst || firstAssignees.length === 0) continue;

      await tx
        .insert(taskAssignees)
        .values(firstAssignees.map((userId) => ({ taskId: task!.id, userId })))
        .onConflictDoNothing();
      const label = taskLabel(stage.stageName);
      await scheduleStageAutoReminder(
        tx,
        { id: task!.id, assigneeIds: firstAssignees, deadline, label },
        stage.reminderRule,
      );
      for (const userId of firstAssignees) {
        if (userId === actor.id) continue;
        await notifyUser(tx, userId, {
          type: "task_assigned",
          title: `New task: ${label} — ${input.title}`,
          body: deadline ? `Due ${deadline}` : undefined,
          entityType: "task",
          entityId: task!.id,
        });
      }
    }
    return project!;
  });
}

export async function updateProject(
  actor: Actor,
  input: {
    id: string;
    title?: string;
    campaign?: string | null;
    priority?: Priority;
    startDate?: string | null;
    dueDate?: string | null;
    driveLink?: string | null;
    notes?: string | null;
    budget?: number | null;
  },
) {
  assertCan(actor, "projects.manage");
  return db.transaction(async (tx) => {
    const { id, budget, ...rest } = input;
    const fields = {
      ...rest,
      ...(budget !== undefined ? { budget: budget === null ? null : String(budget) } : {}),
    };
    const [row] = await tx.update(projects).set(fields).where(eq(projects.id, id)).returning();
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    await logActivity(tx, {
      actorId: actor.id,
      entityType: "project",
      entityId: id,
      action: "updated",
      detail: fields,
    });
    return row;
  });
}

export async function setProjectStatus(actor: Actor, input: { id: string; status: ProjectStatus }) {
  assertCan(actor, "projects.manage");
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(projects).where(eq(projects.id, input.id)).for("update");
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    await tx
      .update(projects)
      .set({
        status: input.status,
        completedAt: input.status === "completed" ? new Date() : null,
      })
      .where(eq(projects.id, input.id));
    await logActivity(tx, {
      actorId: actor.id,
      entityType: "project",
      entityId: input.id,
      action: "status_changed",
      detail: { from: row.status, to: input.status },
    });
  });
}
