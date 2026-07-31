import { randomUUID } from "node:crypto";
import { schema } from "@mams/db";
import { PERMISSIONS, type Permission } from "@mams/shared";
import { TRPCError } from "@trpc/server";
import { and, eq, ne } from "drizzle-orm";
import { auth } from "../auth";
import { db } from "../db";
import { logActivity } from "./activity";

const { user, account, session, userSkills, skills, userPermissions } = schema;

async function passwordCtx() {
  const ctx = await auth.$context;
  return ctx.password;
}

export async function listUsers() {
  const users = await db.select().from(user).orderBy(user.name);
  const links = await db
    .select({ userId: userSkills.userId, skillId: userSkills.skillId, name: skills.name })
    .from(userSkills)
    .innerJoin(skills, eq(userSkills.skillId, skills.id));
  const grants = await db.select().from(userPermissions);
  const known = new Set<string>(PERMISSIONS);
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role as "admin" | "member",
    active: !u.banned,
    mustChangePassword: u.mustChangePassword,
    createdAt: u.createdAt,
    skills: links
      .filter((l) => l.userId === u.id)
      .map((l) => ({ id: l.skillId, name: l.name })),
    // admins hold everything implicitly — show that rather than an empty list
    permissions:
      u.role === "admin"
        ? [...PERMISSIONS]
        : grants
            .filter((g) => g.userId === u.id)
            .map((g) => g.permission)
            .filter((p): p is Permission => known.has(p)),
  }));
}

export async function createUser(
  actorId: string,
  input: {
    name: string;
    email: string;
    tempPassword: string;
    role: "admin" | "member";
    skillIds: string[];
    permissions: Permission[];
  },
) {
  const existing = await db.select({ id: user.id }).from(user).where(eq(user.email, input.email));
  if (existing.length > 0) {
    throw new TRPCError({ code: "CONFLICT", message: "A user with this email already exists" });
  }
  const hash = await (await passwordCtx()).hash(input.tempPassword);
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(user).values({
      id,
      name: input.name,
      email: input.email,
      emailVerified: true, // accounts are provisioned by the admin, not self-served
      role: input.role,
      mustChangePassword: true,
    });
    await tx.insert(account).values({
      id: randomUUID(),
      accountId: id,
      providerId: "credential",
      userId: id,
      password: hash,
    });
    if (input.skillIds.length > 0) {
      await tx.insert(userSkills).values(input.skillIds.map((skillId) => ({ userId: id, skillId })));
    }
    if (input.role !== "admin" && input.permissions.length > 0) {
      await tx
        .insert(userPermissions)
        .values(input.permissions.map((permission) => ({ userId: id, permission })));
    }
    await logActivity(tx, {
      actorId,
      entityType: "user",
      entityId: id,
      action: "created",
      detail: { role: input.role, permissions: input.permissions },
    });
  });
  return { id };
}

export async function updateUser(
  actorId: string,
  input: { id: string; name?: string; role?: "admin" | "member" },
) {
  if (input.role === "member") await assertNotLastAdmin(input.id);
  await db.transaction(async (tx) => {
    await tx
      .update(user)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        updatedAt: new Date(),
      })
      .where(eq(user.id, input.id));
    // promoting to admin makes explicit grants meaningless; demoting starts
    // them from nothing so authority is never inherited by accident
    if (input.role !== undefined) {
      await tx.delete(userPermissions).where(eq(userPermissions.userId, input.id));
    }
    await logActivity(tx, {
      actorId,
      entityType: "user",
      entityId: input.id,
      action: "updated",
      detail: { name: input.name, role: input.role },
    });
  });
}

export async function setSkills(actorId: string, input: { id: string; skillIds: string[] }) {
  await db.transaction(async (tx) => {
    await tx.delete(userSkills).where(eq(userSkills.userId, input.id));
    if (input.skillIds.length > 0) {
      await tx
        .insert(userSkills)
        .values(input.skillIds.map((skillId) => ({ userId: input.id, skillId })));
    }
    await logActivity(tx, {
      actorId,
      entityType: "user",
      entityId: input.id,
      action: "skills_changed",
      detail: { skillIds: input.skillIds },
    });
  });
}

/**
 * Replace a member's grants. Admins already hold everything, so storing rows
 * for them would only be a lie waiting to drift — they are rejected instead.
 */
export async function setPermissions(
  actorId: string,
  input: { id: string; permissions: Permission[] },
) {
  const [target] = await db.select().from(user).where(eq(user.id, input.id));
  if (!target) throw new TRPCError({ code: "NOT_FOUND" });
  if (target.role === "admin") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Admins already have every permission — change their role to limit them",
    });
  }
  const wanted = [...new Set(input.permissions)];
  await db.transaction(async (tx) => {
    await tx.delete(userPermissions).where(eq(userPermissions.userId, input.id));
    if (wanted.length > 0) {
      await tx
        .insert(userPermissions)
        .values(wanted.map((permission) => ({ userId: input.id, permission })));
    }
    await logActivity(tx, {
      actorId,
      entityType: "user",
      entityId: input.id,
      action: "permissions_changed",
      detail: { permissions: wanted },
    });
  });
}

export async function setActive(actorId: string, input: { id: string; active: boolean }) {
  if (actorId === input.id) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot deactivate yourself" });
  }
  if (!input.active) await assertNotLastAdmin(input.id);
  await db.transaction(async (tx) => {
    await tx
      .update(user)
      .set({
        banned: !input.active,
        banReason: input.active ? null : "Deactivated by admin",
        updatedAt: new Date(),
      })
      .where(eq(user.id, input.id));
    if (!input.active) {
      await tx.delete(session).where(eq(session.userId, input.id));
    }
    await logActivity(tx, {
      actorId,
      entityType: "user",
      entityId: input.id,
      action: input.active ? "activated" : "deactivated",
    });
  });
}

/** Self-service password change; clears the forced-change flag. */
export async function changeOwnPassword(
  userId: string,
  input: { currentPassword: string; newPassword: string },
) {
  const [cred] = await db
    .select()
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "credential")));
  if (!cred?.password) throw new TRPCError({ code: "BAD_REQUEST", message: "No password account" });
  const pw = await passwordCtx();
  const ok = await pw.verify({ hash: cred.password, password: input.currentPassword });
  if (!ok) throw new TRPCError({ code: "BAD_REQUEST", message: "Current password is incorrect" });
  const hash = await pw.hash(input.newPassword);
  await db.transaction(async (tx) => {
    await tx
      .update(account)
      .set({ password: hash, updatedAt: new Date() })
      .where(eq(account.id, cred.id));
    await tx
      .update(user)
      .set({ mustChangePassword: false, updatedAt: new Date() })
      .where(eq(user.id, userId));
    await logActivity(tx, {
      actorId: userId,
      entityType: "user",
      entityId: userId,
      action: "password_changed",
    });
  });
}

/** Admin sets a new temp password; user is forced to change it on next login. */
export async function resetPassword(
  actorId: string,
  input: { id: string; tempPassword: string },
) {
  const hash = await (await passwordCtx()).hash(input.tempPassword);
  await db.transaction(async (tx) => {
    await tx
      .update(account)
      .set({ password: hash, updatedAt: new Date() })
      .where(and(eq(account.userId, input.id), eq(account.providerId, "credential")));
    await tx
      .update(user)
      .set({ mustChangePassword: true, updatedAt: new Date() })
      .where(eq(user.id, input.id));
    await tx.delete(session).where(eq(session.userId, input.id));
    await logActivity(tx, {
      actorId,
      entityType: "user",
      entityId: input.id,
      action: "password_reset",
    });
  });
}

/** The system must always retain at least one active admin. */
async function assertNotLastAdmin(userId: string) {
  const [target] = await db.select().from(user).where(eq(user.id, userId));
  if (!target || target.role !== "admin") return;
  const others = await db
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.role, "admin"), eq(user.banned, false), ne(user.id, userId)));
  if (others.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot remove the last active admin" });
  }
}
