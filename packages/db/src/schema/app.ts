import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

// Domain tables per PLAN.md §2.1. Closed sets are CHECK constraints whose
// source of truth is @mams/shared — keep them in sync when adding values.

export const skills = pgTable("skills", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  active: boolean("active").notNull().default(true),
});

export const userSkills = pgTable(
  "user_skills",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.skillId] })],
);

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    notes: text("notes"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("clients_status_check", sql`${t.status} IN ('active','archived')`)],
);

export const stages = pgTable(
  "stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    defaultDurationDays: integer("default_duration_days").notNull().default(3),
    reminderRule: text("reminder_rule").notNull().default("none"),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    check("stages_reminder_rule_check", sql`${t.reminderRule} IN ('none','end_of_last_day')`),
  ],
);

export const stageSkills = pgTable(
  "stage_skills",
  {
    stageId: uuid("stage_id")
      .notNull()
      .references(() => stages.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id),
  },
  (t) => [primaryKey({ columns: [t.stageId, t.skillId] })],
);

export const workflowTemplates = pgTable("workflow_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  active: boolean("active").notNull().default(true),
});

export const templateStages = pgTable(
  "template_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => workflowTemplates.id, { onDelete: "cascade" }),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => stages.id),
    position: integer("position").notNull(),
    requiresApproval: boolean("requires_approval").notNull().default(false),
  },
  (t) => [uniqueIndex("template_stages_template_position_uq").on(t.templateId, t.position)],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    title: text("title").notNull(),
    campaign: text("campaign"),
    priority: text("priority").notNull().default("medium"),
    status: text("status").notNull().default("active"),
    workflowTemplateId: uuid("workflow_template_id").references(() => workflowTemplates.id),
    budget: numeric("budget", { precision: 12, scale: 2 }),
    startDate: date("start_date"),
    dueDate: date("due_date"),
    driveLink: text("drive_link"),
    notes: text("notes"),
    createdBy: text("created_by").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("projects_client_id_idx").on(t.clientId),
    index("projects_status_idx").on(t.status),
    check("projects_priority_check", sql`${t.priority} IN ('high','medium','low')`),
    check(
      "projects_status_check",
      sql`${t.status} IN ('active','on_hold','completed','archived')`,
    ),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    stageId: uuid("stage_id").references(() => stages.id),
    chainPosition: integer("chain_position"),
    title: text("title").notNull(),
    details: text("details"),
    assigneeId: text("assignee_id").references(() => user.id),
    status: text("status").notNull().default("waiting"),
    requiresApproval: boolean("requires_approval").notNull().default(false),
    flagged: boolean("flagged").notNull().default(false),
    flagNote: text("flag_note"),
    startDate: date("start_date"),
    deadline: date("deadline"),
    driveLink: text("drive_link"),
    checklist: jsonb("checklist").$type<{ text: string; done: boolean }[]>(),
    createdBy: text("created_by").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("tasks_project_chain_position_uq")
      .on(t.projectId, t.chainPosition)
      .where(sql`${t.chainPosition} IS NOT NULL`),
    index("tasks_assignee_status_idx").on(t.assigneeId, t.status),
    index("tasks_deadline_idx").on(t.deadline),
    index("tasks_project_id_idx").on(t.projectId),
    index("tasks_open_status_idx").on(t.status).where(sql`${t.status} <> 'done'`),
    check(
      "tasks_status_check",
      sql`${t.status} IN ('waiting','todo','in_progress','awaiting_approval','done')`,
    ),
  ],
);

/**
 * Everyone working the task (owner + helpers). tasks.assignee_id stays the ONE
 * accountable owner and is always mirrored here; extra rows are helpers who
 * see the task in My Work and may act on it.
 */
export const taskAssignees = pgTable(
  "task_assignees",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.userId] }), index("task_assignees_user_idx").on(t.userId)],
);

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("comments_task_id_idx").on(t.taskId)],
);

export const reminders = pgTable(
  "reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    targetUserId: text("target_user_id")
      .notNull()
      .references(() => user.id),
    fireAt: timestamp("fire_at", { withTimezone: true }).notNull(),
    message: text("message").notNull(),
    source: text("source").notNull(),
    dedupeKey: text("dedupe_key").unique(),
    firedAt: timestamp("fired_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("reminders_pending_fire_at_idx")
      .on(t.fireAt)
      .where(sql`${t.firedAt} IS NULL AND ${t.canceledAt} IS NULL`),
    check("reminders_source_check", sql`${t.source} IN ('auto','admin')`),
    check("reminders_target_check", sql`num_nonnulls(${t.taskId}, ${t.projectId}) = 1`),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_user_read_idx").on(t.userId, t.readAt)],
);

export const activityLog = pgTable(
  "activity_log",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    actorId: text("actor_id").references(() => user.id),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    action: text("action").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("activity_log_entity_idx").on(t.entityType, t.entityId, t.createdAt),
    index("activity_log_created_at_idx").on(t.createdAt),
  ],
);

export const jobRuns = pgTable(
  "job_runs",
  {
    jobName: text("job_name").notNull(),
    runOn: date("run_on").notNull(),
    ranAt: timestamp("ran_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.jobName, t.runOn] })],
);

export const expenseCategories = pgTable("expense_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  active: boolean("active").notNull().default(true),
});

/**
 * Recurring money: salaries, rent, subscriptions. The daily job materializes
 * one approved overhead expense per period; last_posted_period ('YYYY-MM')
 * makes posting idempotent across restarts and free-tier spin-downs.
 */
export const recurringExpenses = pgTable("recurring_expenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  categoryId: uuid("category_id")
    .notNull()
    .references(() => expenseCategories.id),
  dayOfMonth: integer("day_of_month").notNull().default(1),
  userId: text("user_id").references(() => user.id), // set for salaries
  active: boolean("active").notNull().default(true),
  lastPostedPeriod: text("last_posted_period"),
  createdBy: text("created_by").references(() => user.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").references(() => projects.id), // null = agency overhead
    categoryId: uuid("category_id")
      .notNull()
      .references(() => expenseCategories.id),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    spentOn: date("spent_on").notNull(),
    note: text("note"),
    vendor: text("vendor"),
    receiptLink: text("receipt_link"),
    // approval flow: members request (pending), admin decides; admin-created
    // and recurring-posted rows are born approved
    status: text("status").notNull().default("approved"),
    decidedBy: text("decided_by").references(() => user.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    recurringId: uuid("recurring_id").references(() => recurringExpenses.id),
    createdBy: text("created_by").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("expenses_project_id_idx").on(t.projectId),
    index("expenses_category_date_idx").on(t.categoryId, t.spentOn),
    index("expenses_status_idx").on(t.status),
    index("expenses_created_by_idx").on(t.createdBy),
    check("expenses_amount_check", sql`${t.amount} > 0`),
    check("expenses_status_check", sql`${t.status} IN ('pending','approved','rejected')`),
  ],
);

export const incomes = pgTable(
  "incomes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    receivedOn: date("received_on").notNull(),
    note: text("note"),
    createdBy: text("created_by").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("incomes_project_id_idx").on(t.projectId),
    check("incomes_amount_check", sql`${t.amount} > 0`),
  ],
);
