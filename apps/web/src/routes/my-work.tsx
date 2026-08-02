import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorBanner, SkeletonRows } from "@/components/ui/feedback";
import { PageHeader, SectionLabel } from "@/components/ui/page";
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
        <PageHeader
          eyebrow="Assigned to you"
          title="My Work"
          subtitle="Everything on your plate, most urgent first"
        />
        <Card>
          <SkeletonRows rows={5} />
        </Card>
      </div>
    );
  if (work.isError)
    return <ErrorBanner message="Your work didn't load." onRetry={() => work.refetch()} />;

  const { today, tasks } = work.data as { today: string; tasks: WorkTask[] };
  const viewer = me.data as Viewer;
  const open = tasks.filter((t) => t.status !== "done");
  const done = tasks.filter((t) => t.status === "done");
  const weekEnd = addDaysISO(today, 7);

  const sections: {
    title: string;
    tone: "late" | "now" | "neutral";
    items: WorkTask[];
  }[] = [
    {
      title: "Needs attention",
      tone: "late",
      items: open.filter((t) => t.flagged),
    },
    {
      title: "Overdue",
      tone: "late",
      items: open.filter((t) => !t.flagged && t.deadline !== null && t.deadline < today),
    },
    {
      title: "Today",
      tone: "now",
      items: open.filter((t) => !t.flagged && t.deadline === today),
    },
    {
      title: "This week",
      tone: "neutral",
      items: open.filter(
        (t) => !t.flagged && t.deadline !== null && t.deadline > today && t.deadline <= weekEnd,
      ),
    },
    {
      title: "Later",
      tone: "neutral",
      items: open.filter((t) => !t.flagged && (t.deadline === null || t.deadline > weekEnd)),
    },
  ];

  return (
    <div className="settle">
      <PageHeader
        eyebrow="Assigned to you"
        title="My Work"
        subtitle="Everything on your plate, most urgent first"
      />

      <div className="grid gap-6 lg:grid-cols-3 lg:gap-8">
        {/* calendar is part of the landing (owner request 2026-07-15) —
            first on mobile, right rail on desktop */}
        <div className="order-first lg:order-last lg:col-span-1">
          <MiniCalendar />
        </div>

        <div className="space-y-8 lg:col-span-2">
          {open.length === 0 && (
            <Card>
              <EmptyState
                title="Your plate is clear"
                hint="Work lands here the moment a stage is handed to you — nobody has to send it."
              />
            </Card>
          )}

          {sections.map(
            (section) =>
              section.items.length > 0 && (
                <section key={section.title}>
                  <SectionLabel tone={section.tone} count={section.items.length} className="mb-3">
                    {section.title}
                  </SectionLabel>
                  <div className="space-y-2">
                    {section.items.map((task) => (
                      <TaskRow key={task.id} task={task} today={today} viewer={viewer} />
                    ))}
                  </div>
                </section>
              ),
          )}

          {done.length > 0 && (
            <details className="group">
              <summary className="inline-flex cursor-pointer list-none items-center gap-2 text-small font-medium text-ink-400 transition-colors hover:text-ink-700">
                <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
                Finished in the last 7 days
                <span className="font-mono">{done.length}</span>
              </summary>
              <div className="mt-3 space-y-2">
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
