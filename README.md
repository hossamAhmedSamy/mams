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

### Demo data

To see the portal with a working week in it — five campaigns spread across the
Shooting → Editing chain, an edit waiting to be approved, two leave requests, two expense
claims, last month's payroll paid:

```bash
pnpm --filter @mams/api seed:demo   # WIPES the database, then refills it
```

Everyone signs in with `mams-demo-2026` (override with `DEMO_PASSWORD`):

| Account | Who |
|---|---|
| `adham@mams.local` | the owner — approves, decides, pays; not on his own payroll |
| `hazem@mams.local` | videographer, team lead (`team.viewAll`, `tasks.assign`) |
| `sama@mams.local` | photographer |
| `youssef@mams.local` · `mariam@mams.local` | editors |

The script refuses to run against a non-local `DATABASE_URL` unless `DEMO_FORCE=1`.

Open http://localhost:5173 and sign in. Admin creates all other accounts in
Settings → Team (no public signup exists, by design).

Tests (real-Postgres integration suite for the handoff engine and state machine):

```bash
pnpm --filter @mams/api test
```

## Deploy — trial mode ($0/month)

[`render.yaml`](render.yaml) is a Render Blueprint: it declares the whole service,
so this is four steps rather than a page of dashboard settings.

1. **Neon**: create a project → copy the **pooled** connection string (it ends in
   `?sslmode=require`). That is `DATABASE_URL`.
2. **Render**: **New → Blueprint** → pick this repo. Render reads `render.yaml`
   and asks for the four values it cannot generate:
   - `DATABASE_URL` — from step 1.
   - `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` — the first admin account
     (10+ chars; it is temporary, the app forces a change on first login).
   - `SEED_ADMIN_NAME` — optional, defaults to `Adham`.

   `BETTER_AUTH_SECRET` and `JOB_TRIGGER_TOKEN` are generated for you, and
   `BETTER_AUTH_URL` resolves itself from Render's `RENDER_EXTERNAL_URL`.
3. **Deploy.** The build runs migrations, seeds reference data and creates the
   admin — free instances have no Shell and no pre-deploy hook, so all three
   live in the build step. Every one is idempotent.
4. **External cron** (keeps reminders firing despite free-tier spin-down): on
   [cron-job.org](https://cron-job.org) (free), a job every **10 minutes**:
   `POST https://<service>.onrender.com/jobs/tick` with header
   `Authorization: Bearer <JOB_TRIGGER_TOKEN>` (copy it from Render → Environment).

Then delete `SEED_ADMIN_PASSWORD` from the Render environment, and add everyone
else from inside the app (Settings → Team).

**What the client should expect on the free tier.** The instance sleeps after 15
minutes of no traffic, so the first request after a quiet spell takes ~30–60s to
answer; everything after that is normal. The 10-minute cron doubles as a keep-alive,
which fits inside the 750 free instance-hours a month. Neon's compute also idles,
adding ~0.5s to the first query. Fine for a trial, not for a launch.

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
