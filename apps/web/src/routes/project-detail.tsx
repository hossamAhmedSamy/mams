import { can, taskLabel } from "@mams/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Flag, Lock, Plus, UserPlus } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState, ErrorBanner, SkeletonRows } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { AvatarStack, PageHeader, SectionLabel } from "@/components/ui/page";
import { RailNode } from "@/components/handoff-rail";
import { PeoplePicker } from "@/components/people-picker";
import { TaskActionButton } from "@/components/task-action";
import {
  DeadlineChip,
  PriorityDot,
  ScheduleLine,
  StatusBadge,
  timeTone,
  type Viewer,
} from "@/components/task-bits";
import { todayISO } from "@/lib/dates";
import { useMe } from "@/lib/session";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { LedgerTab } from "./project-ledger";

type ProjectTask = {
  id: string;
  status: string;
  chainPosition: number | null;
  deadline: string | null;
  startDate: string | null;
  flagged: boolean;
  requiresApproval: boolean;
  stageId: string | null;
  stageName: string | null;
  assignees: { id: string; name: string }[];
  assigneeIds: string[];
  checklist: { text: string; done: boolean }[] | null;
  driveLink: string | null;
};

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const trpc = useTRPC();
  const me = useMe();
  const queryClient = useQueryClient();
  const project = useQuery(trpc.projects.get.queryOptions({ id: id! }));
  const [tab, setTab] = useState<"work" | "activity" | "money">("work");
  const [adding, setAdding] = useState(false);

  const setStatus = useMutation(
    trpc.projects.setStatus.mutationOptions({
      onSettled: () => queryClient.invalidateQueries({ queryKey: trpc.projects.pathKey() }),
    }),
  );

  if (project.isPending)
    return (
      <Card>
        <SkeletonRows rows={6} />
      </Card>
    );
  if (project.isError)
    return <ErrorBanner message="This project didn't load." onRetry={() => project.refetch()} />;

  const p = project.data;
  const viewer = me.data as Viewer;
  const canManageProject = can(viewer, "projects.manage");
  const canManageTasks = can(viewer, "tasks.manage");
  const canSeeMoney = can(viewer, "money.view");
  const chain = (p.tasks as ProjectTask[]).filter((t) => t.chainPosition !== null);
  const adhoc = (p.tasks as ProjectTask[]).filter((t) => t.chainPosition === null);
  const doneCount = chain.filter((t) => t.status === "done").length;

  const tabs: { key: "work" | "activity" | "money"; label: string }[] = [
    { key: "work", label: "Work" },
    { key: "activity", label: "Activity" },
    ...(canSeeMoney ? [{ key: "money" as const, label: "Money" }] : []),
  ];

  return (
    <div className="settle">
      <PageHeader
        backTo="/board"
        backLabel="Projects"
        eyebrow={`${p.clientName}${p.campaign ? ` · ${p.campaign}` : ""}`}
        title={p.title}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <PriorityDot priority={p.priority as "high" | "medium" | "low"} />
            {p.driveLink && (
              <a
                href={p.driveLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-small font-medium text-ink-500 transition-colors hover:text-ink-900"
              >
                Drive <ExternalLink size={13} />
              </a>
            )}
            {canManageProject ? (
              <Select
                className="w-36"
                aria-label="Project status"
                value={p.status}
                onChange={(e) => setStatus.mutate({ id: p.id, status: e.target.value as never })}
              >
                <option value="active">Active</option>
                <option value="on_hold">On hold</option>
                <option value="completed">Completed</option>
                <option value="archived">Archived</option>
              </Select>
            ) : (
              <Badge tone={p.status === "completed" ? "done" : "ink"}>
                {p.status.replace("_", " ")}
              </Badge>
            )}
          </div>
        }
      />

      {p.notes && <p className="-mt-2 mb-6 max-w-2xl text-base text-ink-600">{p.notes}</p>}

      <div className="mb-7 flex gap-1 border-b border-rule">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2.5 text-base transition-colors",
              tab === t.key
                ? "border-ink-900 font-medium text-ink-900"
                : "border-transparent text-ink-400 hover:text-ink-700",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "work" && (
        <div className="space-y-10">
          {chain.length > 0 ? (
            <section>
              <SectionLabel className="mb-5" action={<Progress done={doneCount} total={chain.length} />}>
                The flow
              </SectionLabel>
              <Pipeline chain={chain} viewer={viewer} />
            </section>
          ) : (
            <Card>
              <EmptyState
                title="This project has no flow"
                hint="It runs on tasks added by hand instead — they're listed below."
              />
            </Card>
          )}

          <section>
            <SectionLabel
              className="mb-4"
              action={
                canManageTasks && (
                  <Button variant="secondary" size="sm" onClick={() => setAdding((v) => !v)}>
                    <Plus size={14} /> Add task
                  </Button>
                )
              }
            >
              Extra tasks
            </SectionLabel>
            {adding && (
              <div className="mb-3">
                <AddTaskCard projectId={p.id} onDone={() => setAdding(false)} />
              </div>
            )}
            {adhoc.length > 0 ? (
              <div className="space-y-2">
                {adhoc.map((task) => (
                  <AdhocTaskRow key={task.id} task={task} viewer={viewer} />
                ))}
              </div>
            ) : (
              !adding && (
                <Card>
                  <EmptyState
                    title="Nothing outside the flow"
                    hint="A re-shoot, a fix, a favour — anything that isn't a stage lives here."
                  />
                </Card>
              )
            )}
          </section>
        </div>
      )}

      {tab === "activity" && <ActivityList entityType="project" entityId={p.id} />}
      {tab === "money" && canSeeMoney && <LedgerTab projectId={p.id} />}
    </div>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  return (
    <span className="font-mono text-small tabular-nums text-ink-400">
      {done}/{total} stages
    </span>
  );
}

// ---------------------------------------------------------------------------
// The pipeline: vertical, phone-first, plain language. The rail down the left
// is made of the people holding each stage rather than step numbers, so the
// question the team actually asks — "who has it?" — is answered by looking.
// ---------------------------------------------------------------------------

function Pipeline({ chain, viewer }: { chain: ProjectTask[]; viewer: Viewer }) {
  const currentIdx = chain.findIndex((t) => t.status !== "done");
  return (
    <ol>
      {chain.map((task, i) => {
        const isDone = task.status === "done";
        const isCurrent = i === currentIdx;
        const isLast = i === chain.length - 1;
        const previous = chain[i - 1] ? taskLabel(chain[i - 1]!.stageName) : "the previous stage";
        const names = task.assignees.map((a) => a.name);

        return (
          <li key={task.id} className="flex gap-3 sm:gap-4">
            <RailNode
              state={isDone ? "done" : isCurrent ? "live" : "ahead"}
              names={names}
              flagged={task.flagged}
              last={isLast}
            />

            <div className={cn("min-w-0 flex-1", isLast ? "pb-0" : "pb-4")}>
              {isCurrent ? (
                <CurrentStageCard task={task} viewer={viewer} />
              ) : (
                <Link
                  to={`/tasks/${task.id}`}
                  className={cn(
                    "flex flex-wrap items-center justify-between gap-2 rounded-card border border-rule bg-surface px-4 py-3 transition-colors hover:border-ink-300",
                    !isDone && "opacity-70",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className={cn("text-base", isDone ? "text-ink-500" : "text-ink-700")}>
                      {taskLabel(task.stageName)}
                    </span>
                    {task.requiresApproval && <Lock size={12} className="text-ink-300" />}
                    {task.flagged && <Flag size={12} className="text-late" />}
                  </span>
                  <span className="text-small text-ink-400">
                    {isDone
                      ? "Done"
                      : names.length > 0
                        ? `starts after ${previous}`
                        : `unassigned · starts after ${previous}`}
                  </span>
                </Link>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function CurrentStageCard({ task, viewer }: { task: ProjectTask; viewer: Viewer }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const canAssign = can(viewer, "tasks.assign");
  const [editingPeople, setEditingPeople] = useState(false);
  const setAssignees = useMutation(
    trpc.tasks.setAssignees.mutationOptions({
      onError: (err) => toast.error(err.message),
      onSettled: () => queryClient.invalidateQueries({ queryKey: trpc.projects.pathKey() }),
    }),
  );
  const checklistDone = task.checklist?.filter((c) => c.done).length ?? 0;
  const tone = timeTone(task.deadline, undefined, { flagged: task.flagged });

  return (
    <Card edge={tone === "neutral" ? "now" : tone} className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Link to={`/tasks/${task.id}`} className="flex flex-wrap items-center gap-2">
          <span className="display text-title text-ink-900">{taskLabel(task.stageName)}</span>
          <StatusBadge status={task.status as never} />
        </Link>
        <DeadlineChip deadline={task.deadline} />
      </div>

      <ScheduleLine
        className="mt-1 block"
        startDate={task.startDate}
        deadline={task.deadline}
      />

      {task.flagged && (
        <p className="mt-3 rounded-[8px] border-l-2 border-late bg-late-tint px-3 py-2 text-small text-late-ink">
          Flagged — open the task to see what's blocking it.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {task.assignees.length > 0 ? (
            <span className="flex items-center gap-2 text-base text-ink-700">
              <AvatarStack names={task.assignees.map((a) => a.name)} />
              <span className="truncate">{task.assignees.map((a) => a.name).join(", ")}</span>
            </span>
          ) : (
            <span className="text-base text-ink-400">Nobody on this yet</span>
          )}
          {canAssign && (
            <button
              type="button"
              onClick={() => setEditingPeople((v) => !v)}
              className="inline-flex items-center gap-1 text-small font-medium text-ink-500 transition-colors hover:text-ink-900"
            >
              <UserPlus size={13} /> {editingPeople ? "Done" : "Change"}
            </button>
          )}
          {task.checklist && task.checklist.length > 0 && (
            <span className="font-mono text-small tabular-nums text-ink-400">
              {checklistDone}/{task.checklist.length}
            </span>
          )}
          {task.driveLink && (
            <a
              href={task.driveLink}
              target="_blank"
              rel="noreferrer"
              aria-label="Open in Drive"
              className="text-ink-400 transition-colors hover:text-ink-900"
            >
              <ExternalLink size={14} />
            </a>
          )}
        </div>
        <TaskActionButton
          task={{
            id: task.id,
            status: task.status as never,
            stageName: task.stageName,
            assigneeIds: task.assigneeIds,
            requiresApproval: task.requiresApproval,
            chainPosition: task.chainPosition,
          }}
          viewer={viewer}
          size="md"
        />
      </div>

      {editingPeople && canAssign && (
        <div className="mt-4 border-t border-rule-soft pt-4">
          <PeoplePicker
            selected={task.assigneeIds}
            disabled={setAssignees.isPending}
            onChange={(userIds) => setAssignees.mutate({ id: task.id, userIds })}
          />
        </div>
      )}
    </Card>
  );
}

function AdhocTaskRow({ task, viewer }: { task: ProjectTask; viewer: Viewer }) {
  const tone = timeTone(task.deadline, undefined, {
    flagged: task.flagged,
    done: task.status === "done",
  });
  return (
    <Card edge={tone === "neutral" ? "none" : tone} className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to={`/tasks/${task.id}`} className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="display text-lead text-ink-900">{taskLabel(task.stageName)}</span>
            {task.flagged ? (
              <Badge tone="late" filled>
                <Flag size={9} strokeWidth={3} /> Flagged
              </Badge>
            ) : (
              <StatusBadge status={task.status as never} />
            )}
          </div>
          <p className="mt-0.5 text-small text-ink-400">
            {task.assignees.length > 0
              ? task.assignees.map((a) => a.name).join(", ")
              : "Nobody on this yet"}
          </p>
          <ScheduleLine startDate={task.startDate} deadline={task.deadline} />
        </Link>
        <div className="flex shrink-0 items-center gap-3">
          <DeadlineChip deadline={task.deadline} muted={task.status === "done"} />
          <TaskActionButton
            task={{
              id: task.id,
              status: task.status as never,
              stageName: task.stageName,
              assigneeIds: task.assigneeIds,
              requiresApproval: task.requiresApproval,
              chainPosition: task.chainPosition,
            }}
            viewer={viewer}
          />
        </div>
      </div>
    </Card>
  );
}

/**
 * Add a task outside the flow. It is named by the stage it belongs to — there
 * is no title to invent — and carries both ends of its own schedule.
 */
function AddTaskCard({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const stages = useQuery(trpc.workflows.listStages.queryOptions());
  const [stageId, setStageId] = useState("");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState(todayISO());
  const [deadline, setDeadline] = useState("");
  const [details, setDetails] = useState("");

  const create = useMutation(
    trpc.tasks.create.mutationOptions({
      onSuccess: () => {
        toast.success("Task added");
        queryClient.invalidateQueries({ queryKey: trpc.projects.pathKey() });
        queryClient.invalidateQueries({ queryKey: trpc.tasks.pathKey() });
        onDone();
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  return (
    <Card>
      <CardBody>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({
              projectId,
              stageId: stageId || undefined,
              assigneeIds,
              startDate: startDate || undefined,
              deadline: deadline || undefined,
              details: details || undefined,
            });
          }}
        >
          <Field label="Kind of work" htmlFor="at-stage">
            <Select id="at-stage" value={stageId} onChange={(e) => setStageId(e.target.value)}>
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
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts" htmlFor="at-start">
              <Input
                id="at-start"
                type="date"
                value={startDate}
                max={deadline || undefined}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </Field>
            <Field label="Due" htmlFor="at-due">
              <Input
                id="at-due"
                type="date"
                value={deadline}
                min={startDate || undefined}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Who's on it" className="sm:col-span-2">
            <PeoplePicker selected={assigneeIds} onChange={setAssigneeIds} />
          </Field>
          <Field label="Notes (optional)" htmlFor="at-details" className="sm:col-span-2">
            <Textarea
              id="at-details"
              placeholder="Anything the team needs to know"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
            />
          </Field>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={create.isPending || !stageId}>
              {create.isPending ? "Adding…" : "Add task"}
            </Button>
            <Button type="button" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

export function ActivityList({
  entityType,
  entityId,
}: {
  entityType: "project" | "task";
  entityId: string;
}) {
  const trpc = useTRPC();
  const activity = useQuery(
    trpc.activity.forEntity.queryOptions({ entityType, entityId, limit: 50 }),
  );

  if (activity.isPending)
    return (
      <Card>
        <SkeletonRows rows={3} />
      </Card>
    );
  if (activity.isError) return <ErrorBanner message="Activity didn't load." />;
  if (activity.data.length === 0)
    return (
      <Card>
        <EmptyState
          title="Nothing has happened yet"
          hint="Every assignment, handoff and date change gets written down here."
        />
      </Card>
    );

  return (
    <Card>
      <ul className="divide-y divide-rule-soft">
        {activity.data.map((entry) => (
          <li key={entry.id} className="flex items-baseline justify-between gap-4 px-4 py-3">
            <span className="text-base text-ink-600">
              <span className="font-medium text-ink-900">{entry.actorName ?? "System"}</span>{" "}
              {describeAction(entry.action, entry.detail as Record<string, unknown> | null)}
            </span>
            <span className="shrink-0 font-mono text-small tabular-nums text-ink-300">
              {new Date(entry.createdAt).toLocaleString("en-GB", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function describeAction(action: string, detail: Record<string, unknown> | null): string {
  switch (action) {
    case "created":
      return "created this";
    case "requested":
      return "requested an expense";
    case "approved":
      return "approved the expense";
    case "rejected":
      return "rejected the expense";
    case "recurring_posted":
      return `posted a recurring expense (${detail?.name ?? ""})`;
    case "status_changed":
      return `moved ${detail?.from ?? "?"} → ${detail?.to ?? "?"}`;
    case "assignees_changed":
      return `changed who's on it (${((detail?.to as string[]) ?? []).length} assigned)`;
    case "schedule_changed": {
      const to = detail?.to as { startDate?: string | null; deadline?: string | null } | undefined;
      return `moved the dates to ${to?.startDate ?? "no start"} → ${to?.deadline ?? "no deadline"}`;
    }
    case "permissions_changed":
      return "updated the permissions";
    case "handoff":
      return `handed off (${detail?.route === "same_person" ? "the same people kept it" : detail?.route === "pre_assigned" ? "pre-assigned" : "needs assignment"})`;
    case "flagged":
      return "flagged this";
    case "unflagged":
      return "removed the flag";
    case "reverted_to_waiting":
      return "moved back to Not started (previous stage reopened)";
    case "reopen_conflict":
      return "reopen conflict — needs untangling";
    case "assignment_cleared":
      return "cleared an inactive assignee";
    case "drive_link_set":
      return "updated the Drive link";
    case "updated":
      return "edited the details";
    default:
      return action.replaceAll("_", " ");
  }
}

/** Budget spend, used by the ledger + money screens. */
export function BudgetBar({ spent, budget }: { spent: number; budget: number | null }) {
  if (!budget || budget <= 0) return null;
  const pct = Math.min(100, Math.round((spent / budget) * 100));
  const over = spent > budget;
  return (
    <div className="w-full">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
        <div
          className={cn(
            "h-full rounded-full",
            over ? "bg-late" : pct > 80 ? "bg-now" : "bg-ink-700",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p
        className={cn(
          "mt-1.5 font-mono text-small tabular-nums",
          over ? "font-medium text-late" : "text-ink-400",
        )}
      >
        {pct}% of budget{over ? " — over" : ""}
      </p>
    </div>
  );
}
