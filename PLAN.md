# Agency Operations Portal — Build Plan

Single-tenant operations portal for one Egypt-based creative agency. Owner (Adham) runs
projects, assignments, deadlines, and money from it. Members see their work and nothing else.
This document is the implementation contract: Claude Code executes it milestone by milestone.

**Resolved [OPEN] items** (confirmed with the user on 2026-07-14):

| Item | Decision |
|---|---|
| Language | **English-only UI.** Arabic text works inside data fields (Unicode), but UI chrome and layout are English/LTR. No i18n framework. |
| Team size | **Under 10.** No Teams/Departments entity. Flat user list. |
| Hosting | **Frontend on Vercel, backend on Render**, Postgres on Neon. See §1.3. |
| Timeline | No hard deadline. Milestones ordered by value; each ships when solid. |

**Standing rules from the handoff brief (do not violate):**
- No multi-tenant scaffolding of any kind.
- Clients are records, not users. No client-facing surface.
- No sub-task layer — "18 reels" is one task (with an optional checklist field).
- Files live in Google Drive; the system stores links only.
- v1 MCP tools are read-only.
- Every close call on a feature: **cut it**. The failure mode is the team going back to WhatsApp.

**Owner-feedback amendments (2026-07-15, after first hands-on test):**
- **Every screen must work well on a phone** — the team uses it on location, mid-shoot.
  Bottom tab bar on mobile; tables become card lists; modals are bottom sheets.
- **Calendar screen** (all users): month grid of tasks spanning start→deadline; members see
  their own, admin sees everyone (color per person) and can click a day to add a task.
- **Multi-assign via helpers:** a task keeps exactly ONE accountable owner
  (`tasks.assignee_id`) plus optional **helpers** (`task_assignees` join). Helpers see the
  task in My Work, can act on it, and count as handoff Rule-B candidates (owner first).
- **Visible handoffs:** completing a chain task opens a confirmation dialog showing what
  happens next (`tasks.handoffPreview`), with admin able to override assignee/deadline
  inline (overrides are written to the successor as pre-assignment before completion).
- **Flow builder UI:** admins create/edit/save workflow templates and the stage catalog in
  Settings → Workflows (data model unchanged — this was always rows, now it has a screen).

---

## 1. Tech stack

### 1.1 Choices

| Layer | Choice | Why |
|---|---|---|
| Monorepo | **pnpm workspaces** (`apps/web`, `apps/api`, `packages/db`, `packages/shared`) | One repo, shared types, no publish step. No Turborepo/Nx — plain pnpm scripts are enough at this size. |
| Frontend | **React 18 + Vite + TypeScript** (SPA) | Internal tool behind login → no SSR/SEO need. In trial mode Fastify serves the built SPA from one origin; at upgrade Vercel takes over serving it (§1.3). Same build either way. |
| Routing | React Router v7 (library mode) | Boring, documented, sufficient. |
| UI kit | **Tailwind CSS + shadcn/ui**, Inter font, lucide icons | Pretty by default, fully ownable code (components copied into repo, not a dependency), consistent design tokens. See §8.1 for the visual system. |
| Data fetching | TanStack Query via **tRPC** client | End-to-end types from DB to component with zero API-drift — the single biggest maintainability win for a solo engineer. |
| Forms | react-hook-form + Zod resolvers | Shared Zod schemas validate on client and server from one definition. |
| Backend | **Node 22 + Fastify + tRPC** on Render (one always-on web service) | Long-running process → the reminder scheduler and MCP server are plain code, no serverless workarounds. Fastify: fast, minimal, first-class plugin/hook model for auth guards and security headers. |
| ORM / migrations | **Drizzle ORM + drizzle-kit** | SQL-shaped (no query-builder magic), fully typed, migrations are plain SQL files you can read. |
| Database | **PostgreSQL on Neon** (free tier) | Real free tier with branching + point-in-time restore. Render's own Postgres also works if you prefer one dashboard (from $7/mo); the app only sees `DATABASE_URL` either way. |
| Auth | **better-auth** (email + password, cookie sessions) | Battle-tested session handling, argon2 hashing, rate limiting built in. **No public signup** — admin creates accounts. |
| Email | **Resend** (free tier: 100/day) + React Email templates | One API call; templates are React components in the repo. |
| Scheduler | Idempotent job endpoint (`POST /jobs/tick`, token-authed) hit every 10 min by a **free external cron** (cron-job.org or a GitHub Actions schedule), plus an in-process 60s ticker while the service is warm | All job state lives in Postgres (`SKIP LOCKED` + dedupe keys), so the two triggers can overlap and restarts lose nothing. This is what makes Render's free tier viable (§1.3). No queue system — wrong scale. |
| MCP | `@modelcontextprotocol/sdk`, **Streamable HTTP** endpoint at `/mcp` on the same Fastify server | Same process, same service layer, one deploy. Adham connects Claude Desktop to `https://api.<domain>/mcp` with a bearer token. |
| Validation | **Zod at every boundary** (tRPC inputs, MCP tool inputs, CSV import, env vars) | One schema language everywhere. |

**Explicitly not used:** Next.js (split hosting makes SSR pointless), Redis/queues (Postgres + a ticker covers it), GraphQL, microservices, Docker in production (Render builds from the repo directly; a `docker-compose.yml` exists for local dev Postgres only).

### 1.2 Design patterns (applied, not decorative)

The backend is a **layered architecture** with strict one-way dependencies:

```
tRPC routers / MCP tools / scheduler jobs        ← transport & triggers (thin)
        ↓
services (task-service, handoff-engine, …)       ← ALL business rules live here
        ↓
repositories (Drizzle queries per aggregate)     ← ALL SQL lives here
        ↓
PostgreSQL
```

| Pattern | Where | Rule |
|---|---|---|
| **Service layer** | `apps/api/src/services/` | tRPC routers and MCP tools contain zero business logic — they validate input, check permissions, call one service method. This is what makes the MCP layer "near zero cost": both transports call the same functions. |
| **Repository** | `apps/api/src/repos/` | Services never import Drizzle directly. Repos return typed rows; services compose them. |
| **State machine** | `task-state.ts` | Task status transitions are an explicit allow-map (§5.3). Any transition not in the map throws. No status change happens outside `taskService.transition()`. |
| **Strategy** | Handoff assignment resolution (§4) | The three routing rules are an ordered list of resolver functions; adding a rule later = adding a function. |
| **Domain events** | `events.ts` — typed in-process emitter | Mutations emit events (`task.completed`, `task.assigned`, `task.flagged`…). Critical consequences (handoff, activity log) run **inside the same DB transaction**; side effects (notifications, email) run **after commit**. A crash between the two loses at most a notification, never data consistency. |
| **Template snapshot** | Project creation (§5.2) | Editing a workflow template never mutates existing projects — the chain is materialized as task rows at creation time. |
| **Guard/middleware (RBAC)** | tRPC `adminProcedure` / `memberProcedure` | Permission checks are declarative at the procedure level, plus object-level checks in services (§3). |

### 1.3 Deployment topology & cost

**Two modes, one codebase.** The agency pays nothing until Adham has used the portal for his
one-month trial; when he starts paying, the upgrade is a config flip (checklist below), not a
rework. Every milestone is built and accepted in trial mode.

**Trial mode — $0/month (what we launch):**

```
Browser ──HTTPS──▶ Render Web Service, FREE tier      <app>.onrender.com
                      ├── serves the built SPA (@fastify/static — single origin:
                      │     no CORS, no cross-site cookies, works on iPhone Safari)
                      ├── tRPC /trpc · MCP /mcp · /healthz
                      └── POST /jobs/tick ◀── free external cron every 10 min
                              │               (cron-job.org or GitHub Actions schedule,
                              │                token-authed)
                              ▼
                       Neon Postgres                                  free
Claude Desktop ──HTTPS + bearer──▶ <app>.onrender.com/mcp
Resend ◀── email API                                                  free tier
```

- **Why free-tier Render normally breaks this app, and how the tick fixes it:** free
  services spin down after 15 idle minutes, which would kill an in-process scheduler —
  reminders and digests would silently not fire. The external 10-minute tick solves it
  twice over: it *is* inbound traffic (so the service rarely idles out), and even after a
  spin-down the tick request wakes the service and runs any due jobs. One service running
  24/7 (~744 h) fits within the free tier's 750 instance-hours/month.
- **Honest trial-mode trade-offs:** an occasional ~1 min cold start if Render recycles the
  instance, and reminder precision of ±10 min instead of ±1 min. Both are acceptable for
  end-of-day reminders and a morning digest — and nothing is ever lost, because all job
  state is in Postgres (§6.1).
- Single origin also means **no domain purchase during the trial** — session cookies are
  first-party everywhere, including Safari on Adham's phone.
- Vercel can run free preview deploys of the SPA from day one, but is not in the serving
  path yet.

**Paid mode — when the client starts paying (~$7/mo + ~$10/yr domain):**

```
Browser ──HTTPS──▶ Vercel (static SPA)            app.<domain>      free (Hobby)
   │
   └──HTTPS/tRPC──▶ Render Starter (always-on)    api.<domain>      $7/mo
                        ├── /trpc · /mcp · /healthz    │
                        └── in-process scheduler now   ▼
                            primary; external tick job Neon Postgres  free
                            kept as backup
Claude Desktop ──HTTPS + bearer──▶ api.<domain>/mcp
```

**Upgrade checklist (an afternoon, zero code changes):** flip the Render service to Starter
→ buy the domain → point `app.` (Vercel) and `api.` (Render) subdomains → deploy the SPA to
Vercel with `VITE_API_URL=https://api.<domain>` → set the session cookie domain to the apex
→ verify login on an iPhone. The domain is required in this mode because
`*.vercel.app` → `*.onrender.com` is a cross-site request and Safari blocks third-party
cookies; one registrable domain makes the cookie same-site again.

- Backups in both modes: Neon point-in-time restore (built in) + a weekly `pg_dump`
  GitHub Action artifact.

### 1.4 Repository layout

```
apps/
  web/                 # Vite SPA → Vercel
    src/{routes,components,features,lib}
  api/                 # Fastify → Render
    src/
      trpc/            # routers (thin)
      mcp/             # MCP server + tool defs (thin)
      services/        # business logic (fat)
      repos/           # Drizzle queries
      jobs/            # scheduler ticker + daily cron
      email/           # React Email templates
      security/        # auth config, guards, rate limits, headers
packages/
  db/                  # Drizzle schema, migrations, seed scripts
  shared/              # Zod schemas, enums, shared types/constants
docker-compose.yml     # local Postgres only
```

### 1.5 Configuration (env inventory)

| Var | Service | Notes |
|---|---|---|
| `DATABASE_URL` | api | Neon pooled connection string |
| `BETTER_AUTH_SECRET` | api | 32+ random bytes |
| `APP_ORIGIN` | api | own origin in trial mode (no CORS needed); `https://app.<domain>` in paid mode — CORS allowlist + cookie domain |
| `RESEND_API_KEY` | api | |
| `MCP_BEARER_TOKEN` | api | long random; read-scope for MCP clients |
| `JOB_TRIGGER_TOKEN` | api | long random; required by `POST /jobs/tick` (external cron sends it) |
| `TZ_BUSINESS` | api | `Africa/Cairo` — all "end of day" / digest math |
| `DIGEST_HOUR` / `REMINDER_EOD_HOUR` | api | defaults `8` / `18` (local) |
| `VITE_API_URL` | web | empty (same origin) in trial mode; `https://api.<domain>` in paid mode |

All parsed and validated by a Zod env schema at boot; the process refuses to start on a
missing var.

---

## 2. Database schema

Conventions: `uuid` PKs (`gen_random_uuid()`), `timestamptz` for instants (UTC), `date` for
business dates, money as `numeric(12,2)` (single currency, EGP — a constant, not a column).
Postgres enums for closed sets. Soft-delete via `active`/`archived` flags only where listed —
everything else hard-deletes with an activity-log record.

### 2.1 Tables

**better-auth managed:** `user`, `session`, `account`, `verification` (created by its CLI).
The `user` table is extended with app columns:

```sql
user (better-auth base: id text PK, name, email UNIQUE, emailVerified, image, createdAt, updatedAt)
  + role                 text NOT NULL DEFAULT 'member'  CHECK (role IN ('admin','member'))
  + banned               boolean NOT NULL DEFAULT false  -- "active" in the UI = NOT banned; better-auth blocks banned sign-ins
  + must_change_password boolean NOT NULL DEFAULT true   -- forced change on first login of provisioned accounts
```

```sql
skills
  id          uuid PK
  name        text NOT NULL UNIQUE            -- 'Videographer', 'Editor', …
  active      boolean NOT NULL DEFAULT true

user_skills
  user_id     text  FK → user(id)  ON DELETE CASCADE
  skill_id    uuid  FK → skills(id)
  PRIMARY KEY (user_id, skill_id)

clients
  id          uuid PK
  name        text NOT NULL UNIQUE
  notes       text
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived'))
  created_at  timestamptz NOT NULL DEFAULT now()

stages                                        -- global stage catalog (admin-extensible)
  id                     uuid PK
  name                   text NOT NULL UNIQUE -- 'Shooting', 'Editing', …
  default_duration_days  int  NOT NULL DEFAULT 3   -- deadline offset at activation
  reminder_rule          text NOT NULL DEFAULT 'none'
                         CHECK (reminder_rule IN ('none','end_of_last_day'))
  sort_order             int  NOT NULL DEFAULT 0
  active                 boolean NOT NULL DEFAULT true

stage_skills                                  -- skills that QUALIFY for a stage (any-of)
  stage_id    uuid FK → stages(id) ON DELETE CASCADE
  skill_id    uuid FK → skills(id)
  PRIMARY KEY (stage_id, skill_id)

workflow_templates
  id          uuid PK
  name        text NOT NULL UNIQUE            -- 'Reels / Video', 'Photo', 'Design'
  active      boolean NOT NULL DEFAULT true

template_stages
  id                 uuid PK
  template_id        uuid FK → workflow_templates(id) ON DELETE CASCADE
  stage_id           uuid FK → stages(id)
  position           int  NOT NULL            -- 1-based order in the chain
  requires_approval  boolean NOT NULL DEFAULT false   -- the escape hatch; seeded OFF
  UNIQUE (template_id, position)

projects
  id                    uuid PK
  client_id             uuid FK → clients(id) NOT NULL
  title                 text NOT NULL         -- '18 reels', 'August calendars'
  campaign              text                  -- free text, optional
  priority              text NOT NULL DEFAULT 'medium' CHECK (priority IN ('high','medium','low'))
  status                text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','on_hold','completed','archived'))
  workflow_template_id  uuid FK → workflow_templates(id)   -- null = ad-hoc project
  start_date            date
  due_date              date
  drive_link            text
  notes                 text
  created_by            text FK → user(id)
  created_at            timestamptz NOT NULL DEFAULT now()
  completed_at          timestamptz

tasks
  id                 uuid PK
  project_id         uuid FK → projects(id) ON DELETE CASCADE NOT NULL
  stage_id           uuid FK → stages(id)    -- null = ad-hoc task outside any chain
  chain_position     int                     -- null = ad-hoc; else position in project chain
  title              text NOT NULL           -- defaults to stage name; editable
  details            text
  assignee_id        text FK → user(id)      -- exactly one accountable person (or null = unassigned)
  status             text NOT NULL DEFAULT 'waiting'
                     CHECK (status IN ('waiting','todo','in_progress','awaiting_approval','done'))
  requires_approval  boolean NOT NULL DEFAULT false  -- SNAPSHOT from template_stages at creation
  flagged            boolean NOT NULL DEFAULT false  -- Adham's 'Needs Attention'
  flag_note          text
  start_date         date
  deadline           date
  drive_link         text
  checklist          jsonb                   -- [{ "text": "reel 1", "done": false }, …] or null
  created_by         text FK → user(id)
  created_at         timestamptz NOT NULL DEFAULT now()
  activated_at       timestamptz             -- when it became 'todo'
  completed_at       timestamptz
  UNIQUE (project_id, chain_position)        -- (partial: WHERE chain_position IS NOT NULL)

comments
  id          uuid PK
  task_id     uuid FK → tasks(id) ON DELETE CASCADE
  author_id   text FK → user(id)
  body        text NOT NULL
  created_at  timestamptz NOT NULL DEFAULT now()

reminders
  id              uuid PK
  task_id         uuid FK → tasks(id) ON DELETE CASCADE
  project_id      uuid FK → projects(id) ON DELETE CASCADE
  target_user_id  text FK → user(id) NOT NULL
  fire_at         timestamptz NOT NULL
  message         text NOT NULL
  source          text NOT NULL CHECK (source IN ('auto','admin'))
  dedupe_key      text UNIQUE                -- e.g. 'task:<id>:stage-default'; auto rules upsert on this
  fired_at        timestamptz               -- null = pending
  canceled_at     timestamptz
  created_by      text FK → user(id)         -- null for source='auto'
  created_at      timestamptz NOT NULL DEFAULT now()
  CHECK (num_nonnulls(task_id, project_id) = 1)

notifications                                 -- in-app feed; email is a delivery detail
  id           uuid PK
  user_id      text FK → user(id) NOT NULL
  type         text NOT NULL                 -- catalogue key, §9
  title        text NOT NULL
  body         text
  entity_type  text                          -- 'task' | 'project' | null
  entity_id    uuid
  read_at      timestamptz
  created_at   timestamptz NOT NULL DEFAULT now()

activity_log                                  -- append-only; the bottleneck-analysis source
  id           bigint GENERATED ALWAYS AS IDENTITY PK
  actor_id     text FK → user(id)            -- null = system (handoff engine, scheduler)
  entity_type  text NOT NULL                 -- 'task','project','client','expense','income','user','settings'
  entity_id    uuid NOT NULL
  action       text NOT NULL                 -- 'created','status_changed','assigned','flagged',
                                             -- 'deadline_changed','reopened','handoff','imported', …
  detail       jsonb                         -- { "from": …, "to": …, … }
  created_at   timestamptz NOT NULL DEFAULT now()

job_runs                                      -- idempotency marker for once-a-day jobs
  job_name  text NOT NULL                     -- 'digest', 'overdue_sweep'
  run_on    date NOT NULL                     -- business date (Africa/Cairo)
  ran_at    timestamptz NOT NULL DEFAULT now()
  PRIMARY KEY (job_name, run_on)

expense_categories
  id      uuid PK
  name    text NOT NULL UNIQUE
  active  boolean NOT NULL DEFAULT true

expenses
  id            uuid PK
  project_id    uuid FK → projects(id) NOT NULL
  category_id   uuid FK → expense_categories(id) NOT NULL
  amount        numeric(12,2) NOT NULL CHECK (amount > 0)
  spent_on      date NOT NULL
  note          text
  vendor        text
  receipt_link  text
  created_by    text FK → user(id)
  created_at    timestamptz NOT NULL DEFAULT now()

incomes
  id           uuid PK
  project_id   uuid FK → projects(id) NOT NULL
  amount       numeric(12,2) NOT NULL CHECK (amount > 0)
  received_on  date NOT NULL
  note         text
  created_by   text FK → user(id)
  created_at   timestamptz NOT NULL DEFAULT now()
```

### 2.2 Indexes

```sql
tasks:        (assignee_id, status), (deadline), (project_id), (status) WHERE status <> 'done'
reminders:    (fire_at) WHERE fired_at IS NULL AND canceled_at IS NULL
notifications:(user_id, read_at)
activity_log: (entity_type, entity_id, created_at), (created_at)
expenses:     (project_id), (category_id, spent_on)
incomes:      (project_id)
comments:     (task_id)
projects:     (client_id), (status)
```

### 2.3 Seed data

Revised with the owner (2026-08-02): the agency runs **one** shape of work, so the
reference data is that shape and nothing else. A menu of workflows nobody chooses
between is a decision the portal asks for and never uses.

**Skills:** Videographer · Photographer · Editor

**Stages** (name → qualifying skills → default duration → reminder rule):

| Stage | Qualifying skills | Days | Reminder rule |
|---|---|---|---|
| Shooting | Videographer, Photographer | 1 | **end_of_last_day** |
| Editing | Editor | 3 | none |

**Template:**

| Template | Chain |
|---|---|
| Campaign | Shooting → **Editing (requires approval)** |

Every campaign is that chain. The approval flag on Editing is the owner's control point:
the edit comes back to him before the campaign counts as delivered — which is what makes
this a work regulator rather than a list. ("Custom" is not a template row — it's the ad-hoc
path: a project with no template whose tasks are created by hand.)

The engine itself stays a general chain machine; the four-stage fixture the handoff tests
need lives in `apps/api/src/test/fixtures.ts`, not in the shipped seed.

**Expense categories:** Salaries · Equipment rental · Transport · Talent · Location ·
Freelancer fees · Props · Other

**Users:** the owner (admin — every permission implicitly, no salary, no leave balance) and
the crew (members, each with their skills; grants added per person in Settings). See
`pnpm --filter @mams/api seed:demo` for a full working week of this shape.

---

## 3. Permission matrix

Two roles only. Enforced twice: at the tRPC procedure level (`adminProcedure` /
`protectedProcedure`) and object-level inside services where marked ⁽ᵒ⁾.

| Entity / action | Admin | Member |
|---|---|---|
| Log in / view own profile, change own password | ✔ | ✔ |
| Users: create, edit, set skills, deactivate | ✔ | ✖ |
| Clients: view | ✔ | ✔ (name only, on project context) |
| Clients: create / edit / archive | ✔ | ✖ |
| Projects: view list & detail | ✔ | ✔ (no ledger tab) |
| Projects: create / edit / change status / delete | ✔ | ✖ |
| Tasks: view | ✔ | ✔ |
| Tasks: create / edit fields / reassign / set deadline / delete | ✔ | ✖ |
| Tasks: status transition | ✔ (any legal transition) | ✔ ⁽ᵒ⁾ **own tasks only**: todo→in_progress→done (or →awaiting_approval) |
| Tasks: edit checklist, set drive_link | ✔ | ✔ ⁽ᵒ⁾ own tasks only |
| Tasks: flag / unflag | ✔ | ✖ |
| Tasks: reopen (done → in_progress) | ✔ | ✖ |
| Approve / reject `awaiting_approval` | ✔ | ✖ |
| Comments: create | ✔ | ✔ (any task) |
| Comments: delete | ✔ | ✔ ⁽ᵒ⁾ own comments |
| Reminders: create / cancel custom | ✔ | ✖ |
| Reminders / notifications: receive & mark read | ✔ | ✔ (own) |
| Expenses / incomes / categories: everything | ✔ | ✖ (members never see money) |
| Finance reports | ✔ | ✖ |
| Time off: request own, withdraw own pending, see own balance | ✔ | ✔ (own only) |
| Time off: decide requests, log leave for others, set allowances | ✔ / `hr.manage` | ✖ |
| Who is off (names + dates, no reasons) | ✔ | ✔ (shared calendar) |
| Salaries & payroll: set pay, prepare, adjust, mark paid | ✔ / `hr.manage` | ✖ |
| Own salary + own **paid** payslips | ✔ | ✔ (own only; drafts stay with the owner) |
| Activity log: view | ✔ | ✔ ⁽ᵒ⁾ only on tasks they can see (i.e., all tasks; but no finance entries) |
| Settings: skills, stages, templates, defaults | ✔ | ✖ |
| CSV import | ✔ | ✖ |
| MCP access | bearer token (admin-scope read-only) | — |

Deliberate simplicity: members **can** see the whole board (coordination beats secrecy in a
7-person agency) but **never** money, settings, or other people's controls.

---

## 4. The handoff engine

Runs inside `taskService.transition(taskId, 'done', actor)` — same DB transaction as the
status write. Never callable from anywhere else.

### 4.1 Pseudocode

```
function completeTask(task, actor):                        # inside one DB transaction
  # -- guard: idempotent completion --------------------------------------
  updated = UPDATE tasks SET status='done', completed_at=now()
            WHERE id = task.id AND status IN ('in_progress','todo','awaiting_approval')
            RETURNING *
  if updated is empty: abort("already done or not startable")   # concurrent double-complete

  log(actor, task, 'status_changed', {from: task.status, to: 'done'})
  cancelPendingAutoReminders(task)
  emitAfterCommit(notify.admin, 'stage_completed', task)

  # -- approval gate (escape hatch; default OFF) -------------------------
  # note: transition() routes to 'awaiting_approval' instead of here when
  # task.requires_approval AND actor is not admin. Admin approval calls
  # completeTask again with status 'awaiting_approval' → proceeds below.

  # -- find successor -----------------------------------------------------
  if task.chain_position is null: return                   # ad-hoc task: no chain
  next = SELECT * FROM tasks WHERE project_id = task.project_id
         AND chain_position = task.chain_position + 1  FOR UPDATE

  if next is null:                                         # LAST STAGE IN CHAIN
      if all chain tasks of project are 'done':
          project.status = 'completed'; project.completed_at = now()
          log(system, project, 'status_changed', {to:'completed'})
          emitAfterCommit(notify.admin, 'project_completed', project)
      return

  if next.status != 'waiting': return                      # already activated earlier
                                                           # (e.g. this task was reopened
                                                           #  and completed a second time)
  # -- resolve assignee: ordered strategies -------------------------------
  assignee = null, route = null

  if next.assignee_id is not null:                         # RULE A: explicit pre-assignment
      pre = getUser(next.assignee_id)
      if pre.active: assignee = pre;         route = 'pre_assigned'
      else:          next.assignee_id = null                # inactive → fall through
                     log(system, next, 'assignment_cleared', {reason:'assignee_inactive'})

  if assignee is null:                                     # RULE B: completer keeps the job
      required = qualifyingSkills(next.stage_id)           # any-of set from stage_skills
      completer = getUser(task.assignee_id)                # may be null (task was unassigned)
      if completer?.active and completer.skills ∩ required ≠ ∅:
          assignee = completer;              route = 'same_person'

  # -- activate the successor ---------------------------------------------
  next.status      = 'todo'
  next.activated_at= now()
  next.start_date  = today(TZ_BUSINESS)
  if next.deadline is null:                                # admin may have set one already;
      next.deadline = today + stage.default_duration_days  # never overwrite an explicit deadline
  next.assignee_id = assignee?.id                          # may stay null

  log(system, next, 'handoff', {from_task: task.id, route: route ?? 'unassigned'})
  scheduleStageAutoReminder(next)                          # §6.2, only if assigned

  if assignee:
      emitAfterCommit(notify.user(assignee), 'task_assigned', next)
  else:                                                    # RULE C: unassigned queue
      emitAfterCommit(notify.admin, 'handoff_unassigned', next)
```

> **One deliberate refinement of the brief, flagged for sign-off:** the brief orders the
> rules (1) completer-has-skill, (2) pre-assignment, (3) queue. This plan checks
> **pre-assignment first**. Reason: the two decided statements conflict — if the completer's
> skill always won, an explicit admin pre-assignment could never route the next stage away
> from a multi-skilled completer, contradicting "always overridable by the admin," and Adham
> would be back to chasing/reassigning after the fact. Explicit intent beats heuristic. The
> "he's editor *and* videographer → he keeps the job" case still works exactly as decided
> whenever no pre-assignment exists. If Adham wants the brief's literal order, it's a
> two-line swap.

### 4.2 Chain materialization (why "create the next task" is "activate the next task")

At project creation from a template, **the whole chain is created as task rows up front**:
position 1 gets `status='todo'` (assigned or straight to the unassigned queue), all others
`status='waiting'`. Consequences, all wins:

- Pre-assignment is not a separate concept or table — it's just setting `assignee_id` on a
  `waiting` task, "allowed at any time" exactly as decided.
- The project screen shows the whole pipeline including future stages — visibility for free.
- Handoff = flip `waiting → todo`, which is trivially idempotent (§4.1's `!= 'waiting'` guard).
- Deadlines are still computed at **activation** time, not creation time, per the brief.

### 4.3 Edge cases (explicit answers)

| Case | Behavior |
|---|---|
| Completer holds multiple qualifying skills | Irrelevant — the check is set-intersection with the stage's any-of skill set. |
| Stage has multiple qualifying skills (Shooting: Videographer/Photographer) | `stage_skills` is many-to-many; any overlap qualifies. |
| Pre-assigned user is inactive | Assignment cleared + logged; falls through to completer-skill rule, then queue. |
| Completing task was itself unassigned (admin closed it out) | Rule B skipped (`completer` null); pre-assignment or queue. |
| Last stage in chain | No successor; if every chain task is done → project auto-completes, admin notified. Reopening any task flips the project back to `active`. |
| Task reopened after completion (admin only) | `done → in_progress`. If the successor is still untouched (`todo`, no status change since activation) it reverts to `waiting`, its auto-reminder is canceled, and its auto-set deadline is cleared (a manually set deadline survives). If the successor is `in_progress`/`done`, it is left alone and both tasks are flagged to the admin — a human must untangle real work. |
| Reopened task completed a second time | The `next.status != 'waiting'` guard makes re-handoff a no-op if the successor was already activated. |
| Ad-hoc tasks (no chain_position) | Completion logs + notifies; no handoff. |
| `requires_approval` stage (default off) | Member "done" lands on `awaiting_approval`; admin Approve runs the completion path above; Reject → `in_progress` + flag + note. |
| Admin manually assigns/edits a `waiting` task | Always allowed; that *is* pre-assignment. |
| Concurrent double completion | Conditional `UPDATE … WHERE status IN (…)` + `FOR UPDATE` on the successor inside one transaction. |

---

## 5. Workflow template engine

### 5.1 Storage

Already in §2: `stages` (catalog: name, any-of `stage_skills`, `default_duration_days`,
`reminder_rule`) + `workflow_templates` + ordered `template_stages` (with per-template
`requires_approval`). Skills, stages, templates, durations, categories: **all rows, no code**.
The admin settings screen edits them directly.

### 5.2 Evaluation

- **Project creation:** choose client, title, priority, dates, template (or "no template").
  Server snapshots the template: one task per `template_stages` row, ordered
  `chain_position`, `title = stage.name`, `requires_approval` copied onto the task. First
  task → `todo` (+ optional assignee picked in the create form); rest → `waiting`.
- **Template edits** (reorder, add/remove stages) affect **future projects only**.
  Templates/stages/skills with history are deactivated (`active=false`), never deleted.
- **Stage deletion guard:** a stage referenced by any template or task can only be
  deactivated.
- Deactivating a template hides it from the project-create picker; running projects are
  untouched (their chain is already materialized).

### 5.3 Task state machine (the only legal transitions)

```
waiting → todo                    (handoff activation, or admin manual activation)
todo → in_progress                (assignee or admin)
in_progress → done                (assignee where requires_approval=false; admin always)
in_progress → awaiting_approval   (assignee where requires_approval=true)
awaiting_approval → done          (admin approve)
awaiting_approval → in_progress   (admin reject → auto-flag + note)
done → in_progress                (admin reopen; triggers §4.3 reopen logic)
todo → waiting                    (system only: reopen-revert of an untouched successor)
```

Anything else throws `IllegalTransition`. Every transition writes `activity_log`.

---

## 6. Reminder engine

### 6.1 Firing mechanics

Two triggers funnel into the same idempotent `runDueJobs()` function: a 60-second in-process
ticker (while the service is warm) and `POST /jobs/tick` — authenticated with
`JOB_TRIGGER_TOKEN` and hit every 10 minutes by a free external cron (cron-job.org or a
GitHub Actions schedule). The external tick is the trial-mode guarantee (§1.3): even if the
free-tier service was spun down, the request wakes it and due jobs run. Overlapping triggers
are harmless by construction:

```sql
SELECT * FROM reminders
WHERE fired_at IS NULL AND canceled_at IS NULL AND fire_at <= now()
ORDER BY fire_at LIMIT 50
FOR UPDATE SKIP LOCKED
```

For each: create `notifications` row + send immediate email (§9), set `fired_at`. State is
entirely in Postgres → restarts lose nothing, and `SKIP LOCKED` makes it safe even if two
instances ever run.

### 6.2 Auto rule: "end of last shooting day", generalized

Per the brief, generalized to a per-stage `reminder_rule`; v1 ships two values:

- `none` — no automatic reminder.
- `end_of_last_day` — when a task in this stage is **activated with an assignee and a
  deadline**, upsert (on `dedupe_key = 'task:<id>:stage-default'`) a reminder for the
  assignee at `deadline @ 18:00 Africa/Cairo`, message: *"<task> — today is the last day.
  Wrap up and mark it done."*

Lifecycle hooks (all in `taskService`):
- Deadline changed → reschedule `fire_at` on the same dedupe row (if unfired).
- Task completed / reverted to waiting → `canceled_at = now()` on unfired auto reminders.
- Reassigned → retarget the unfired reminder to the new assignee.

Seeding gives Shooting `end_of_last_day` — the decided default, as data. New rules later
(e.g. `day_before_deadline`) are one enum value + one case in the rule evaluator.

### 6.3 Custom reminders

Admin-only form on any task or project: target user, datetime (Cairo local, stored UTC),
message. Fires identically. Listed (pending/fired) on the entity's detail page; cancelable
while pending.

### 6.4 Daily jobs (run from the same tick)

Each tick checks: has this job's local-time window passed today, and is there no `job_runs`
row for (job, today)? If so, run it and insert the marker in the same transaction — once per
day, restart- and overlap-safe, and late-but-never-skipped if the service was asleep at the
scheduled minute.

- **08:30 Cairo — digest** per active user (§9): overdue, due today, unread flags; admin
  digest adds unassigned queue + yesterday's completions. Skipped entirely when empty —
  "few and actionable."
- **09:00 Cairo — overdue sweep:** tasks `deadline < today` and not done → immediate
  notification to assignee (deduped: once per task per day) ; feeds the admin dashboard's
  Overdue tile (which is computed live regardless).

---

## 7. API surface & MCP tools

### 7.1 tRPC routers (transport for the web app)

All under `/trpc`, session-cookie auth. `A` = adminProcedure, `P` = protectedProcedure
(any active user). Queries (Q) / mutations (M).

| Router | Procedures |
|---|---|
| `auth` | handled by better-auth routes (`/api/auth/*`): sign-in, sign-out, change-password |
| `users` | P·Q `me` · A·Q `list` · A·M `create` (temp password), `update`, `setSkills`, `setActive` |
| `skills` | P·Q `list` · A·M `create`, `rename`, `setActive` |
| `clients` | P·Q `list`, `get` · A·M `create`, `update`, `archive` |
| `projects` | P·Q `list` (filters: client, status, priority, q), `get` (chain + tasks; ledger only for admin) · A·M `create` (template snapshot §5.2), `update`, `setStatus`, `delete` |
| `tasks` | P·Q `myWork`, `list` (filters: project, assignee, stage, status, overdue, unassigned, flagged), `get` · P·M `transition` (state machine §5.3, object-level authz), `updateChecklist`, `setDriveLink` · A·M `create` (ad-hoc), `update`, `assign`, `setDeadline`, `flag`, `unflag`, `approve`, `reject`, `reopen`, `delete` |
| `comments` | P·Q `listByTask` · P·M `create`, `delete` (own; admin any) |
| `reminders` | P·Q `mine` · A·Q `listByEntity` · A·M `create`, `cancel` |
| `notifications` | P·Q `list`, `unreadCount` · P·M `markRead`, `markAllRead` |
| `workflows` | P·Q `listTemplates`, `listStages` · A·M `createTemplate`, `updateTemplate` (ordered stage list), `setTemplateActive`, `createStage`, `updateStage` (duration, reminder_rule, skills), `setStageActive` |
| `finance` | all A · Q `projectLedger`, `profitByProject`, `spendByCategory` (from/to), `listCategories` · M `addExpense`, `updateExpense`, `deleteExpense`, `addIncome`, `updateIncome`, `deleteIncome`, `createCategory`, `updateCategory` |
| `dashboard` | A·Q `overview` (overdue, dueThisWeek, unassigned, flagged, workload) · P·Q `board` (projects × stages grid data) |
| `activity` | P·Q `forEntity` · A·Q `recent` |
| `import` | A·M `parse` (CSV → typed preview + issues), `commit` (idempotent, §11) |

### 7.2 MCP tools (read-only, v1)

Mounted at `/mcp` (Streamable HTTP), `Authorization: Bearer ${MCP_BEARER_TOKEN}`. Every tool
is a thin wrapper over the **same service functions** the dashboard queries use. Errors
return MCP tool-error content, never stack traces.

| Tool | Input (Zod) | Output |
|---|---|---|
| `list_projects` | `{ status?, client?, priority? }` | Array: id, client, title, campaign, priority, status, due_date, current_stage, is_late |
| `get_project` | `{ id }` (uuid or exact title) | Project + full task chain (stage, assignee, status, deadline) + ledger totals (income, expenses, profit) |
| `list_tasks` | `{ overdue?, unassigned?, flagged?, assignee?, stage?, client?, status? }` | Array: id, project, client, title, stage, assignee, status, deadline, days_overdue, flagged |
| `get_workload` | `{ within_days? = 7 }` | Per active user: open task count, due-in-window count, overdue count, task titles |
| `get_project_finances` | `{ id }` | Ledger lines + totals + profit |
| `get_expenses_by_category` | `{ from?, to?, category? }` | Rows: category, total, count; plus grand total |
| `get_activity_log` | `{ entity_type?, entity_id?, since?, limit? = 50 }` | Chronological log entries, humanized |

Write tools (`create_task`, `reassign`, `set_deadline`) are **v2 by decision** — not stubbed,
not scaffolded.

**Client setup (documented in README):** Claude Desktop / Claude Code connect via remote MCP
(`mcp-remote` bridge or native remote server support) pointing at
`https://api.<domain>/mcp` with the bearer token. No embedded chat UI in v1.

### 7.3 Security hardening (applies to the whole API)

- **AuthN:** better-auth email+password (scrypt, better-auth's default KDF), httpOnly + Secure + SameSite=Lax session
  cookie (same-origin in trial mode; scoped to the apex domain in paid mode); sliding expiry
  30 days; login rate-limited
  (5/min/IP + per-account backoff). **No signup route exists.** Admin creates users with a
  temp password; forced change on first login.
- **AuthZ:** role check at procedure level, object-level checks in services (own-task rule).
  MCP bearer is constant-time compared, read-only by construction (no mutation service is
  imported in the MCP module).
- **Input:** Zod on every tRPC/MCP/import input; Drizzle parameterizes all SQL; drive/receipt
  links validated as `https://` URLs (drive.google.com allowlist warning, not block).
- **Transport/headers:** HTTPS only (platform TLS), HSTS, `helmet`-equivalent Fastify headers,
  strict CORS: `APP_ORIGIN` only, credentials allowed, `Origin` verified on mutations
  (CSRF defense-in-depth on top of SameSite).
- **Output discipline:** password hashes never leave the auth layer; member-facing
  serializers exclude finance fields at the type level (separate DTOs, not runtime filtering).
- **Secrets & ops:** env-only secrets, Zod-validated at boot; `pino` structured logs with
  redaction; `/healthz`; weekly `pg_dump` artifact + Neon PITR; `pnpm audit` in CI.
- **Audit:** every mutation writes `activity_log` with actor — including admin actions.

---

## 8. Screens

### 8.1 Visual system (one system, applied everywhere)

- **Layout:** left sidebar nav (icons + labels; collapses to bottom tab bar on mobile for
  members: My Work · Board · Notifications). Content max-width 1200px, generous whitespace,
  cards with 8px radius and subtle borders — no heavy shadows.
- **Type:** Inter; 14px base, 20px section titles, tabular numerals for money/dates.
- **Color:** neutral gray scale + **one accent (indigo)** for primary actions and focus
  rings. Status is the only other color in the app, used consistently:
  overdue **red** · due ≤48h **amber** · in progress **blue** · done **green** ·
  waiting **gray** · flagged **orange badge**. Priority = small colored dot (red/amber/gray),
  never a colored row.
- **States, mandatory for every screen:** skeleton loaders (no spinners on lists), designed
  empty states with one CTA ("No tasks — enjoy the quiet" / "Create your first project"),
  inline error banners with a Retry button, optimistic updates with rollback toasts for
  status changes.
- **The next-action rule (the overriding constraint):** every task card everywhere shows at
  most **one primary button** — the single legal next transition for *this viewer*
  (Start → Mark done → —). If a viewer can't act, no button. This is §3's state machine
  rendered as UI.

### 8.2 Screen-by-screen

**Login** — email + password, error state, forced password change on first login. Nothing else.

**My Work** *(member landing page; must be excellent on a phone)*
- Sections in order: **Flagged** (orange banner cards with Adham's note) → **Overdue** →
  **Today** → **This week** → **Later** → collapsed **Done (last 7 days)**.
- Task card: project + client, task title, deadline chip (relative: "2 days late"), stage,
  the one primary action button, checklist progress (3/6) if present, Drive link icon,
  comment count. Tap → task detail.
- Pending reminders for me shown as a slim strip at top.
- Empty state: "Nothing assigned. 🎉"
- A member never *needs* to leave this screen — acceptance criterion, not aspiration.

**Board / Projects** *(everyone)*
- Toggle: **Projects table** (default) ⇄ **Stage board**.
- Table: client, title, priority dot, current stage chip, assignee avatar, due date,
  progress (2/4 stages), status. Filters: client, assignee, priority, status, "late only".
  Sorted by due date; late rows get a red left edge.
- Stage board: columns = stages (union of active chains), cards = active tasks. Same filters.
- Row/card click → Project detail.

**Project detail**
- Header: client, title, campaign, priority, dates, status, Drive link, notes (admin: inline
  editable).
- **Chain visualization:** horizontal stepper of the task chain — done ✓ / active (colored,
  assignee avatar, deadline) / waiting (gray, pre-assignable by admin via avatar dropdown —
  this *is* the pre-assignment UI).
- Tabs: **Tasks** (chain + ad-hoc list) · **Activity** (log timeline) · **Ledger** (admin
  only: income/expense lines, running profit, add-line forms) · **Reminders** (admin).

**Task detail** *(drawer on desktop, page on mobile)*
- Title, project/client, stage, assignee (admin can change), status with the one action
  button, deadline (admin editable), details, Drive link, checklist (assignee can tick;
  progress bar), flag banner if flagged (admin: Flag/Unflag with note).
- Comments thread (all users) with @-free simplicity — plain text, newest last.
- Activity sub-list (transitions, handoffs, deadline changes).

**Home — the owner's deck** *(built 2026-08-02; `dashboard.deck`)*

Home is one route for everyone, but it answers a different question depending on who opens
it. A crew member's day is their own tasks. The owner's day is other people's work, so his
Home leads with the company and puts his own tasks last:

1. **Waiting on you** — one list, three kinds of thing, in the order they block others:
   edits to approve, time-off requests, expense claims. An approval is a button *here*
   (two seconds, no context needed); anything with money or a leave balance behind it links
   to the screen that shows the whole picture.
2. **On the floor** — Late · Running today · Nobody on it · Campaigns live, each a link into
   the filtered list, followed by the late and today rows themselves.
3. **Who's away** and **This month** (in / out / net) side by side.

Every block is permission-gated server-side (`tasks.approve`, `hr.manage`, `money.*`,
`team.viewAll`), so granting one slice of authority to a member shows them that slice only.
The deck is skipped entirely for someone holding none of them.

**Admin Dashboard — earlier spec, superseded in part by the deck above**
- Four stat tiles: **Overdue · Due this week · Unassigned · Flagged** — each tappable,
  expands the corresponding list below (task rows with quick actions: assign via dropdown,
  bump deadline, open).
- **Unassigned queue** list is the same data as the tile — quick-assign resolves a handoff
  Rule-C item in two taps.
- **Workload:** horizontal bars per person — open tasks now / due this week / overdue
  (stacked). Built per the dataviz skill during implementation.
- **Finances snapshot:** profit per active project (top 5 table) + spend by category
  (current month, donut) with a link to the full report page.
- **Recent activity** feed (last 20).

**Finance report page** *(admin)* — date-range picker; profit per project table
(income/expenses/profit, sortable); spend by category over the range; CSV export button.

**Clients** *(admin)* — list with active project counts; detail = client info + their
projects + lifetime totals (admin).

**Settings** *(admin)* — tabs: **Users** (create with temp password, role, skills
multi-select, active toggle) · **Skills** · **Stages** (duration default, reminder rule,
qualifying skills) · **Templates** (drag-order stage list, requires_approval toggle per
stage) · **Expense categories** · **Import** (§11 wizard).

**Notifications** *(everyone)* — bell + unread badge in the header; panel lists §9 items,
mark-read on click, "mark all read".

---

## 9. Notification catalogue

Two delivery classes, per the decided discipline: **Immediate** (in-app + email at event
time — reserved for actionable-now) and **Digest** (rolled into the 08:30 daily email; in-app
row created at event time). Nothing else emails. In-app rows are created for everything
listed.

| # | Event | Recipient | Class | Template (subject / lead) |
|---|---|---|---|---|
| 1 | Task assigned to you (handoff or manual) | assignee | **Immediate** | "New task: <task> — <project> (due <date>)" |
| 2 | Task flagged by Adham | assignee | **Immediate** | "⚑ Needs attention: <task> — <note>" |
| 3 | Reminder fired (auto or custom) | target user | **Immediate** | reminder message verbatim |
| 4 | Task became overdue (daily sweep, once/day/task) | assignee | **Immediate** | "Overdue: <task> was due <date>" |
| 5 | Handoff landed unassigned (Rule C) | admin | **Immediate** | "Unassigned: <stage> for <project> needs a person" |
| 6 | Approval requested (`requires_approval` on) | admin | **Immediate** | "Awaiting approval: <task>" |
| 7 | Reopen conflict (successor already in progress) | admin | **Immediate** | "Untangle: <task> reopened but <next task> already started" |
| 8 | Stage completed | admin | Digest | "<person> finished <stage> on <project>" |
| 9 | Project auto-completed | admin | Digest (in-app immediate) | "<project> is complete 🎉" |
| 10 | Comment on a task you're assigned to / you authored | that user | Digest | "<person> commented on <task>" |
| 11 | Daily digest 08:30 Cairo (skipped when empty) | each user | Email | "Today: N due, M overdue" + sections; admin version adds unassigned + flags + yesterday's completions |
| 12 | Time off requested | everyone with `hr.manage` | **Immediate** | "<person> asks for N days off" + type, span, reason |
| 13 | Time off decided (or logged for you) | requester | **Immediate** | "N days off approved ✓" / "…was rejected" + note + any pay deduction |
| 14 | Payslip paid | that person | **Immediate** | "<month> salary paid — <net>" |

Rules: no notification for one's own actions; dedupe #4 per task/day; email failures log +
retry once, in-app row is the source of truth.

---

## 10. Milestone plan

Ordered, independently testable, sized for Claude Code sessions. Each milestone ends
deployed and demoable. Acceptance criteria (AC) are the definition of done.

**M0 — Scaffold & pipelines** *(foundation of trust)*
pnpm monorepo; Vite SPA skeleton with router + design tokens; Fastify with `/healthz`,
`@fastify/static` serving the SPA build, and a stub `POST /jobs/tick`; Drizzle wired to
local docker Postgres; CI (typecheck, lint, vitest); deploy in **trial mode** (§1.3): one
Render free web service + Neon; external cron registered against `/jobs/tick`; env
Zod-validation.
**AC:** the `onrender.com` URL renders the app shell and `/healthz` returns ok; the
external cron's ticks appear in the logs every ~10 min (wrong token → 401); CI green; a
schema change deploys via migration on Render release; total hosting spend is $0.

**M1 — Schema, auth, users** *(security backbone)*
Full §2 schema + migrations + seed script (skills, stages, templates, categories, Adham
admin). better-auth: login, logout, change-password, forced first-login change; rate limits;
security headers; CORS lockdown. tRPC context with role guards. Settings→Users screen.
**AC:** admin logs in, creates member Hazem with skills, Hazem logs in (forced pw change),
Hazem hits an admin procedure → 403 + no data leakage; login brute-force gets rate-limited;
all seed rows present.

**M2 — Core CRUD & the three main screens (v1)** *(the sheet replacement)*
Clients, projects (template snapshot → materialized chain), tasks (transition, checklist,
drive links), comments. Screens: Board/Projects (table + filters), Project detail (stepper +
tabs minus ledger), Task detail, My Work v1. Activity log written on every mutation.
**AC:** create "Kuja — 18 reels" from the Reels template → 4 chain tasks appear, first is
`todo`; Gandoz sees it on My Work, starts it, adds a checklist, comments; admin edits the
deadline; every action shows in the Activity tab; all screens have loading/empty/error
states; My Work usable on a 375px viewport.

**M3 — Handoff engine** *(the heart)*
§4 in full: completion → activation, three routing rules, unassigned queue data, flag/unflag,
approve/reject path, reopen logic, project auto-complete. Exhaustive vitest suite for §4.3's
edge-case table (each row = at least one test).
**AC:** scripted E2E: videographer+editor member completes Shooting → Editing auto-assigned
to *him*; pre-assigning Editing to Sama first routes it to *her* instead; deactivating the
pre-assignee falls through correctly; completing with no qualifier lands in the queue and
notifies admin (in-app); reopen of an untouched successor reverts it; reopen of a started
successor flags both; double-complete race produces exactly one handoff.

**M4 — Reminders & notifications** *(the nervous system)*
Ticker + daily cron; `end_of_last_day` rule wired to activation/deadline-change/completion;
custom reminders UI; notifications table + bell panel; Resend integration + React Email
templates; daily digest; overdue sweep. Notification catalogue §9 complete.
**AC:** activating a Shooting task with a deadline creates a pending reminder at 18:00 Cairo
on the deadline (verify with a near-future test time: notification + email fire exactly once,
whether delivered by the in-process ticker or an external tick, and survive a free-tier
spin-down/restart); changing the deadline moves it; completing cancels it; digest fires once
per day even across restarts (`job_runs`); digest email renders correct sections and is
skipped when empty; assignment/flag emails arrive.

**M5 — Dashboards** *(visibility)*
Admin Dashboard (tiles + lists + quick-assign + workload bars + recent activity); stage-board
view; My Work polish (flag banners, reminder strip, done-last-7-days).
**AC:** with seeded scenario data, tile counts match SQL truth; quick-assign from the
Unassigned tile assigns + notifies in two clicks; dashboard readable and actionable at 375px.

**M6 — Ledger & finance reports** *(money)*
Expenses/incomes CRUD on Project→Ledger tab; category management; dashboard finance snapshot;
finance report page with date range + CSV export. Member requests to any finance procedure
rejected at the router *and* absent from member DTOs.
**AC:** enter Kuja income 50k, equipment-rental expense 12k → project profit 38k everywhere
it appears; spend-by-category for the month sums correctly; member session cannot retrieve
any finance data (verified by test).

**M7 — MCP server** *(the AI layer)*
`/mcp` Streamable HTTP endpoint, bearer auth, the 7 read-only tools from §7.2 mapped onto
existing services; README section for connecting Claude Desktop/Code.
**AC:** from Claude Code configured against the deployed URL: "what's late?" returns the
real overdue list; "how much did we spend on equipment rental this month?" returns the M6
figure; a wrong token gets 401; no tool can mutate (code-level: MCP module imports no
mutation service).

**M8 — Sheet import** *(adoption gate — the project fails without it)*
§11 wizard: upload CSV → parse/validate → mapping preview with per-row issues → commit.
Idempotent re-runs.
**AC:** the real exported sheet imports: 8 clients, 8 projects, correct templates/stages
chosen in preview, assignees mapped to users, dates parsed (dd/mm/yyyy), blank rows skipped
with reasons shown; running commit twice creates no duplicates; imported rows carry
`activity_log action='imported'`.

**M9 — Hardening & handover** *(keep it running)*
Mobile pass on every screen; empty/error state audit; `pnpm audit`/dependency pass;
`/security-review` of the branch; backup job (weekly pg_dump artifact) verified restorable;
README runbook (deploy, env rotation, backup restore, adding a user/stage/category);
Lighthouse pass on My Work.
**AC:** documented restore drill executed once successfully; runbook followed cold by the
owner-engineer to rotate `MCP_BEARER_TOKEN` and add a stage without reading code.

**Deferred by decision (do not build):** client portal · time tracking · invoicing · file
uploads · multi-tenant anything · MCP write tools · WhatsApp (v1.5, pending Business API
budget) · Google Calendar sync (v1.5) · embedded AI chat.

---

## 11. Sheet import / migration plan

**Source:** CSV export of "Operations tasks tracker" with columns
`Project | Deliverable Title | Campaign | Priority | Assigned to | Start Date | Due Date | Notes | Content copy | Adham Approval | Edits | Account Manager`.

**Column → entity mapping**

| Sheet column | Target |
|---|---|
| Project (e.g. "Clinic", "True Mama") | `clients.name` — get-or-create, case-insensitive trim |
| Deliverable Title ("6 Videos", "18 reels") | `projects.title` (fallback: campaign, else "Imported project") |
| Campaign | `projects.campaign` |
| Priority (High/Medium/blank) | `projects.priority` (blank → medium) |
| Assigned to (Hazem/Gandoz/Sama/Amer) | fuzzy-match to `user.name` → first `todo` task's assignee; unmatched → task left unassigned + row issue |
| Start Date / Due Date (dd/mm/yyyy) | `projects.start_date` / `due_date`; also the deadline of the current task |
| Notes | `projects.notes`; first Drive URL found is extracted to `drive_link` |
| Content copy / Adham Approval / Edits / Account Manager | **workflow position signal** — see below |

**Wizard flow (admin-only, Settings → Import):**
1. **Upload & parse** — client-side CSV parse, server-side Zod re-validation. Empty rows and
   the `dd/mm/yyyy` placeholder rows dropped with a visible reason.
2. **Preview grid** — one row per project: resolved client (new/existing badge), title,
   suggested **template** (heuristic: title contains reel/video → Reels; photo → Photo;
   calendar/design/copy → Design; else Reels) and suggested **current stage** (workflow
   columns: `Edits` non-empty → Editing; `Adham Approval` checked → Delivery; `Content copy`
   file present → post-copy stage; else first stage). Both are dropdowns — the admin corrects
   any guess per row before commit. Per-row issues listed inline (unknown assignee, bad date).
3. **Commit** (single transaction): create clients + projects; materialize the chosen
   template's chain; stages **before** the chosen current stage → `done` (completed_at =
   import time, actor = importing admin, log `action:'imported'`); current stage → `todo`,
   assignee from mapping, deadline = row due date; later stages → `waiting`. No reminders or
   notifications are generated for imported history (only the current `todo` tasks schedule
   their stage auto-reminder if applicable).
4. **Idempotency:** natural key `(client_name, project_title, due_date)` — matches are
   skipped and reported, never duplicated. Re-running a corrected CSV is safe.
5. **Cutover:** import on a Friday, verify the Board against the sheet side by side, mark the
   sheet read-only with a banner note pointing at the portal. The sheet is the rollback for
   two weeks, then archived.

---

## 12. Open follow-ups (tracked, not blocking)

1. Sign off on the **pre-assignment-first** rule order in §4.1 (flagged deviation).
2. Skills per member (Hazem/Gandoz/Sama/Amer) — set in Settings after M1; needed before the
   M8 import makes assignments meaningful.
3. **Upgrade trigger:** when Adham starts paying (after the one-month trial), run the §1.3
   upgrade checklist — Render Starter ($7/mo), domain purchase (~$10/yr), Vercel split.
   Nothing is bought before then.
4. v1.5 candidates when v1 is trusted: Google Calendar sync, WhatsApp alerts (budget check),
   MCP write tools, embedded chat.

---

## 13. Mini HR — time off and pay

Owner request (2026-08-02): "a small part of the system handles the HR… members request
leaves, Adham accepts or rejects with a note… and handles all the salaries", with one screen
for the team and one for him. Two halves that meet in exactly one place: a day off that costs
money becomes a line on that month's payslip.

### 13.1 Rules (decided with the owner)

| Question | Answer |
|---|---|
| Leave types | `annual`, `casual`, `sick`, `unpaid` — a fixed set, not configurable |
| Allowance | 21 annual days a year; casual (7) comes **out of the same 21**; sick (15) is its own pool; unpaid draws on neither. Overridable per person per year |
| Day counting | Plain inclusive calendar days between the two dates. **No** weekend or public-holiday arithmetic — the owner asked for a number he can check in his head |
| What a balance counts | Approved days only. A pending request reserves nothing |
| Year attribution | A leave belongs to the year it **starts** in, whole — never split across two balances |
| Over-balance requests | Allowed, never blocked. The queue shows how many days are past the balance and what they are worth |
| Salary deduction | The owner's lever on any approval (and on any leave he logs himself): an amount that lands on that month's payslip. Defaults to `daily rate × days past the balance`; unpaid leave defaults to the full span |
| Daily rate | `monthly ÷ 30` — the Egyptian payroll convention |
| Pay privacy | A member sees their own salary and their own **paid** payslips. Drafts are the owner's working copy and never leave his screen |
| Overlaps | Two overlapping requests for the same person are refused — they would double-count the same day |

### 13.2 Tables (`packages/db/src/schema/hr.ts`)

| Table | Purpose | Notes |
|---|---|---|
| `leave_requests` | one continuous stretch of days | `days` is **stored**, so a decided request keeps the number it was decided on; `deduct_from_salary` holds the owner's amount until payroll materializes it |
| `leave_allowances` | per user per year | a missing row = the defaults in `@mams/shared`; nobody needs setting up before they can ask for a day |
| `salaries` | pay history, not one mutable figure | a raise is a new `(user, effective_from)` row, so an old payslip is always explainable |
| `payslips` | one month, one person | unique `(user, period)`; drafts are editable, `paid` is frozen and carries the `expense_id` it posted |
| `payroll_adjustments` | everything moving a payslip off its base | positive amounts; `bonus` adds, the rest subtract; unique `(payslip, leave_request)` is what makes preparing payroll twice harmless |

### 13.3 Payroll flow

1. **Prepare** (`hr.preparePayroll`) — a draft payslip per active person with a salary in
   force on the last day of the month, plus a `leave_deduction` line for every approved leave
   starting that month that the owner marked deductible. Idempotent: existing drafts keep
   their edits, paid slips are skipped, no leave is charged twice.
2. **Adjust** — bonus / deduction / advance lines; net recomputes on every change and can
   never go below zero.
3. **Pay** (`hr.markPaid`) — the single point where HR touches the books: the net posts as an
   approved overhead expense under the **Salaries** category, dated the payment day, and the
   payslip keeps that expense's id. This is why setting a salary **pauses** any legacy
   recurring "salary" line for the same person — two systems posting one wage would silently
   double the books.

### 13.4 Screens

| Screen | Who | What |
|---|---|---|
| `/time-off` — "Time off & pay" | everyone | three balance meters, request form (live day count + over-balance warning), own requests with decision notes and any deduction, own salary + paid payslips with their lines |
| `/people` — "People" | `hr.manage` | **Time off** tab: the approval queue (each row carries the person's balance, the days past it and a pre-filled deduction), the team's year with per-person balances, "log leave" and allowance overrides; **Payroll** tab: month switcher, prepare, per-person lines, pay, and the standing salary list |
| Calendar | everyone | approved leave drawn as absence — dashed and colourless, so it reads as "nobody here" instead of competing with deadline colour |
