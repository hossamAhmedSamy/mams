import { randomUUID } from "node:crypto";
import { schema } from "@mams/db";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import * as projectService from "../services/project-service";
import * as taskService from "../services/task-service";

export type TestActor = { id: string; role: "admin" | "member"; name: string };

export async function makeUser(
  name: string,
  role: "admin" | "member",
  skillNames: string[] = [],
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
  return { id, role, name };
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
  opts: { firstAssigneeId?: string } = {},
) {
  const client = await makeClient();
  const project = await projectService.createProject(admin, {
    clientId: client.id,
    title: `Reels-${randomUUID().slice(0, 6)}`,
    priority: "medium",
    workflowTemplateId: await templateIdByName("Reels / Video"),
    firstAssigneeId: opts.firstAssigneeId,
  });
  return { project, chain: await chainOf(project.id) };
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
