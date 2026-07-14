import type { Priority, TaskStatus } from "@mams/shared";
import { TASK_STATUS_LABELS } from "@mams/shared";
import { Badge } from "@/components/ui/badge";
import { deadlineLabel } from "@/lib/dates";

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

/**
 * The one primary action for this viewer (PLAN.md §8.1): the single legal
 * next transition, or null → no button.
 */
export function nextAction(
  task: { status: TaskStatus; assigneeId: string | null; requiresApproval: boolean },
  viewer: { id: string; role: "admin" | "member" },
): { to: TaskStatus; label: string } | null {
  const isAdmin = viewer.role === "admin";
  const isMine = task.assigneeId === viewer.id;
  switch (task.status) {
    case "waiting":
      return isAdmin ? { to: "todo", label: "Activate now" } : null;
    case "todo":
      return isMine || isAdmin ? { to: "in_progress", label: "Start" } : null;
    case "in_progress":
      if (!isMine && !isAdmin) return null;
      return task.requiresApproval && !isAdmin
        ? { to: "done", label: "Submit for approval" }
        : { to: "done", label: "Mark done" };
    case "awaiting_approval":
      return isAdmin ? { to: "done", label: "Approve" } : null;
    case "done":
      return null; // reopen is a deliberate admin act on the task page, not a card button
  }
}
