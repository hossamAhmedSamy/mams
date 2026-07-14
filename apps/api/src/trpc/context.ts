import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth";
import { db } from "../db";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "member";
  banned: boolean;
  mustChangePassword: boolean;
};

export async function createContext({ req, res }: CreateFastifyContextOptions) {
  let user: SessionUser | null = null;
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (session?.user) {
    const u = session.user as Record<string, unknown>;
    // banned users may hold a not-yet-revoked session; treat them as signed out
    if (u.banned !== true) {
      user = {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        role: u.role === "admin" ? "admin" : "member",
        banned: false,
        mustChangePassword: u.mustChangePassword === true,
      };
    }
  }
  return { db, user, req, res };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
