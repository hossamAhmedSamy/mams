import { z } from "zod";

// ---------------------------------------------------------------------------
// Closed sets (PLAN.md §2). These are the single source of truth for both the
// DB CHECK constraints and every UI dropdown.
// ---------------------------------------------------------------------------

export const ROLES = ["admin", "member"] as const;
export type Role = (typeof ROLES)[number];

export const PROJECT_STATUSES = ["active", "on_hold", "completed", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PRIORITIES = ["high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const TASK_STATUSES = ["waiting", "todo", "in_progress", "awaiting_approval", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const CLIENT_STATUSES = ["active", "archived"] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const REMINDER_RULES = ["none", "end_of_last_day"] as const;
export type ReminderRule = (typeof REMINDER_RULES)[number];

export const REMINDER_SOURCES = ["auto", "admin"] as const;
export type ReminderSource = (typeof REMINDER_SOURCES)[number];

/** Notification catalogue keys (PLAN.md §9). */
export const NOTIFICATION_TYPES = [
  "task_assigned",
  "task_flagged",
  "reminder_fired",
  "task_overdue",
  "handoff_unassigned",
  "approval_requested",
  "reopen_conflict",
  "stage_completed",
  "project_completed",
  "comment_added",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

// ---------------------------------------------------------------------------
// Task state machine (PLAN.md §5.3) — the only legal transitions.
// `system` transitions are performed by the handoff engine, never by a request.
// ---------------------------------------------------------------------------

export const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  waiting: ["todo"],
  todo: ["in_progress", "waiting"], // todo→waiting is system-only (reopen revert)
  in_progress: ["done", "awaiting_approval"],
  awaiting_approval: ["done", "in_progress"],
  done: ["in_progress"], // admin reopen
};

export function isLegalTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Business constants
// ---------------------------------------------------------------------------

export const BUSINESS_TZ = "Africa/Cairo";
export const CURRENCY = "EGP";

// ---------------------------------------------------------------------------
// Common Zod fragments shared by forms (web) and procedures (api)
// ---------------------------------------------------------------------------

export const zUuid = z.uuid();
/** Calendar date as YYYY-MM-DD (what <input type="date"> produces). */
export const zDateISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
export const zMoney = z
  .number()
  .positive()
  .multipleOf(0.01, "At most 2 decimal places");
export const zHttpsUrl = z.url().startsWith("https://", "Must be an https:// link");

export const zPriority = z.enum(PRIORITIES);
export const zTaskStatus = z.enum(TASK_STATUSES);
export const zProjectStatus = z.enum(PROJECT_STATUSES);

export const zChecklist = z
  .array(z.object({ text: z.string().min(1).max(500), done: z.boolean() }))
  .max(100);
export type Checklist = z.infer<typeof zChecklist>;

export const zPassword = z.string().min(10, "At least 10 characters").max(128);

// ---------------------------------------------------------------------------
// Display helpers kept next to the enums so web and email templates agree
// ---------------------------------------------------------------------------

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  waiting: "Waiting",
  todo: "To do",
  in_progress: "In progress",
  awaiting_approval: "Awaiting approval",
  done: "Done",
};

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  active: "Active",
  on_hold: "On hold",
  completed: "Completed",
  archived: "Archived",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};
