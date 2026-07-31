import type { Permission, Priority, TaskStatus } from "@mams/shared";
import { can, TASK_STATUS_LABELS } from "@mams/shared";
import { Badge } from "@/components/ui/badge";
import { deadlineLabel, spanLabel } from "@/lib/dates";

const statusTone: Record<TaskStatus, "gray" | "accent" | "blue" | "amber" | "green"> = {
  waiting: "gray",
  todo: "accent",
  in_progress: "blue",
  awaiting_approval: "amber",
  done: "green",
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  return <Badge tone={statusTone[status]}>{TASK_STATUS_LABELS[status]}</Badge>;
}

export function DeadlineChip({
  deadline,
  today,
  muted,
}: {
  deadline: string | null;
  today?: string;
  muted?: boolean;
}) {
  if (!deadline) return <span className="text-xs text-gray-400">No deadline</span>;
  const { text, tone } = deadlineLabel(deadline, today);
  return <Badge tone={muted ? "gray" : tone}>{text}</Badge>;
}

/** "Starts 3 Aug · due 7 Aug" — both ends of the task's window, in one line. */
export function ScheduleLine({
  startDate,
  deadline,
  today,
}: {
  startDate: string | null;
  deadline: string | null;
  today?: string;
}) {
  const text = spanLabel(startDate, deadline, today);
  if (!text) return null;
  return <span className="text-xs text-gray-400">{text}</span>;
}

export function PriorityDot({ priority }: { priority: Priority }) {
  const color =
    priority === "high" ? "bg-status-overdue" : priority === "medium" ? "bg-status-due-soon" : "bg-gray-300";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
      <span className={`size-2 rounded-full ${color}`} />
      {priority === "high" ? "High" : priority === "medium" ? "Medium" : "Low"}
    </span>
  );
}

export type Viewer = { id: string; role: "admin" | "member"; permissions: Permission[] };

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
