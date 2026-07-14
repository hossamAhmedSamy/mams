import { useQuery } from "@tanstack/react-query";
import { Flag, Link2 } from "lucide-react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorBanner, SkeletonRows } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page";
import { MiniCalendar } from "@/components/mini-calendar";
import { TaskActionButton } from "@/components/task-action";
import { DeadlineChip, StatusBadge } from "@/components/task-bits";
import { addDaysISO } from "@/lib/dates";
import { useTRPC } from "@/lib/trpc";
import { useMe } from "./app-layout";

type MyTask = {
  id: string;
  title: string;
  status: "waiting" | "todo" | "in_progress" | "awaiting_approval" | "done";
  chainPosition: number | null;
  deadline: string | null;
  flagged: boolean;
  flagNote: string | null;
  requiresApproval: boolean;
  assigneeId: string | null;
  projectTitle: string;
  clientName: string;
  stageName: string | null;
  checklist: { text: string; done: boolean }[] | null;
  driveLink: string | null;
};

export function MyWorkPage() {
  const trpc = useTRPC();
  const me = useMe();
  const work = useQuery(trpc.tasks.myWork.queryOptions());

  if (work.isPending)
    return (
      <div>
        <PageHeader title="My Work" subtitle="Everything assigned to you, next action first" />
        <Card>
          <SkeletonRows rows={5} />
        </Card>
      </div>
    );
  if (work.isError)
    return <ErrorBanner message="Couldn't load your work." onRetry={() => work.refetch()} />;

  const { today, tasks } = work.data as { today: string; tasks: MyTask[] };
  const open = tasks.filter((t) => t.status !== "done");
  const done = tasks.filter((t) => t.status === "done");
  const weekEnd = addDaysISO(today, 7);

  const sections: { title: string; accent?: string; items: MyTask[] }[] = [
    {
      title: "Needs attention",
      accent: "text-status-flagged",
      items: open.filter((t) => t.flagged),
    },
    {
      title: "Overdue",
      accent: "text-status-overdue",
      items: open.filter((t) => !t.flagged && t.deadline !== null && t.deadline < today),
    },
    {
      title: "Today",
      items: open.filter((t) => !t.flagged && t.deadline === today),
    },
    {
      title: "This week",
      items: open.filter(
        (t) => !t.flagged && t.deadline !== null && t.deadline > today && t.deadline <= weekEnd,
      ),
    },
    {
      title: "Later",
      items: open.filter((t) => !t.flagged && (t.deadline === null || t.deadline > weekEnd)),
    },
  ];

  return (
    <div>
      <PageHeader title="My Work" subtitle="Your calendar and everything assigned to you" />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* calendar is part of the landing (owner request 2026-07-15) —
            first on mobile, right rail on desktop */}
        <div className="order-first lg:order-last lg:col-span-1">
          <MiniCalendar />
        </div>

        <div className="space-y-6 lg:col-span-2">
          {open.length === 0 && (
            <Card>
              <EmptyState title="Nothing assigned. 🎉" hint="New tasks will land here automatically." />
            </Card>
          )}

          {sections.map(
            (section) =>
              section.items.length > 0 && (
                <section key={section.title}>
                  <h2 className={`mb-2 text-sm font-semibold ${section.accent ?? "text-gray-700"}`}>
                    {section.title} · {section.items.length}
                  </h2>
                  <div className="space-y-2">
                    {section.items.map((task) => (
                      <TaskCard key={task.id} task={task} today={today} viewer={me.data!} />
                    ))}
                  </div>
                </section>
              ),
          )}

          {done.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm font-medium text-gray-500">
                Done in the last 7 days · {done.length}
              </summary>
              <div className="mt-2 space-y-2">
                {done.map((task) => (
                  <TaskCard key={task.id} task={task} today={today} viewer={me.data!} muted />
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

function TaskCard({
  task,
  today,
  viewer,
  muted,
}: {
  task: MyTask;
  today: string;
  viewer: { id: string; role: "admin" | "member" };
  muted?: boolean;
}) {
  const checklistDone = task.checklist?.filter((c) => c.done).length ?? 0;

  return (
    <Card className={muted ? "opacity-60" : task.flagged ? "border-orange-300" : ""}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link to={`/tasks/${task.id}`} className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-gray-900">{task.title}</span>
            {task.stageName && <Badge>{task.stageName}</Badge>}
            <StatusBadge status={task.status} />
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
            <p className="mt-1 rounded bg-orange-50 px-2 py-1 text-xs text-orange-700">
              {task.flagNote}
            </p>
          )}
          <div className="mt-1 flex items-center gap-3 text-xs text-gray-400">
            {task.checklist && task.checklist.length > 0 && (
              <span>
                ☑ {checklistDone}/{task.checklist.length}
              </span>
            )}
            {task.driveLink && (
              <span className="inline-flex items-center gap-1">
                <Link2 size={12} /> Drive
              </span>
            )}
          </div>
        </Link>
        <div className="flex shrink-0 items-center gap-3">
          <DeadlineChip deadline={task.deadline} today={today} muted={muted} />
          {!muted && <TaskActionButton task={task} viewer={viewer} />}
        </div>
      </div>
    </Card>
  );
}
