import { taskLabel } from "@mams/shared";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Card, CardBody } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/feedback";
import { addDaysISO, formatShort, todayISO } from "@/lib/dates";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const WD = ["M", "T", "W", "T", "F", "S", "S"];

type CalTask = {
  id: string;
  deadline: string | null;
  startDate: string | null;
  projectTitle: string;
  stageName: string | null;
  assignees: { id: string; name: string }[];
};

/**
 * Compact month calendar for the landing screen: a tick under every busy day,
 * tap a day to see what's on. Scope follows `team.viewAll` — your work, or
 * everyone's.
 */
export function MiniCalendar() {
  const trpc = useTRPC();
  const today = todayISO();
  const [cursor, setCursor] = useState(() => today.slice(0, 7));
  const [selected, setSelected] = useState(today);

  const grid = useMemo(() => buildGrid(cursor), [cursor]);
  const from = grid[0]!.date;
  const to = grid[grid.length - 1]!.date;
  const feed = useQuery(trpc.tasks.calendar.queryOptions({ from, to }));

  const byDay = useMemo(() => {
    const map = new Map<string, CalTask[]>();
    for (const task of (feed.data?.tasks ?? []) as CalTask[]) {
      if (!task.deadline) continue;
      const start =
        task.startDate && task.startDate < task.deadline ? task.startDate : task.deadline;
      for (let d = start < from ? from : start; d <= task.deadline && d <= to; d = addDaysISO(d, 1)) {
        const list = map.get(d) ?? [];
        list.push(task);
        map.set(d, list);
      }
    }
    return map;
  }, [feed.data, from, to]);

  const [y, m] = cursor.split("-").map(Number) as [number, number];
  const monthLabel = new Date(y, m - 1).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
  const selectedTasks = byDay.get(selected) ?? [];

  return (
    <Card>
      <CardBody>
        <div className="mb-3 flex items-center justify-between">
          <span className="display text-base text-ink-900">{monthLabel}</span>
          <span className="flex items-center gap-0.5">
            <button
              aria-label="Previous month"
              onClick={() => setCursor(new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7))}
              className="flex size-7 items-center justify-center rounded-[7px] text-ink-400 transition-colors hover:bg-ink-50 hover:text-ink-900"
            >
              <ChevronLeft size={15} />
            </button>
            <button
              aria-label="Next month"
              onClick={() => setCursor(new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7))}
              className="flex size-7 items-center justify-center rounded-[7px] text-ink-400 transition-colors hover:bg-ink-50 hover:text-ink-900"
            >
              <ChevronRight size={15} />
            </button>
          </span>
        </div>

        <div className="grid grid-cols-7 gap-y-0.5 text-center">
          {WD.map((d, i) => (
            <span key={i} className="pb-1.5 font-mono text-[10px] uppercase text-ink-300">
              {d}
            </span>
          ))}
          {feed.isPending
            ? Array.from({ length: 35 }, (_, i) => <Skeleton key={i} className="m-0.5 h-9" />)
            : grid.map((cell) => {
                const tasks = byDay.get(cell.date) ?? [];
                const isToday = cell.date === today;
                const isSelected = cell.date === selected;
                const hasLate = tasks.some((t) => t.deadline !== null && t.deadline < today);
                const dueHere = tasks.some((t) => t.deadline === cell.date);
                return (
                  <button
                    key={cell.date}
                    onClick={() => setSelected(cell.date)}
                    className={cn(
                      "relative mx-auto flex size-9 flex-col items-center justify-center rounded-[8px] font-mono text-small tabular-nums transition-colors",
                      !cell.inMonth && "text-ink-200",
                      isSelected
                        ? "bg-ink-900 font-medium text-white"
                        : isToday
                          ? "font-medium text-ink-900 ring-1 ring-ink-900"
                          : cell.inMonth
                            ? "text-ink-600 hover:bg-ink-50"
                            : "",
                    )}
                  >
                    {Number(cell.date.slice(8, 10))}
                    {tasks.length > 0 && (
                      <span
                        className={cn(
                          "absolute bottom-1 h-[2.5px] rounded-full",
                          tasks.length > 2 ? "w-4" : "w-2",
                          isSelected
                            ? "bg-white/70"
                            : hasLate
                              ? "bg-late"
                              : dueHere
                                ? "bg-now"
                                : "bg-ink-200",
                        )}
                      />
                    )}
                  </button>
                );
              })}
        </div>

        <div className="mt-4 border-t border-rule-soft pt-3.5">
          <p className="eyebrow mb-2 text-ink-400">
            {selected === today ? "Today" : formatShort(selected)}
          </p>
          {selectedTasks.length === 0 ? (
            <p className="text-small text-ink-400">Nothing on this day.</p>
          ) : (
            <ul className="space-y-1.5">
              {selectedTasks.slice(0, 5).map((task) => (
                <li key={task.id}>
                  <Link to={`/tasks/${task.id}`} className="group flex items-baseline gap-2">
                    <span
                      className={cn(
                        "size-1.5 shrink-0 -translate-y-px rounded-full",
                        task.deadline === selected ? "bg-now" : "bg-ink-200",
                      )}
                    />
                    <span className="truncate text-small font-medium text-ink-800 transition-colors group-hover:text-ink-950">
                      {taskLabel(task.stageName)}
                    </span>
                    <span className="truncate text-small text-ink-400">{task.projectTitle}</span>
                  </Link>
                </li>
              ))}
              {selectedTasks.length > 5 && (
                <li className="text-small text-ink-400">
                  <span className="font-mono">+{selectedTasks.length - 5}</span> more
                </li>
              )}
            </ul>
          )}
          <Link
            to="/calendar"
            className="mt-3 inline-block text-small font-medium text-ink-500 transition-colors hover:text-ink-900"
          >
            Full calendar →
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}

function buildGrid(cursor: string): { date: string; inMonth: boolean }[] {
  const [y, m] = cursor.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const startOffset = (first.getUTCDay() + 6) % 7;
  const start = new Date(Date.UTC(y, m - 1, 1 - startOffset));
  const cells: { date: string; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getTime() + i * 86_400_000);
    cells.push({ date: d.toISOString().slice(0, 10), inMonth: d.getUTCMonth() === m - 1 });
  }
  const lastWeek = cells.slice(35);
  return lastWeek.every((c) => !c.inMonth) ? cells.slice(0, 35) : cells;
}
