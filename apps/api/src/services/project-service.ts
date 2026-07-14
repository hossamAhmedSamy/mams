import { schema } from "@mams/db";
import type { Priority, ProjectStatus } from "@mams/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { env } from "../env";
import { addDaysISO, todayISO } from "../lib/time";
import { logActivity } from "./activity";
import { notifyUser } from "./notify";
import { scheduleStageAutoReminder } from "./reminder-service";

const { projects, clients, tasks, stages, templateStages, workflowTemplates, user } = schema;

type Actor = { id: string; role: "admin" | "member"; name: string };

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
      projectId: tasks.projectId,
      status: tasks.status,
      chainPosition: tasks.chainPosition,
      stageName: stages.name,
      assigneeName: user.name,
    })
    .from(tasks)
    .leftJoin(stages, eq(tasks.stageId, stages.id))
    .leftJoin(user, eq(tasks.assigneeId, user.id))
    .where(
      inArray(
        tasks.projectId,
        rows.map((r) => r.id),
      ),
    );

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
      currentStage: current?.stageName ?? null,
      currentAssignee: current?.assigneeName ?? null,
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
      title: tasks.title,
      status: tasks.status,
      chainPosition: tasks.chainPosition,
      deadline: tasks.deadline,
      startDate: tasks.startDate,
      flagged: tasks.flagged,
      requiresApproval: tasks.requiresApproval,
      assigneeId: tasks.assigneeId,
      assigneeName: user.name,
      stageName: stages.name,
      checklist: tasks.checklist,
      driveLink: tasks.driveLink,
    })
    .from(tasks)
    .leftJoin(stages, eq(tasks.stageId, stages.id))
    .leftJoin(user, eq(tasks.assigneeId, user.id))
    .where(eq(tasks.projectId, id))
    .orderBy(asc(tasks.chainPosition), asc(tasks.createdAt));

  return { ...project, tasks: projectTasks };
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
    workflowTemplateId?: string;
    firstAssigneeId?: string;
  },
) {
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

    const today = todayISO(env.TZ_BUSINESS);
    for (const stage of chain) {
      const isFirst = stage.position === chain[0]!.position;
      const deadline = isFirst ? addDaysISO(today, stage.defaultDurationDays) : null;
      const assigneeId = isFirst ? (input.firstAssigneeId ?? null) : null;
      const [task] = await tx
        .insert(tasks)
        .values({
          projectId: project!.id,
          stageId: stage.stageId,
          chainPosition: stage.position,
          title: stage.stageName,
          requiresApproval: stage.requiresApproval,
          status: isFirst ? "todo" : "waiting",
          assigneeId,
          activatedAt: isFirst ? new Date() : null,
          startDate: isFirst ? today : null,
          deadline,
          createdBy: actor.id,
        })
        .returning();
      if (isFirst && assigneeId) {
        await tx
          .insert(schema.taskAssignees)
          .values({ taskId: task!.id, userId: assigneeId })
          .onConflictDoNothing();
        await scheduleStageAutoReminder(
          tx,
          { id: task!.id, assigneeId, deadline, title: task!.title },
          stage.reminderRule,
        );
        if (assigneeId !== actor.id) {
          await notifyUser(tx, assigneeId, {
            type: "task_assigned",
            title: `New task: ${task!.title} — ${input.title}`,
            body: deadline ? `Due ${deadline}` : undefined,
            entityType: "task",
            entityId: task!.id,
          });
        }
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
  },
) {
  return db.transaction(async (tx) => {
    const { id, ...fields } = input;
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
