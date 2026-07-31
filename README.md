# MAMS — Agency Operations Portal

Single-tenant operations portal for one creative agency: projects, task handoffs,
deadlines, reminders, and money. The implementation contract is [PLAN.md](PLAN.md) —
read it before changing anything structural.

## Stack

pnpm monorepo · React 19 + Vite + Tailwind (SPA, `apps/web`) · Fastify + tRPC + better-auth
(`apps/api`) · Drizzle + PostgreSQL (`packages/db`) · shared Zod enums (`packages/shared`).
Trial mode serves the built SPA from the API — one origin, one free Render service.

## Local development

```bash
pnpm install
pnpm db:up          # local Postgres 17 in docker (port 5433)
pnpm db:migrate     # apply migrations
pnpm db:seed        # skills, stages, templates, expense categories (idempotent)

# create the first admin (temp password; forced change on first login)
SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD=some-temp-pass-123 \
  pnpm --filter @mams/api seed:admin

pnpm dev            # api on :8080, web on :5173 (proxies /trpc + /api to the api)
```

Open http://localhost:5173 and sign in. Admin creates all other accounts in
Settings → Team (no public signup exists, by design).

Tests (real-Postgres integration suite for the handoff engine and state machine):

```bash
pnpm --filter @mams/api test
```

## Deploy — trial mode ($0/month)

1. **Neon**: create a project → copy the pooled `DATABASE_URL`.
2. **Render**: new **Web Service** from this repo (free instance).
   - Build: `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @mams/web build`
   - Pre-deploy (or one-off shell): `pnpm db:migrate && pnpm db:seed`
   - Start: `pnpm --filter @mams/api start`
   - Env vars: `DATABASE_URL`, `BETTER_AUTH_SECRET` (32+ random chars),
     `BETTER_AUTH_URL` (the service's `https://….onrender.com` URL),
     `JOB_TRIGGER_TOKEN` (long random), `NODE_ENV=production`.
3. **Seed the admin** (Render shell):
   `SEED_ADMIN_EMAIL=… SEED_ADMIN_PASSWORD=… pnpm --filter @mams/api seed:admin`
4. **External cron** (keeps jobs firing despite free-tier spin-down):
   on [cron-job.org](https://cron-job.org) (free), create a job every **10 minutes**:
   `POST https://<service>.onrender.com/jobs/tick` with header
   `Authorization: Bearer <JOB_TRIGGER_TOKEN>`.
5. Done. The SPA, API, and (later) MCP endpoint all live on the one URL.

**Paid mode** (when the client converts): Render Starter + custom domain + SPA on
Vercel — see PLAN.md §1.3 for the checklist. No code changes.

## Operations

- **Add a user / skills / permissions / deactivate**: Settings → Team.
- **Who can do what**: authorization is per user, not per role. Admins hold every
  permission implicitly; each member is granted exactly the capabilities they
  need (Settings → Team → Permissions). The closed set lives in
  `packages/shared/src/index.ts` (`PERMISSIONS`).
- **Rotate a secret**: change the env var on Render → redeploy. Rotating
  `BETTER_AUTH_SECRET` signs everyone out; rotating `JOB_TRIGGER_TOKEN` requires
  updating the cron-job.org header.
- **Backups**: Neon has point-in-time restore built in. (Weekly pg_dump artifact: M9.)
- **Logs**: Render dashboard → Logs (pino JSON; cookies/authorization redacted).

## Milestone status

| Milestone | Status |
|---|---|
| M0 scaffold & pipelines | ✅ built + verified locally (deploy pending accounts) |
| M1 schema, auth, users | ✅ done — login, forced pw change, per-user permissions, rate limiting |
| M2 core CRUD & screens | ✅ done — Home, Board, Project detail, Task detail, My Work |
| M3 handoff engine | ✅ done — 38 integration tests green |
| M4 reminders & notifications | ◐ engine + auto-rule done; email/digest/bell UI pending |
| M5 dashboards | ☐ |
| M6 ledger & finance | ☐ |
| M7 MCP server | ☐ |
| M8 sheet import | ☐ |
| M9 hardening & handover | ☐ |
