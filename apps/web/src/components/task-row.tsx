import { taskLabel, type TaskStatus } from "@mams/shared";
import { Flag, Link2, ListChecks } from "lucide-react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { AvatarStack } from "@/components/ui/page";
import { TaskActionButton } from "@/components/task-action";
import { DeadlineChip, ScheduleLine, StatusBadge, type Viewer } from "@/components/task-bits";
import { cn } from "@/lib/utils";

/** The task shape every list screen renders. Tasks are named by their stage. */
export type WorkTask = {
  id: string;
  status: TaskStatus;
  chainPosition: number | null;
  startDate: string | null;
  deadline: string | null;
  flagged: boolean;
  flagNote: string | null;
  requiresApproval: boolean;
  projectTitle: string;
  clientName: string;
  stageName: string | null;
  assignees: { id: string; name: string }[];
  assigneeIds: string[];
  checklist: { text: string; done: boolean }[] | null;
  driveLink: string | null;
};

/**
 * One task, everywhere: the stage names it, the project gives it context, and
 * the single legal next action sits on the right (PLAN.md §8.1).
 */
export function TaskRow({
  task,
  today,
  viewer,
  muted,
  showStatus = true,
}: {
  task: WorkTask;
  today?: string;
  viewer: Viewer;
  muted?: boolean;
  showStatus?: boolean;
}) {
  const checklistDone = task.checklist?.filter((c) => c.done).length ?? 0;
  const overdue = !muted && task.deadline !== null && today !== undefined && task.deadline < today;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-white px-3 py-3 shadow-card transition-colors sm:px-4",
        muted
          ? "border-hairline opacity-60"
          : task.flagged
            ? "border-orange-200"
            : overdue
              ? "border-red-200"
              : "border-hairline hover:border-gray-300",
      )}
    >
      <Link to={`/tasks/${task.id}`} className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold text-gray-900">{taskLabel(task.stageName)}</span>
          {showStatus && <StatusBadge status={task.status} />}
          {task.flagged && (
            <Badge tone="orange">
              <Flag size={11} className="mr-1" /> Flagged
            </Badge>
          )}
        </div>
        <p className="mt-0.5 truncate text-sm text-gray-500">
          {task.projectTitle} · {task.clientName}
        </p>
        {task.flagged && task.flagNote && (
          <p className="mt-1.5 rounded-lg bg-orange-50 px-2 py-1 text-xs text-orange-700">
            {task.flagNote}
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <ScheduleLine startDate={task.startDate} deadline={task.deadline} today={today} />
          {task.checklist && task.checklist.length > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-gray-400">
              <ListChecks size={12} /> {checklistDone}/{task.checklist.length}
            </span>
          )}
          {task.driveLink && (
            <span className="inline-flex items-center gap-1 text-xs text-gray-400">
              <Link2 size={12} /> Drive
            </span>
          )}
        </div>
      </Link>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        {task.assignees.length > 0 && <AvatarStack names={task.assignees.map((a) => a.name)} />}
        <DeadlineChip deadline={task.deadline} today={today} muted={muted} />
        {!muted && <TaskActionButton task={task} viewer={viewer} />}
      </div>
    </div>
  );
}
