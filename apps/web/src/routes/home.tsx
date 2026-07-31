import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState, ErrorBanner, SkeletonRows } from "@/components/ui/feedback";
import { TaskRow, type WorkTask } from "@/components/task-row";
import { addDaysISO, formatShort } from "@/lib/dates";
import { firstName, useMe, type Viewer } from "@/lib/session";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useNav } from "./app-layout";

const DOW = ["M", "T", "W", "T", "F", "S", "S"];
const STRIP_DAYS = 14;

/**
 * The landing screen for everyone (owner design, 2026-07-31): where things
 * live, what the next two weeks look like, and the handful of things that
 * actually need this person today.
 */
export function HomePage() {
  const trpc = useTRPC();
  const me = useMe();
  const nav = useNav();
  const work = useQuery(trpc.tasks.myWork.queryOptions());

  const viewer = me.data as Viewer | undefined;
  const destinations = nav.filter((item) => item.to !== "/home").slice(0, 4);

  return (
    <div className="space-y-7">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
          {viewer ? `Welcome back, ${firstName(viewer.name)}` : "Welcome back"}
        </h1>
        <p className="mt-1 text-sm text-gray-500 sm:text-[15px]">
          Here's where everything lives — and what's coming up for you.
        </p>
      </header>

      <nav className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {destinations.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="group flex flex-col gap-2.5 rounded-xl border border-hairline bg-white p-4 shadow-card transition-all hover:-translate-y-0.5 hover:border-accent-200 hover:shadow-raised sm:p-5"
          >
            <span className="flex size-9 items-center justify-center rounded-lg bg-accent-50 text-accent-600 transition-colors group-hover:bg-accent-100">
              <item.icon size={18} />
            </span>
            <span className="text-[15px] font-semibold text-gray-900">{item.label}</span>
            <span className="text-xs text-gray-500 sm:text-[13px]">{DESTINATION_HINTS[item.to]}</span>
          </Link>
        ))}
      </nav>

      {work.isPending ? (
        <Card>
          <SkeletonRows rows={5} />
        </Card>
      ) : work.isError ? (
        <ErrorBanner message="Couldn't load your work." onRetry={() => work.refetch()} />
      ) : (
        <UpNext
          today={work.data.today}
          tasks={work.data.tasks as WorkTask[]}
          viewer={viewer!}
        />
      )}
    </div>
  );
}

const DESTINATION_HINTS: Record<string, string> = {
  "/my-work": "Your tasks & assignments",
  "/board": "Every project at a glance",
  "/calendar": "Shoots, deadlines & events",
  "/expenses": "Submit & track spend",
  "/money": "Income, spend & budgets",
  "/settings/users": "Team, roles & permissions",
};

function UpNext({
  today,
  tasks,
  viewer,
}: {
  today: string;
  tasks: WorkTask[];
  viewer: Viewer;
}) {
  const open = tasks.filter((t) => t.status !== "done");
  const weekEnd = addDaysISO(today, 7);

  const groups = [
    {
      label: "Needs attention",
      tone: "text-status-flagged",
      items: open.filter((t) => t.flagged),
    },
    {
      label: "Overdue",
      tone: "text-status-overdue",
      items: open.filter((t) => !t.flagged && t.deadline !== null && t.deadline < today),
    },
    {
      label: "Today",
      tone: "text-gray-900",
      items: open.filter((t) => !t.flagged && t.deadline === today),
    },
    {
      label: "This week",
      tone: "text-gray-900",
      items: open.filter(
        (t) => !t.flagged && t.deadline !== null && t.deadline > today && t.deadline <= weekEnd,
      ),
    },
  ].filter((g) => g.items.length > 0);

  const later = open.length - groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <Card>
      <CardBody className="space-y-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-gray-900">Next two weeks</h2>
          <Link
            to="/calendar"
            className="inline-flex items-center gap-1 text-[13px] font-medium text-accent-600 hover:text-accent-700"
          >
            Open full calendar <ArrowRight size={13} />
          </Link>
        </div>

        <DayStrip today={today} tasks={open} />

        {groups.length === 0 ? (
          <EmptyState
            title="Nothing due in the next two weeks 🎉"
            hint="New work lands here automatically when a stage is handed to you."
          />
        ) : (
          <div className="space-y-5">
            {groups.map((group) => (
              <section key={group.label}>
                <h3 className={cn("mb-2 text-[13px] font-semibold", group.tone)}>
                  {group.label} · {group.items.length}
                </h3>
                <div className="space-y-2">
                  {group.items.map((task) => (
                    <TaskRow key={task.id} task={task} today={today} viewer={viewer} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {later > 0 && (
          <Link
            to="/my-work"
            className="inline-flex items-center gap-1 text-[13px] font-medium text-accent-600 hover:text-accent-700"
          >
            {later} more in My Work <ArrowRight size={13} />
          </Link>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * A fortnight at a glance: one column per day, a dot per task due that day.
 * Scrolls sideways on a phone rather than squeezing 14 columns into 360px.
 */
function DayStrip({ today, tasks }: { today: string; tasks: WorkTask[] }) {
  const days = useMemo(() => {
    const start = addDaysISO(today, -1); // yesterday for context, then a fortnight
    return Array.from({ length: STRIP_DAYS }, (_, i) => {
      const date = addDaysISO(start, i);
      const due = tasks.filter((t) => t.deadline === date);
      return {
        date,
        isToday: date === today,
        isPast: date < today,
        dots: due.slice(0, 3).map((t) => (date < today ? "overdue" : date === today ? "today" : "ahead")),
        count: due.length,
      };
    });
  }, [today, tasks]);

  return (
    <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 sm:grid sm:grid-cols-7 sm:gap-2 sm:overflow-visible">
      {days.map((day) => {
        const dayNum = Number(day.date.slice(8, 10));
        const dow = DOW[(new Date(`${day.date}T00:00:00Z`).getUTCDay() + 6) % 7];
        return (
          <div
            key={day.date}
            title={`${formatShort(day.date)}${day.count > 0 ? ` — ${day.count} due` : ""}`}
            className={cn(
              "flex min-w-11 flex-1 flex-col items-center gap-1.5 rounded-xl py-2",
              day.isToday ? "bg-accent-50" : day.isPast ? "opacity-55" : "",
            )}
          >
            <span
              className={cn(
                "text-[11px] font-semibold",
                day.isToday ? "text-accent-600" : "text-gray-400",
              )}
            >
              {dow}
            </span>
            <span
              className={cn(
                "flex size-7 items-center justify-center rounded-full text-[13px] font-bold",
                day.isToday ? "bg-accent-600 text-white" : "text-gray-900",
              )}
            >
              {dayNum}
            </span>
            <span className="flex h-1.5 items-center gap-0.5">
              {day.dots.map((tone, i) => (
                <span
                  key={i}
                  className={cn(
                    "size-1.5 rounded-full",
                    tone === "overdue"
                      ? "bg-status-overdue"
                      : tone === "today"
                        ? "bg-status-due-soon"
                        : "bg-accent-500",
                  )}
                />
              ))}
            </span>
          </div>
        );
      })}
    </div>
  );
}
