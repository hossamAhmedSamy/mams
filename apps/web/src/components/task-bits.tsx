import type { Permission, Priority, TaskStatus } from "@mams/shared";
import { can, TASK_STATUS_LABELS } from "@mams/shared";
import { Badge, type Tone } from "@/components/ui/badge";
import { deadlineLabel, spanLabel, timeTone } from "@/lib/dates";
import { cn } from "@/lib/utils";

/**
 * Status is ink unless the task is actually running or actually finished.
 * "Not started" and "To do" are facts, not pressure, so they stay grey — which
 * is what leaves the coloured marks on a list meaning something.
 */
const statusTone: Record<TaskStatus, Tone> = {
  waiting: "neutral",
  todo: "ink",
  in_progress: "now",
  awaiting_approval: "now",
  done: "done",
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  return <Badge tone={statusTone[status]}>{TASK_STATUS_LABELS[status]}</Badge>;
}

/**
 * The deadline compressed to a figure you can read down a column: −2d, TODAY,
 * +3d, 12 AUG. Mono keeps the rows aligned and stops the minus sign shifting
 * the text beside it.
 */
export function DeadlineChip({
  deadline,
  today,
  muted,
}: {
  deadline: string | null;
  today?: string;
  muted?: boolean;
}) {
  if (!deadline) return <span className="font-mono text-small text-ink-300">——</span>;
  const { text, tone } = deadlineLabel(deadline, today);
  const live = muted ? "neutral" : tone;
  return (
    <span
      className={cn(
        "shrink-0 rounded-[5px] px-1.5 py-1 font-mono text-small font-medium tabular-nums",
        live === "late"
          ? "bg-late-tint text-late-ink"
          : live === "now"
            ? "bg-now-tint text-now-ink"
            : "text-ink-400",
      )}
    >
      {text}
    </span>
  );
}

/** "Started 3 Aug · due 7 Aug" — both ends of the task's window, in one line. */
export function ScheduleLine({
  startDate,
  deadline,
  today,
  className,
}: {
  startDate: string | null;
  deadline: string | null;
  today?: string;
  className?: string;
}) {
  const text = spanLabel(startDate, deadline, today);
  if (!text) return null;
  return <span className={cn("text-small text-ink-400", className)}>{text}</span>;
}

/** Low priority is the default — announcing it is noise, so it renders nothing. */
export function PriorityDot({ priority }: { priority: Priority }) {
  if (priority === "low") return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-small text-ink-500">
      <span className={cn("size-1.5 rounded-full", priority === "high" ? "bg-late" : "bg-ink-300")} />
      {priority === "high" ? "High priority" : "Medium"}
    </span>
  );
}

export type Viewer = { id: string; role: "admin" | "member"; permissions: Permission[] };

/** One import for screens that need "how urgent is this row". */
export { timeTone };

/**
 * The one primary action for this viewer (PLAN.md §8.1): the single legal next
 * transition, or null → no button. Assignees are equals, so anyone on the task
 * can move it; the rest is per-user permission.
 */
export function nextAction(
  task: { status: TaskStatus; assigneeIds: string[]; requiresApproval: boolean },
  viewer: Viewer,
): { to: TaskStatus; label: string } | null {
  const onTask = task.assigneeIds.includes(viewer.id);
  const canManage = can(viewer, "tasks.manage");
  const canApprove = can(viewer, "tasks.approve");
  switch (task.status) {
    case "waiting":
      return canManage ? { to: "todo", label: "Activate now" } : null;
    case "todo":
      return onTask || canManage ? { to: "in_progress", label: "Start" } : null;
    case "in_progress":
      if (!onTask && !canManage) return null;
      return task.requiresApproval && !canApprove
        ? { to: "done", label: "Submit for approval" }
        : { to: "done", label: "Mark done" };
    case "awaiting_approval":
      return canApprove ? { to: "done", label: "Approve" } : null;
    case "done":
      return null; // reopen is a deliberate act on the task page, not a card button
  }
}
