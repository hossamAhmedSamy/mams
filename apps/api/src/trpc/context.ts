import { schema } from "@mams/db";
import { PERMISSIONS, type Permission } from "@mams/shared";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import { fromNodeHeaders } from "better-auth/node";
import { eq } from "drizzle-orm";
import { auth } from "../auth";
import { db } from "../db";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "member";
  /** Explicit grants. Admins hold everything regardless of what's stored. */
  permissions: Permission[];
  banned: boolean;
  mustChangePassword: boolean;
};

export async function loadPermissions(userId: string): Promise<Permission[]> {
  const rows = await db
    .select({ permission: schema.userPermissions.permission })
    .from(schema.userPermissions)
    .where(eq(schema.userPermissions.userId, userId));
  const known = new Set<string>(PERMISSIONS);
  return rows.map((r) => r.permission).filter((p): p is Permission => known.has(p));
}

export async function createContext({ req, res }: CreateFastifyContextOptions) {
  let user: SessionUser | null = null;
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (session?.user) {
    const u = session.user as Record<string, unknown>;
    // banned users may hold a not-yet-revoked session; treat them as signed out
    if (u.banned !== true) {
      const role = u.role === "admin" ? "admin" : "member";
      user = {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        role,
        permissions: role === "admin" ? [...PERMISSIONS] : await loadPermissions(session.user.id),
        banned: false,
        mustChangePassword: u.mustChangePassword === true,
      };
    }
  }
  return { db, user, req, res };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
