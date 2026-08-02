import { taskLabel, type TaskStatus } from "@mams/shared";
import { Flag, Link2, ListChecks } from "lucide-react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { AvatarStack } from "@/components/ui/page";
import { TaskActionButton } from "@/components/task-action";
import {
  DeadlineChip,
  nextAction,
  ScheduleLine,
  StatusBadge,
  timeTone,
  type Viewer,
} from "@/components/task-bits";
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
 * One task, everywhere.
 *
 * The stage names it, the project places it, and the left edge says how much
 * trouble it is in — which is the only thing on the card allowed to be
 * coloured. The single legal next action closes the row on the right, so the
 * eye lands on the thing to press last (PLAN.md §8.1).
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
  const tone = muted
    ? "neutral"
    : timeTone(task.deadline, today, { flagged: task.flagged, done: task.status === "done" });
  const action = muted ? null : nextAction(task, viewer);

  return (
    <Card
      edge={tone === "neutral" ? "none" : tone}
      interactive={!muted}
      className={cn("px-3.5 py-3 sm:px-4", muted && "opacity-55")}
    >
      <div className="flex items-start gap-3">
        <Link to={`/tasks/${task.id}`} className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="display text-lead leading-snug text-ink-900">
              {taskLabel(task.stageName)}
            </h3>
            {task.flagged && (
              <Badge tone="late" filled>
                <Flag size={9} strokeWidth={3} /> Flagged
              </Badge>
            )}
            {showStatus && !task.flagged && <StatusBadge status={task.status} />}
          </div>
          <p className="mt-0.5 truncate text-small text-ink-400">
            {task.projectTitle} <span className="text-ink-200">·</span> {task.clientName}
          </p>
        </Link>

        <div className="flex shrink-0 items-center gap-2.5">
          {task.assignees.length > 0 && <AvatarStack names={task.assignees.map((a) => a.name)} />}
          <DeadlineChip deadline={task.deadline} today={today} muted={muted} />
        </div>
      </div>

      {task.flagged && task.flagNote && (
        <p className="mt-2.5 rounded-[8px] border-l-2 border-late bg-late-tint px-2.5 py-1.5 text-small text-late-ink">
          {task.flagNote}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <ScheduleLine startDate={task.startDate} deadline={task.deadline} today={today} />
          {task.checklist && task.checklist.length > 0 && (
            <span className="inline-flex items-center gap-1 text-small text-ink-400">
              <ListChecks size={12} />
              <span className="font-mono tabular-nums">
                {checklistDone}/{task.checklist.length}
              </span>
            </span>
          )}
          {task.driveLink && (
            <span className="inline-flex items-center gap-1 text-small text-ink-400">
              <Link2 size={12} /> Drive
            </span>
          )}
        </div>
        {action && <TaskActionButton task={task} viewer={viewer} />}
      </div>
    </Card>
  );
}
