import { taskLabel } from "@mams/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorBanner, SkeletonRows } from "@/components/ui/feedback";
import { Input, Label, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { PeoplePicker } from "@/components/people-picker";
import { colorForName, PageHeader } from "@/components/ui/page";
import { addDaysISO, todayISO } from "@/lib/dates";
import { useCan } from "@/lib/session";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type CalTask = {
  id: string;
  status: string;
  deadline: string | null;
  startDate: string | null;
  projectTitle: string;
  clientName: string;
  stageName: string | null;
  assignees: { id: string; name: string }[];
  flagged: boolean;
};

export function CalendarPage() {
  const trpc = useTRPC();
  const can = useCan();
  const seesEveryone = can("team.viewAll");
  const canAddTasks = can("tasks.manage");
  const today = todayISO();

  const [cursor, setCursor] = useState(() => today.slice(0, 7)); // YYYY-MM
  const [personFilter, setPersonFilter] = useState("");
  const [quickAddDay, setQuickAddDay] = useState<string | null>(null);

  const users = useQuery({ ...trpc.users.list.queryOptions(), enabled: seesEveryone });

  // month grid: weeks starting Monday, padded to full weeks
  const grid = useMemo(() => buildMonthGrid(cursor), [cursor]);
  const from = grid[0]!.date;
  const to = grid[grid.length - 1]!.date;

  const feed = useQuery(
    trpc.tasks.calendar.queryOptions({ from, to, userId: personFilter || undefined }),
  );

  const tasksByDay = useMemo(() => {
    const map = new Map<string, CalTask[]>();
    if (!feed.data) return map;
    for (const task of feed.data.tasks as CalTask[]) {
      if (!task.deadline) continue;
      const start = task.startDate && task.startDate < task.deadline ? task.startDate : task.deadline;
      for (let d = start < from ? from : start; d <= task.deadline && d <= to; d = addDaysISO(d, 1)) {
        if (d < from) continue;
        const list = map.get(d) ?? [];
        list.push(task);
        map.set(d, list);
      }
    }
    return map;
  }, [feed.data, from, to]);

  const [year, month] = cursor.split("-").map(Number) as [number, number];

  function shiftMonth(delta: number) {
    const d = new Date(Date.UTC(year, month - 1 + delta, 1));
    setCursor(d.toISOString().slice(0, 7));
  }

  return (
    <div>
      <PageHeader
        title="Calendar"
        subtitle={
          seesEveryone ? "Everyone's work, day by day — tap a day to add a task" : "Your work, day by day"
        }
        actions={
          <div className="flex items-center gap-2">
            {seesEveryone && (
              <Select
                className="w-40"
                value={personFilter}
                onChange={(e) => setPersonFilter(e.target.value)}
              >
                <option value="">Everyone</option>
                {users.data
                  ?.filter((u) => u.active)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </Select>
            )}
            <div className="flex items-center rounded-lg border border-gray-300 bg-white">
              <button
                onClick={() => shiftMonth(-1)}
                className="flex size-9 items-center justify-center rounded-l-lg text-gray-500 hover:bg-gray-50"
              >
                <ChevronLeft size={17} />
              </button>
              <button
                onClick={() => setCursor(today.slice(0, 7))}
                className="border-x border-gray-200 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 h-9"
              >
                {MONTHS[month - 1]} {year}
              </button>
              <button
                onClick={() => shiftMonth(1)}
                className="flex size-9 items-center justify-center rounded-r-lg text-gray-500 hover:bg-gray-50"
              >
                <ChevronRight size={17} />
              </button>
            </div>
          </div>
        }
      />

      {feed.isError ? (
        <ErrorBanner message="Couldn't load the calendar." onRetry={() => feed.refetch()} />
      ) : feed.isPending ? (
        <Card>
          <SkeletonRows rows={6} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="grid grid-cols-7 border-b border-gray-100 bg-slate-50/60">
            {WEEKDAYS.map((d) => (
              <div key={d} className="px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-gray-400">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {grid.map((cell) => (
              <DayCell
                key={cell.date}
                cell={cell}
                today={today}
                tasks={tasksByDay.get(cell.date) ?? []}
                colorByPerson={seesEveryone && !personFilter}
                onQuickAdd={canAddTasks ? () => setQuickAddDay(cell.date) : undefined}
              />
            ))}
          </div>
        </Card>
      )}

      {quickAddDay && (
        <QuickAddModal
          day={quickAddDay}
          onClose={() => setQuickAddDay(null)}
        />
      )}
    </div>
  );
}

function DayCell({
  cell,
  today,
  tasks,
  colorByPerson,
  onQuickAdd,
}: {
  cell: { date: string; inMonth: boolean };
  today: string;
  tasks: CalTask[];
  colorByPerson: boolean;
  onQuickAdd?: () => void;
}) {
  const day = Number(cell.date.slice(8, 10));
  const isToday = cell.date === today;
  const shown = tasks.slice(0, 3);

  return (
    <div
      className={cn(
        "group relative min-h-20 border-b border-r border-gray-100 p-1 sm:min-h-28 sm:p-1.5",
        !cell.inMonth && "bg-slate-50/50",
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "flex size-6 items-center justify-center rounded-full text-xs font-medium",
            isToday ? "bg-accent-600 text-white" : cell.inMonth ? "text-gray-700" : "text-gray-300",
          )}
        >
          {day}
        </span>
        {onQuickAdd && (
          <button
            onClick={onQuickAdd}
            title={`Add task on ${cell.date}`}
            className="flex size-6 items-center justify-center rounded-md text-gray-300 transition-opacity hover:bg-accent-50 hover:text-accent-600 sm:opacity-0 sm:group-hover:opacity-100"
          >
            <Plus size={14} />
          </button>
        )}
      </div>
      <div className="mt-1 space-y-1">
        {shown.map((task) => {
          const overdue = task.deadline !== null && task.deadline < today;
          const dueToday = task.deadline === cell.date;
          const label = taskLabel(task.stageName);
          const who = task.assignees.map((a) => a.name);
          const lead = who[0];
          return (
            <Link
              key={task.id}
              to={`/tasks/${task.id}`}
              title={`${label} — ${task.projectTitle} (${who.length > 0 ? who.join(", ") : "unassigned"})`}
              className={cn(
                "block truncate rounded px-1.5 py-0.5 text-[11px] font-medium leading-4 text-white",
                colorByPerson
                  ? lead
                    ? colorForName(lead)
                    : "bg-gray-400"
                  : overdue
                    ? "bg-status-overdue"
                    : dueToday
                      ? "bg-status-due-soon"
                      : "bg-accent-500",
                dueToday && "ring-1 ring-inset ring-white/60",
              )}
            >
              {colorByPerson && lead
                ? `${lead.split(" ")[0]}${who.length > 1 ? ` +${who.length - 1}` : ""}: `
                : ""}
              {label}
            </Link>
          );
        })}
        {tasks.length > 3 && (
          <p className="px-1 text-[10px] font-medium text-gray-400">+{tasks.length - 3} more</p>
        )}
      </div>
    </div>
  );
}

/** Tap a day → add work that lands on it. The day becomes the deadline. */
function QuickAddModal({ day, onClose }: { day: string; onClose: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const projects = useQuery(trpc.projects.list.queryOptions({ status: "active" }));
  const stages = useQuery(trpc.workflows.listStages.queryOptions());
  const [projectId, setProjectId] = useState("");
  const [stageId, setStageId] = useState("");
  const [startDate, setStartDate] = useState(day);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);

  const create = useMutation(
    trpc.tasks.create.mutationOptions({
      onSuccess: () => {
        toast.success(`Task added for ${day}`);
        queryClient.invalidateQueries({ queryKey: trpc.tasks.pathKey() });
        queryClient.invalidateQueries({ queryKey: trpc.projects.pathKey() });
        onClose();
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  return (
    <Modal
      title={`New task · due ${day}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={create.isPending || !projectId || !stageId}
            onClick={() =>
              create.mutate({
                projectId,
                stageId,
                startDate: startDate || undefined,
                deadline: day,
                assigneeIds,
              })
            }
          >
            Add task
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor="qa-project">Project</Label>
          <Select id="qa-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Choose a project…</option>
            {projects.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.clientName} — {p.title}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="qa-stage">Kind of work</Label>
          <Select id="qa-stage" value={stageId} onChange={(e) => setStageId(e.target.value)}>
            <option value="">Choose…</option>
            {stages.data
              ?.filter((s) => s.active)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="qa-start">Start date</Label>
          <Input
            id="qa-start"
            type="date"
            value={startDate}
            max={day}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div>
          <Label>Who's on it</Label>
          <PeoplePicker selected={assigneeIds} onChange={setAssigneeIds} />
        </div>
      </div>
    </Modal>
  );
}

function buildMonthGrid(cursor: string): { date: string; inMonth: boolean }[] {
  const [y, m] = cursor.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const startOffset = (first.getUTCDay() + 6) % 7; // Monday = 0
  const start = new Date(Date.UTC(y, m - 1, 1 - startOffset));
  const cells: { date: string; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getTime() + i * 86_400_000);
    cells.push({
      date: d.toISOString().slice(0, 10),
      inMonth: d.getUTCMonth() === m - 1,
    });
  }
  // drop a trailing all-out-of-month week
  const lastWeek = cells.slice(35);
  return lastWeek.every((c) => !c.inMonth) ? cells.slice(0, 35) : cells;
}
