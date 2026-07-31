import { taskLabel } from "@mams/shared";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Card, CardBody } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/feedback";
import { addDaysISO, deadlineLabel, todayISO } from "@/lib/dates";
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
 * Compact month calendar for the landing screen: dots on busy days, tap a day
 * to see what's on. Scope follows `team.viewAll` — your work, or everyone's.
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
      const start = task.startDate && task.startDate < task.deadline ? task.startDate : task.deadline;
      for (let d = start < from ? from : start; d <= task.deadline && d <= to; d = addDaysISO(d, 1)) {
        const list = map.get(d) ?? [];
        list.push(task);
        map.set(d, list);
      }
    }
    return map;
  }, [feed.data, from, to]);

  const [y, m] = cursor.split("-").map(Number) as [number, number];
  const monthLabel = new Date(y, m - 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const selectedTasks = byDay.get(selected) ?? [];

  return (
    <Card>
      <CardBody>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-800">{monthLabel}</span>
          <span className="flex items-center gap-1">
            <button
              onClick={() => setCursor(new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7))}
              className="flex size-7 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100"
            >
              <ChevronLeft size={15} />
            </button>
            <button
              onClick={() => setCursor(new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7))}
              className="flex size-7 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100"
            >
              <ChevronRight size={15} />
            </button>
          </span>
        </div>

        <div className="grid grid-cols-7 text-center">
          {WD.map((d, i) => (
            <span key={i} className="pb-1 text-[10px] font-semibold uppercase text-gray-300">
              {d}
            </span>
          ))}
          {feed.isPending
            ? Array.from({ length: 35 }, (_, i) => <Skeleton key={i} className="m-0.5 h-8" />)
            : grid.map((cell) => {
                const tasks = byDay.get(cell.date) ?? [];
                const isToday = cell.date === today;
                const isSelected = cell.date === selected;
                const hasLate = tasks.some((t) => t.deadline !== null && t.deadline < today);
                return (
                  <button
                    key={cell.date}
                    onClick={() => setSelected(cell.date)}
                    className={cn(
                      "relative mx-auto flex h-9 w-9 flex-col items-center justify-center rounded-lg text-xs",
                      !cell.inMonth && "text-gray-300",
                      isSelected
                        ? "bg-accent-600 font-semibold text-white"
                        : isToday
                          ? "bg-accent-50 font-semibold text-accent-700"
                          : "text-gray-700 hover:bg-gray-100",
                    )}
                  >
                    {Number(cell.date.slice(8, 10))}
                    {tasks.length > 0 && (
                      <span className="absolute bottom-1 flex gap-0.5">
                        {tasks.slice(0, 3).map((_, i) => (
                          <span
                            key={i}
                            className={cn(
                              "size-1 rounded-full",
                              isSelected ? "bg-white" : hasLate ? "bg-status-overdue" : "bg-accent-500",
                            )}
                          />
                        ))}
                      </span>
                    )}
                  </button>
                );
              })}
        </div>

        <div className="mt-3 border-t border-gray-100 pt-3">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
            {selected === today ? "Today" : deadlineLabel(selected, today).text}
          </p>
          {selectedTasks.length === 0 ? (
            <p className="text-sm text-gray-400">Nothing on this day.</p>
          ) : (
            <ul className="space-y-1">
              {selectedTasks.slice(0, 5).map((task) => (
                <li key={task.id}>
                  <Link to={`/tasks/${task.id}`} className="group flex items-baseline gap-2 text-sm">
                    <span
                      className={cn(
                        "size-1.5 shrink-0 translate-y-[-1px] rounded-full",
                        task.deadline === selected ? "bg-status-due-soon" : "bg-accent-500",
                      )}
                    />
                    <span className="truncate font-medium text-gray-800 group-hover:text-accent-700">
                      {taskLabel(task.stageName)}
                    </span>
                    <span className="truncate text-xs text-gray-400">
                      {task.assignees.length > 0
                        ? `${task.assignees.map((a) => a.name).join(", ")} · `
                        : ""}
                      {task.projectTitle}
                    </span>
                  </Link>
                </li>
              ))}
              {selectedTasks.length > 5 && (
                <li className="text-xs text-gray-400">+{selectedTasks.length - 5} more</li>
              )}
            </ul>
          )}
          <Link
            to="/calendar"
            className="mt-2 inline-block text-xs font-medium text-accent-600 hover:underline"
          >
            Open full calendar →
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
