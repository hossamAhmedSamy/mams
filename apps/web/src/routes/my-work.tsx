import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorBanner, SkeletonRows } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page";
import { MiniCalendar } from "@/components/mini-calendar";
import { TaskRow, type WorkTask } from "@/components/task-row";
import { addDaysISO } from "@/lib/dates";
import { useMe, type Viewer } from "@/lib/session";
import { useTRPC } from "@/lib/trpc";

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

  const { today, tasks } = work.data as { today: string; tasks: WorkTask[] };
  const viewer = me.data as Viewer;
  const open = tasks.filter((t) => t.status !== "done");
  const done = tasks.filter((t) => t.status === "done");
  const weekEnd = addDaysISO(today, 7);

  const sections: { title: string; accent?: string; items: WorkTask[] }[] = [
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
                      <TaskRow key={task.id} task={task} today={today} viewer={viewer} />
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
                  <TaskRow key={task.id} task={task} today={today} viewer={viewer} muted />
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
