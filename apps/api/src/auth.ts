import { schema } from "@mams/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { db } from "./db";
import { env } from "./env";

/**
 * AuthN per PLAN.md §7.3:
 * - email + password only, public signup DISABLED (admin creates accounts
 *   via the users.create tRPC mutation, not an auth route)
 * - httpOnly cookie sessions, 30-day sliding expiry
 * - built-in rate limiting, tightest on sign-in
 * - admin plugin supplies role + banned enforcement ("active" toggle in the UI);
 *   banned users cannot sign in and their sessions are revoked on ban
 */
export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.BETTER_AUTH_URL, env.DEV_WEB_ORIGIN],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 10,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  user: {
    additionalFields: {
      mustChangePassword: {
        type: "boolean",
        defaultValue: false,
        input: false,
      },
    },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
    },
  },
  advanced: {
    useSecureCookies: env.NODE_ENV === "production",
  },
  plugins: [
    admin({
      defaultRole: "member",
      adminRoles: ["admin"],
    }),
  ],
});

export type Auth = typeof auth;
