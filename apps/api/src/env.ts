import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(8080),
  DATABASE_URL: z.string().default("postgres://mams:mams@localhost:5433/mams"),
  BETTER_AUTH_SECRET: z.string().min(16),
  /** Public base URL of this service (onrender.com URL in trial mode). */
  BETTER_AUTH_URL: z.string().default("http://localhost:8080"),
  /** Extra allowed origin during dev (the Vite server). */
  DEV_WEB_ORIGIN: z.string().default("http://localhost:5173"),
  JOB_TRIGGER_TOKEN: z.string().min(16),
  TZ_BUSINESS: z.string().default("Africa/Cairo"),
  DIGEST_HOUR: z.coerce.number().min(0).max(23).default(8),
  REMINDER_EOD_HOUR: z.coerce.number().min(0).max(23).default(18),
  RESEND_API_KEY: z.string().optional(),
  MCP_BEARER_TOKEN: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment:", z.treeifyError(parsed.error));
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
