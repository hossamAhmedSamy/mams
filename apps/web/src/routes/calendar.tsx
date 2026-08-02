import { taskLabel } from "@mams/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorBanner, SkeletonRows } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { PeoplePicker } from "@/components/people-picker";
import { PageHeader, toneForName } from "@/components/ui/page";
import { addDaysISO, todayISO } from "@/lib/dates";
import { useCan } from "@/lib/session";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
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
  // Who is off, drawn under the work: the whole point of a shared calendar is
  // not to hand someone a shoot on a day they told you they'd be away.
  const leave = useQuery(trpc.hr.calendar.queryOptions({ from, to }));

  const leaveByDay = useMemo(() => {
    const map = new Map<string, { id: string; userName: string }[]>();
    for (const off of leave.data ?? []) {
      if (personFilter && off.userId !== personFilter) continue;
      const start = off.startDate < from ? from : off.startDate;
      const end = off.endDate > to ? to : off.endDate;
      for (let d = start; d <= end; d = addDaysISO(d, 1)) {
        map.set(d, [...(map.get(d) ?? []), { id: off.id, userName: off.userName }]);
      }
    }
    return map;
  }, [leave.data, personFilter, from, to]);

  const tasksByDay = useMemo(() => {
    const map = new Map<string, CalTask[]>();
    if (!feed.data) return map;
    for (const task of feed.data.tasks as CalTask[]) {
      if (!task.deadline) continue;
      const start =
        task.startDate && task.startDate < task.deadline ? task.startDate : task.deadline;
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
  const colorByPerson = seesEveryone && !personFilter;

  function shiftMonth(delta: number) {
    const d = new Date(Date.UTC(year, month - 1 + delta, 1));
    setCursor(d.toISOString().slice(0, 7));
  }

  return (
    <div className="settle">
      <PageHeader
        eyebrow={seesEveryone ? "The whole team" : "Your schedule"}
        title="Calendar"
        subtitle={
          seesEveryone
            ? "Everyone's work, day by day — tap a day to add a task"
            : "Your work, day by day"
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {seesEveryone && (
              <Select
                className="w-40"
                aria-label="Filter by person"
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
            <div className="flex items-center overflow-hidden rounded-field border border-rule bg-surface">
              <button
                aria-label="Previous month"
                onClick={() => shiftMonth(-1)}
                className="flex size-9 items-center justify-center text-ink-400 transition-colors hover:bg-ink-50 hover:text-ink-900"
              >
                <ChevronLeft size={17} />
              </button>
              <button
                onClick={() => setCursor(today.slice(0, 7))}
                title="Jump to this month"
                className="display h-9 border-x border-rule px-3.5 text-small text-ink-800 transition-colors hover:bg-ink-50"
              >
                {MONTHS[month - 1]} {year}
              </button>
              <button
                aria-label="Next month"
                onClick={() => shiftMonth(1)}
                className="flex size-9 items-center justify-center text-ink-400 transition-colors hover:bg-ink-50 hover:text-ink-900"
              >
                <ChevronRight size={17} />
              </button>
            </div>
          </div>
        }
      />

      {feed.isError ? (
        <ErrorBanner message="The calendar didn't load." onRetry={() => feed.refetch()} />
      ) : feed.isPending ? (
        <Card>
          <SkeletonRows rows={6} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="grid grid-cols-7 border-b border-rule bg-paper/70">
            {WEEKDAYS.map((d) => (
              <div key={d} className="eyebrow px-2 py-2.5 text-center text-ink-400">
                <span className="hidden sm:inline">{d}</span>
                <span className="sm:hidden">{d[0]}</span>
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
                off={leaveByDay.get(cell.date) ?? []}
                colorByPerson={colorByPerson}
                onQuickAdd={canAddTasks ? () => setQuickAddDay(cell.date) : undefined}
              />
            ))}
          </div>
        </Card>
      )}

      {/* The legend earns its place only when colour means a person. */}
      {colorByPerson && users.data && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="eyebrow text-ink-400">Who</span>
          {users.data
            .filter((u) => u.active)
            .map((u) => (
              <span key={u.id} className="inline-flex items-center gap-1.5 text-small text-ink-500">
                <span
                  className="size-2.5 rounded-[3px]"
                  style={{ backgroundColor: toneForName(u.name) }}
                />
                {u.name}
              </span>
            ))}
        </div>
      )}

      {quickAddDay && <QuickAddModal day={quickAddDay} onClose={() => setQuickAddDay(null)} />}
    </div>
  );
}

function DayCell({
  cell,
  today,
  tasks,
  off,
  colorByPerson,
  onQuickAdd,
}: {
  cell: { date: string; inMonth: boolean };
  today: string;
  tasks: CalTask[];
  off: { id: string; userName: string }[];
  colorByPerson: boolean;
  onQuickAdd?: () => void;
}) {
  const day = Number(cell.date.slice(8, 10));
  const isToday = cell.date === today;
  const shown = tasks.slice(0, 3);

  return (
    <div
      className={cn(
        "group relative min-h-20 border-b border-r border-rule-soft p-1 last:border-r-0 sm:min-h-28 sm:p-1.5",
        !cell.inMonth && "bg-paper/60",
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "flex size-6 items-center justify-center rounded-[6px] font-mono text-small tabular-nums",
            isToday
              ? "bg-ink-900 font-medium text-white"
              : cell.inMonth
                ? "text-ink-600"
                : "text-ink-200",
          )}
        >
          {day}
        </span>
        {onQuickAdd && (
          <button
            onClick={onQuickAdd}
            title={`Add a task due ${cell.date}`}
            className="flex size-6 items-center justify-center rounded-[6px] text-ink-300 transition-opacity hover:bg-ink-50 hover:text-ink-900 sm:opacity-0 sm:group-hover:opacity-100"
          >
            <Plus size={14} />
          </button>
        )}
      </div>
      <div className="mt-1 space-y-1">
        {/* Time off is drawn as absence — dashed and colourless, so it reads as
            "nobody here" rather than competing with the work on the day. */}
        {off.slice(0, 2).map((person) => (
          <span
            key={person.id}
            title={`${person.userName} is off`}
            className="block truncate rounded-[5px] border border-dashed border-ink-200 bg-ink-50/60 px-1.5 py-0.5 text-[11px] font-medium leading-4 text-ink-400"
          >
            {person.userName.split(" ")[0]} · off
          </span>
        ))}
        {off.length > 2 && (
          <p className="px-1 font-mono text-[10px] text-ink-300">+{off.length - 2} off</p>
        )}
        {shown.map((task) => {
          const overdue = task.deadline !== null && task.deadline < today;
          const dueToday = task.deadline === cell.date;
          const label = taskLabel(task.stageName);
          const who = task.assignees.map((a) => a.name);
          const lead = who[0];

          // Colour means one of two things and never both at once: whose day
          // this is (team view) or how late it is (single-person view).
          //
          // In team view the pill is a *tint* of the person's colour with a
          // solid edge, not a solid fill — a month of solid blocks turns the
          // grid into a quilt and drowns out the deadline signals everywhere
          // else in the app. The hue still reads; it just stops shouting.
          const tone = colorByPerson && lead ? toneForName(lead) : null;
          const personStyle = tone
            ? {
                backgroundColor: `color-mix(in srgb, ${tone} 13%, white)`,
                borderLeft: `3px solid ${tone}`,
                color: tone,
              }
            : undefined;

          return (
            <Link
              key={task.id}
              to={`/tasks/${task.id}`}
              title={`${label} — ${task.projectTitle} (${who.length > 0 ? who.join(", ") : "unassigned"})`}
              style={personStyle}
              className={cn(
                "block truncate rounded-[5px] px-1.5 py-0.5 text-[11px] font-medium leading-4",
                personStyle
                  ? "font-semibold"
                  : colorByPerson
                    ? "border-l-[3px] border-l-ink-300 bg-ink-50 text-ink-500"
                    : overdue
                      ? "bg-late text-white"
                      : dueToday
                        ? "bg-now text-white"
                        : "bg-ink-100 text-ink-600",
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
          <p className="px-1 font-mono text-[10px] text-ink-400">+{tasks.length - 3} more</p>
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
      eyebrow={`Due ${day}`}
      title="New task"
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
        <Field label="Project" htmlFor="qa-project">
          <Select id="qa-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Choose a project…</option>
            {projects.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.clientName} — {p.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Kind of work" htmlFor="qa-stage">
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
        </Field>
        <Field label="Starts" htmlFor="qa-start">
          <Input
            id="qa-start"
            type="date"
            value={startDate}
            max={day}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </Field>
        <Field label="Who's on it">
          <PeoplePicker selected={assigneeIds} onChange={setAssigneeIds} />
        </Field>
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
