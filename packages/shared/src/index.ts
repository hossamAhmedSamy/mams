import { z } from "zod";

// ---------------------------------------------------------------------------
// Closed sets (PLAN.md §2). These are the single source of truth for both the
// DB CHECK constraints and every UI dropdown.
// ---------------------------------------------------------------------------

export const ROLES = ["admin", "member"] as const;
export type Role = (typeof ROLES)[number];

// ---------------------------------------------------------------------------
// Per-user authorization (owner request: "authorization should be customized
// per user"). Role stays the coarse switch — an admin implicitly holds every
// permission — while each member is granted exactly the capabilities they need.
// ---------------------------------------------------------------------------

export const PERMISSIONS = [
  "projects.manage",
  "tasks.manage",
  "tasks.assign",
  "tasks.approve",
  "team.viewAll",
  "money.view",
  "money.manage",
  "hr.manage",
  "settings.workflows",
  "settings.team",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_GROUPS: {
  title: string;
  items: { key: Permission; label: string; hint: string }[];
}[] = [
  {
    title: "Work",
    items: [
      {
        key: "projects.manage",
        label: "Manage projects",
        hint: "Create and edit projects and clients",
      },
      {
        key: "tasks.manage",
        label: "Manage tasks",
        hint: "Add tasks, change dates, flag and delete",
      },
      { key: "tasks.assign", label: "Assign people", hint: "Change who works on a task" },
      {
        key: "tasks.approve",
        label: "Approve work",
        hint: "Approve submitted work and reopen finished tasks",
      },
      {
        key: "team.viewAll",
        label: "See everyone's work",
        hint: "The whole team's calendar, not just their own",
      },
    ],
  },
  {
    title: "Money",
    items: [
      { key: "money.view", label: "See the money", hint: "Budgets, ledgers and the money screen" },
      {
        key: "money.manage",
        label: "Manage the money",
        hint: "Record income and expenses, decide requests",
      },
    ],
  },
  {
    title: "People",
    items: [
      {
        key: "hr.manage",
        label: "Handle time off & pay",
        hint: "Decide leave requests, set salaries, run payroll",
      },
    ],
  },
  {
    title: "Settings",
    items: [
      { key: "settings.workflows", label: "Edit workflows", hint: "Stages, skills and flows" },
      { key: "settings.team", label: "Manage the team", hint: "Add members, reset passwords, set permissions" },
    ],
  },
];

export const PERMISSION_LABELS: Record<Permission, string> = Object.fromEntries(
  PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => [i.key, i.label])),
) as Record<Permission, string>;

/** Admins hold everything; members hold exactly what was granted to them. */
export function can(
  viewer: { role: Role; permissions?: readonly Permission[] } | null | undefined,
  permission: Permission,
): boolean {
  if (!viewer) return false;
  if (viewer.role === "admin") return true;
  return viewer.permissions?.includes(permission) ?? false;
}

export function canAny(
  viewer: { role: Role; permissions?: readonly Permission[] } | null | undefined,
  permissions: readonly Permission[],
): boolean {
  return permissions.some((p) => can(viewer, p));
}

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
  "expense_requested",
  "expense_decided",
  "leave_requested",
  "leave_decided",
  "payslip_paid",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const EXPENSE_STATUSES = ["pending", "approved", "rejected"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

// ---------------------------------------------------------------------------
// HR — time off and pay (owner request, 2026-08-02)
//
// Egyptian practice, kept deliberately small: one yearly allowance of paid
// days, casual leave carved out of that same allowance, sick leave on its own
// pool, and unpaid days that cost salary instead of balance. Days are plain
// calendar days between the two dates — the owner asked for "simple", so no
// weekend or public-holiday arithmetic hides inside a number he has to trust.
// ---------------------------------------------------------------------------

export const LEAVE_TYPES = ["annual", "casual", "sick", "unpaid"] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export const LEAVE_STATUSES = ["pending", "approved", "rejected", "canceled"] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

/** Yearly days per pool. Overridable per person per year in the People screen. */
export const DEFAULT_ALLOWANCE = { annual: 21, casual: 7, sick: 15 } as const;

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  annual: "Annual leave",
  casual: "Casual leave",
  sick: "Sick leave",
  unpaid: "Unpaid leave",
};

export const LEAVE_TYPE_HINTS: Record<LeaveType, string> = {
  annual: "Planned days off — comes out of your 21 days",
  casual: "Something came up at short notice — also comes out of the 21",
  sick: "Illness — its own pool, never touches your annual days",
  unpaid: "No balance left or none needed — the days come off that month's pay",
};

/** Which pool a type draws from. Casual is carved out of the annual 21. */
export const LEAVE_POOL: Record<LeaveType, "annual" | "sick" | "none"> = {
  annual: "annual",
  casual: "annual",
  sick: "sick",
  unpaid: "none",
};

export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  pending: "Waiting on Adham",
  approved: "Approved",
  rejected: "Rejected",
  canceled: "Canceled",
};

/** Inclusive calendar days between two YYYY-MM-DD dates. 1 day = same day. */
export function leaveDays(startDate: string, endDate: string): number {
  return Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000) + 1;
}

export type LeaveBalance = {
  annual: { allowed: number; used: number; left: number };
  casual: { allowed: number; used: number; left: number };
  sick: { allowed: number; used: number; left: number };
  unpaid: { used: number };
};

/**
 * The one place a balance is computed, so the member's screen, the approval
 * queue and the payroll deduction can never disagree about what is left.
 * `used` counts approved days only — a pending request reserves nothing.
 */
export function leaveBalance(
  allowance: { annual: number; casual: number; sick: number },
  usedByType: Partial<Record<LeaveType, number>>,
): LeaveBalance {
  const annualUsed = (usedByType.annual ?? 0) + (usedByType.casual ?? 0);
  const casualUsed = usedByType.casual ?? 0;
  const sickUsed = usedByType.sick ?? 0;
  return {
    annual: { allowed: allowance.annual, used: annualUsed, left: allowance.annual - annualUsed },
    // casual is capped twice: by its own yearly cap and by what annual has left
    casual: {
      allowed: allowance.casual,
      used: casualUsed,
      left: Math.min(allowance.casual - casualUsed, allowance.annual - annualUsed),
    },
    sick: { allowed: allowance.sick, used: sickUsed, left: allowance.sick - sickUsed },
    unpaid: { used: usedByType.unpaid ?? 0 },
  };
}

/** Days of this request that no balance covers — they cost pay, not balance. */
export function daysBeyondBalance(type: LeaveType, days: number, balance: LeaveBalance): number {
  if (type === "unpaid") return days;
  const left = type === "sick" ? balance.sick.left : type === "casual" ? balance.casual.left : balance.annual.left;
  return Math.max(0, days - Math.max(0, left));
}

// ---------------------------------------------------------------------------
// Payroll
// ---------------------------------------------------------------------------

export const PAYSLIP_STATUSES = ["draft", "paid"] as const;
export type PayslipStatus = (typeof PAYSLIP_STATUSES)[number];

/** Bonus adds to the payslip; everything else is taken off it. */
export const ADJUSTMENT_KINDS = ["bonus", "deduction", "advance", "leave_deduction"] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

export const ADJUSTMENT_LABELS: Record<AdjustmentKind, string> = {
  bonus: "Bonus",
  deduction: "Deduction",
  advance: "Advance taken",
  leave_deduction: "Unpaid days",
};

export function adjustmentSign(kind: AdjustmentKind): 1 | -1 {
  return kind === "bonus" ? 1 : -1;
}

/** Net pay from a base and its adjustments. Never below zero. */
export function payslipNet(
  base: number | string,
  adjustments: { kind: AdjustmentKind; amount: number | string }[],
): number {
  const net = adjustments.reduce(
    (total, a) => total + adjustmentSign(a.kind) * Number(a.amount),
    Number(base),
  );
  return Math.max(0, Math.round(net * 100) / 100);
}

/**
 * What a day off costs when it comes out of pay. A month is treated as 30 days
 * — the convention Egyptian payroll uses, and the one a person can check in
 * their head.
 */
export const PAYROLL_DAYS_IN_MONTH = 30;

export function dailyRate(monthlyAmount: number | string): number {
  return Math.round((Number(monthlyAmount) / PAYROLL_DAYS_IN_MONTH) * 100) / 100;
}

/** "August 2026" from a YYYY-MM period. */
export function periodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

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

/**
 * Tasks carry no title of their own (owner request: "remove the title") — the
 * stage they belong to names them, and the project supplies the context.
 */
export function taskLabel(stageName: string | null | undefined): string {
  return stageName ?? "Task";
}

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  waiting: "Not started",
  todo: "Ready to start",
  in_progress: "In progress",
  awaiting_approval: "Needs approval",
  done: "Done",
};

export function formatMoney(amount: number | string): string {
  const n = typeof amount === "string" ? Number(amount) : amount;
  return `${CURRENCY} ${n.toLocaleString("en-EG", { maximumFractionDigits: 2 })}`;
}

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
