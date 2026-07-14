/**
 * Creates (or repairs) the initial admin account. Idempotent.
 * Usage: SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... SEED_ADMIN_NAME=... pnpm --filter @mams/api seed:admin
 * The password is a temp password — the admin is forced to change it on first login.
 */
import { randomUUID } from "node:crypto";
import { schema } from "@mams/db";
import { and, eq } from "drizzle-orm";
import { auth } from "../auth";
import { db } from "../db";

const email = process.env.SEED_ADMIN_EMAIL;
const password = process.env.SEED_ADMIN_PASSWORD;
const name = process.env.SEED_ADMIN_NAME ?? "Adham";

if (!email || !password || password.length < 10) {
  console.error(
    "Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (min 10 chars); optional SEED_ADMIN_NAME.",
  );
  process.exit(1);
}

const ctx = await auth.$context;
const hash = await ctx.password.hash(password);

const [existing] = await db.select().from(schema.user).where(eq(schema.user.email, email));

if (existing) {
  await db
    .update(schema.user)
    .set({ role: "admin", banned: false, updatedAt: new Date() })
    .where(eq(schema.user.id, existing.id));
  const [cred] = await db
    .select()
    .from(schema.account)
    .where(
      and(eq(schema.account.userId, existing.id), eq(schema.account.providerId, "credential")),
    );
  if (!cred) {
    await db.insert(schema.account).values({
      id: randomUUID(),
      accountId: existing.id,
      providerId: "credential",
      userId: existing.id,
      password: hash,
    });
    console.log(`Repaired credential account for existing admin ${email}.`);
  } else {
    console.log(`Admin ${email} already exists — role/active ensured, password untouched.`);
  }
} else {
  const id = randomUUID();
  await db.insert(schema.user).values({
    id,
    name,
    email,
    emailVerified: true,
    role: "admin",
    mustChangePassword: true,
  });
  await db.insert(schema.account).values({
    id: randomUUID(),
    accountId: id,
    providerId: "credential",
    userId: id,
    password: hash,
  });
  console.log(`Admin ${email} created with a temp password (forced change on first login).`);
}

process.exit(0);
