import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorBanner, SkeletonRows } from "@/components/ui/feedback";
import { SectionLabel } from "@/components/ui/page";
import { TaskRow, type WorkTask } from "@/components/task-row";
import { addDaysISO, formatLong, formatShort, weekdayOf } from "@/lib/dates";
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
 *
 * Dressed as the top of a call sheet — the date is the headline, because on a
 * shoot day the date is the only context anyone needs before the work.
 */
export function HomePage() {
  const trpc = useTRPC();
  const me = useMe();
  const nav = useNav();
  const work = useQuery(trpc.tasks.myWork.queryOptions());

  const viewer = me.data as Viewer | undefined;
  // Every destination, not the first four: on a phone the tab bar only holds
  // five, so anything missing here is unreachable for the rest of the team.
  const destinations = nav.filter((item) => item.to !== "/home");
  const today = work.data?.today;

  return (
    <div className="stagger space-y-9">
      <header className="border-b border-rule pb-6">
        <p className="eyebrow text-ink-400">
          {viewer ? `${weekdayOf(today ?? "")} · ${firstName(viewer.name)}` : "Today"}
        </p>
        <h1 className="display mt-2 text-h1 text-ink-900 sm:text-hero">
          {today ? formatLong(today) : "Today"}
        </h1>
        {work.data && (
          <p className="mt-2 text-lead text-ink-500">
            {summarise(work.data.tasks as WorkTask[], work.data.today)}
          </p>
        )}
      </header>

      <nav className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
        {destinations.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="group flex flex-col gap-2 rounded-card border border-rule bg-surface p-3.5 transition-[border-color,box-shadow] hover:border-ink-300 hover:shadow-lift sm:p-4"
          >
            <item.icon size={17} className="text-ink-400 transition-colors group-hover:text-ink-900" />
            <span className="display text-base text-ink-900">{item.label}</span>
            <span className="text-small leading-snug text-ink-400">
              {DESTINATION_HINTS[item.to]}
            </span>
          </Link>
        ))}
      </nav>

      {work.isPending ? (
        <Card>
          <SkeletonRows rows={5} />
        </Card>
      ) : work.isError ? (
        <ErrorBanner message="Your work didn't load." onRetry={() => work.refetch()} />
      ) : (
        <UpNext today={work.data.today} tasks={work.data.tasks as WorkTask[]} viewer={viewer!} />
      )}
    </div>
  );
}

const DESTINATION_HINTS: Record<string, string> = {
  "/my-work": "Your tasks & assignments",
  "/board": "Every project at a glance",
  "/calendar": "Shoots, deadlines & events",
  "/expenses": "Submit & track spend",
  "/time-off": "Leave balance & payslips",
  "/money": "Income, spend & budgets",
  "/people": "Requests, balances & payroll",
  "/settings/users": "Team, roles & permissions",
};

/** One honest sentence about the day, in the order a person would say it. */
function summarise(tasks: WorkTask[], today: string): string {
  const open = tasks.filter((t) => t.status !== "done");
  const late = open.filter((t) => t.deadline !== null && t.deadline < today).length;
  const due = open.filter((t) => t.deadline === today).length;
  const flagged = open.filter((t) => t.flagged).length;

  const parts: string[] = [];
  if (late > 0) parts.push(`${late} overdue`);
  if (due > 0) parts.push(`${due} due today`);
  if (flagged > 0) parts.push(`${flagged} flagged`);
  if (parts.length === 0) {
    return open.length === 0
      ? "Nothing on your plate right now."
      : `Nothing due today — ${open.length} open further out.`;
  }
  return `${parts.join(" · ")}.`;
}

function UpNext({ today, tasks, viewer }: { today: string; tasks: WorkTask[]; viewer: Viewer }) {
  const open = tasks.filter((t) => t.status !== "done");
  const weekEnd = addDaysISO(today, 7);

  const groups = [
    {
      label: "Needs attention",
      tone: "late" as const,
      items: open.filter((t) => t.flagged),
    },
    {
      label: "Overdue",
      tone: "late" as const,
      items: open.filter((t) => !t.flagged && t.deadline !== null && t.deadline < today),
    },
    {
      label: "Today",
      tone: "now" as const,
      items: open.filter((t) => !t.flagged && t.deadline === today),
    },
    {
      label: "This week",
      tone: "neutral" as const,
      items: open.filter(
        (t) => !t.flagged && t.deadline !== null && t.deadline > today && t.deadline <= weekEnd,
      ),
    },
  ].filter((g) => g.items.length > 0);

  const later = open.length - groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="display text-title text-ink-900">The next two weeks</h2>
        <Link
          to="/calendar"
          className="inline-flex items-center gap-1.5 text-small font-medium text-ink-500 transition-colors hover:text-ink-900"
        >
          Full calendar <ArrowRight size={13} />
        </Link>
      </div>

      <DayStrip today={today} tasks={open} />

      {groups.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing due in the next two weeks"
            hint="Work lands here on its own the moment a stage is handed to you."
          />
        </Card>
      ) : (
        <div className="space-y-7">
          {groups.map((group) => (
            <section key={group.label}>
              <SectionLabel tone={group.tone} count={group.items.length} className="mb-3">
                {group.label}
              </SectionLabel>
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
          className="inline-flex items-center gap-1.5 text-small font-medium text-ink-500 transition-colors hover:text-ink-900"
        >
          <span className="font-mono">{later}</span> more in My Work <ArrowRight size={13} />
        </Link>
      )}
    </section>
  );
}

/**
 * A fortnight at a glance. Each day is a column and each task due that day is
 * one tick under it, coloured by how much trouble it is in — so the shape of
 * the next two weeks is legible before you read a single word.
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
        ticks: due.slice(0, 4).map(() => (date < today ? "late" : date === today ? "now" : "ahead")),
        count: due.length,
      };
    });
  }, [today, tasks]);

  return (
    <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 sm:grid sm:grid-cols-14 sm:overflow-visible">
      {days.map((day) => {
        const dayNum = Number(day.date.slice(8, 10));
        const dow = DOW[(new Date(`${day.date}T00:00:00Z`).getUTCDay() + 6) % 7];
        return (
          <div
            key={day.date}
            title={`${formatShort(day.date)}${day.count > 0 ? ` — ${day.count} due` : ""}`}
            className={cn(
              "flex min-w-10 flex-1 flex-col items-center gap-1.5 py-1",
              day.isPast && "opacity-40",
            )}
          >
            <span className="font-mono text-[10px] uppercase text-ink-300">{dow}</span>
            <span
              className={cn(
                "flex size-7 items-center justify-center rounded-[7px] font-mono text-small font-medium tabular-nums",
                day.isToday ? "bg-ink-900 text-white" : "text-ink-700",
              )}
            >
              {dayNum}
            </span>
            <span className="flex h-4 flex-col items-center gap-[2px] pt-0.5">
              {day.ticks.map((tone, i) => (
                <span
                  key={i}
                  className={cn(
                    "h-[2.5px] w-4 rounded-full",
                    tone === "late" ? "bg-late" : tone === "now" ? "bg-now" : "bg-ink-300",
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
