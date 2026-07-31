import { randomUUID } from "node:crypto";
import { schema } from "@mams/db";
import { PERMISSIONS, type Permission } from "@mams/shared";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import * as projectService from "../services/project-service";
import * as taskService from "../services/task-service";

export type TestActor = {
  id: string;
  role: "admin" | "member";
  name: string;
  permissions: Permission[];
};

/**
 * Admins hold every permission (as in the real context builder); members hold
 * only what a test grants, so authorization is exercised the way it ships.
 */
export async function makeUser(
  name: string,
  role: "admin" | "member",
  skillNames: string[] = [],
  permissions: Permission[] = [],
): Promise<TestActor> {
  const id = randomUUID();
  await db.insert(schema.user).values({
    id,
    name,
    email: `${name.toLowerCase()}-${id.slice(0, 8)}@test.local`,
    emailVerified: true,
    role,
  });
  if (skillNames.length > 0) {
    const rows = await db
      .select()
      .from(schema.skills)
      .where(inArray(schema.skills.name, skillNames));
    await db
      .insert(schema.userSkills)
      .values(rows.map((s) => ({ userId: id, skillId: s.id })));
  }
  if (role !== "admin" && permissions.length > 0) {
    await db
      .insert(schema.userPermissions)
      .values(permissions.map((permission) => ({ userId: id, permission })));
  }
  return {
    id,
    role,
    name,
    permissions: role === "admin" ? [...PERMISSIONS] : permissions,
  };
}

export async function makeClient(name?: string) {
  const [row] = await db
    .insert(schema.clients)
    .values({ name: name ?? `Client-${randomUUID().slice(0, 8)}` })
    .returning();
  return row!;
}

export async function templateIdByName(name: string) {
  const [row] = await db
    .select()
    .from(schema.workflowTemplates)
    .where(eq(schema.workflowTemplates.name, name));
  if (!row) throw new Error(`template ${name} missing`);
  return row.id;
}

/** Create a "Reels / Video" project; returns chain tasks ordered by position. */
export async function makeReelsProject(
  admin: TestActor,
  opts: { firstAssigneeIds?: string[] } = {},
) {
  const client = await makeClient();
  const project = await projectService.createProject(admin, {
    clientId: client.id,
    title: `Reels-${randomUUID().slice(0, 6)}`,
    priority: "medium",
    workflowTemplateId: await templateIdByName("Reels / Video"),
    firstAssigneeIds: opts.firstAssigneeIds,
  });
  return { project, chain: await chainOf(project.id) };
}

/** Who is on this task, as a sorted id list (assignment is a set now). */
export async function assigneesOf(taskId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: schema.taskAssignees.userId })
    .from(schema.taskAssignees)
    .where(eq(schema.taskAssignees.taskId, taskId));
  return rows.map((r) => r.userId).sort();
}

/** The task's display name — its stage, since tasks carry no title. */
export async function labelOf(taskId: string): Promise<string | null> {
  const [row] = await db
    .select({ name: schema.stages.name })
    .from(schema.tasks)
    .leftJoin(schema.stages, eq(schema.tasks.stageId, schema.stages.id))
    .where(eq(schema.tasks.id, taskId));
  return row?.name ?? null;
}

export async function chainOf(projectId: string) {
  return db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.projectId, projectId))
    .orderBy(asc(schema.tasks.chainPosition));
}

export async function taskById(id: string) {
  const [row] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id));
  if (!row) throw new Error("task missing");
  return row;
}

/** Drive a task through todo → in_progress → done as `actor`. */
export async function completeTask(taskId: string, actor: TestActor) {
  const task = await taskById(taskId);
  if (task.status === "todo") await taskService.transition(taskId, "in_progress", actor);
  return taskService.transition(taskId, "done", actor);
}

export async function notificationsFor(userId: string) {
  return db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId));
}

export async function remindersForTask(taskId: string) {
  return db.select().from(schema.reminders).where(eq(schema.reminders.taskId, taskId));
}

export async function projectById(id: string) {
  const [row] = await db.select().from(schema.projects).where(eq(schema.projects.id, id));
  if (!row) throw new Error("project missing");
  return row;
}

export async function banUser(id: string) {
  await db.update(schema.user).set({ banned: true }).where(eq(schema.user.id, id));
}
