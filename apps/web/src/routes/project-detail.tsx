import { can, taskLabel } from "@mams/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, Flag, Lock, Plus, UserPlus } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState, ErrorBanner, SkeletonRows } from "@/components/ui/feedback";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { AvatarStack, PageHeader } from "@/components/ui/page";
import { PeoplePicker } from "@/components/people-picker";
import { TaskActionButton } from "@/components/task-action";
import { DeadlineChip, PriorityDot, ScheduleLine, StatusBadge, type Viewer } from "@/components/task-bits";
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
    return <ErrorBanner message="Couldn't load this project." onRetry={() => project.refetch()} />;

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
    <div className="space-y-6">
      <div>
        <PageHeader
          backTo="/board"
          backLabel="Projects"
          title={p.title}
          subtitle={`${p.clientName}${p.campaign ? ` · ${p.campaign}` : ""}`}
          actions={
            <div className="flex items-center gap-3">
              <PriorityDot priority={p.priority as "high" | "medium" | "low"} />
              {p.driveLink && (
                <a
                  href={p.driveLink}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-accent-600 hover:underline"
                >
                  Drive <ExternalLink size={13} />
                </a>
              )}
              {canManageProject ? (
                <Select
                  className="w-36"
                  value={p.status}
                  onChange={(e) => setStatus.mutate({ id: p.id, status: e.target.value as never })}
                >
                  <option value="active">Active</option>
                  <option value="on_hold">On hold</option>
                  <option value="completed">Completed</option>
                  <option value="archived">Archived</option>
                </Select>
              ) : (
                <Badge tone={p.status === "completed" ? "green" : "accent"}>{p.status}</Badge>
              )}
            </div>
          }
        />
        {p.notes && <p className="-mt-3 max-w-2xl text-sm text-gray-600">{p.notes}</p>}
      </div>

      <div className="flex gap-1 border-b border-hairline">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "border-b-2 px-4 py-2.5 text-sm font-medium",
              tab === t.key
                ? "border-accent-600 text-accent-700"
                : "border-transparent text-gray-500 hover:text-gray-700",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "work" && (
        <div className="space-y-8">
          {chain.length > 0 ? (
            <section>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold text-gray-700">The flow</h2>
                <span className="text-xs text-gray-400">
                  {doneCount}/{chain.length} stages done
                </span>
              </div>
              <Pipeline chain={chain} viewer={viewer} />
            </section>
          ) : (
            <Card>
              <EmptyState
                title="No flow on this project"
                hint="Tasks are added by hand — see below."
              />
            </Card>
          )}

          <section>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-gray-700">Extra tasks</h2>
              {canManageTasks && (
                <Button variant="secondary" size="sm" onClick={() => setAdding((v) => !v)}>
                  <Plus size={14} /> Add task
                </Button>
              )}
            </div>
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
                    title="No extra tasks"
                    hint="Anything outside the flow — a re-shoot, a fix — goes here."
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

// ---------------------------------------------------------------------------
// The pipeline: vertical, phone-first, plain language. The current stage is
// the big card; done stages collapse; future stages explain when they start.
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
        return (
          <li key={task.id} className="relative flex gap-3 sm:gap-4">
            {/* rail */}
            <div className="flex w-8 flex-col items-center">
              <span
                className={cn(
                  "z-10 flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold",
                  isDone
                    ? "border-status-done bg-status-done text-white"
                    : isCurrent
                      ? "border-accent-600 bg-white text-accent-700 ring-4 ring-accent-100"
                      : "border-gray-200 bg-white text-gray-300",
                )}
              >
                {isDone ? <Check size={15} strokeWidth={3} /> : i + 1}
              </span>
              {!isLast && (
                <span
                  className={cn("w-0.5 flex-1", isDone ? "bg-status-done/40" : "bg-gray-200")}
                />
              )}
            </div>

            {/* card */}
            <div className={cn("min-w-0 flex-1", isLast ? "pb-0" : "pb-3")}>
              {isCurrent ? (
                <CurrentStageCard task={task} viewer={viewer} />
              ) : (
                <Link
                  to={`/tasks/${task.id}`}
                  className={cn(
                    "flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-white px-4 py-3 transition-colors hover:border-gray-300",
                    isDone ? "border-hairline" : "border-hairline opacity-70",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className={cn("font-medium", isDone ? "text-gray-500" : "text-gray-600")}>
                      {taskLabel(task.stageName)}
                    </span>
                    {task.requiresApproval && <Lock size={12} className="text-amber-500" />}
                    {task.flagged && <Flag size={12} className="text-status-flagged" />}
                  </div>
                  <span className="flex items-center gap-2 text-xs text-gray-400">
                    {task.assignees.length > 0 && (
                      <AvatarStack names={task.assignees.map((a) => a.name)} />
                    )}
                    {isDone
                      ? "Done"
                      : task.assignees.length > 0
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

  return (
    <div
      className={cn(
        "rounded-xl border-2 bg-white p-4 shadow-card",
        task.flagged ? "border-orange-300" : "border-accent-200",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to={`/tasks/${task.id}`} className="flex items-center gap-2">
          <span className="text-base font-semibold text-gray-900">{taskLabel(task.stageName)}</span>
          <StatusBadge status={task.status as never} />
        </Link>
        <DeadlineChip deadline={task.deadline} />
      </div>

      <div className="mt-1">
        <ScheduleLine startDate={task.startDate} deadline={task.deadline} />
      </div>

      {task.flagged && (
        <p className="mt-2 rounded-lg bg-orange-50 px-3 py-1.5 text-xs text-orange-700">
          ⚑ Needs attention — check the task page
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {task.assignees.length > 0 ? (
            <span className="flex items-center gap-2 text-sm text-gray-700">
              <AvatarStack names={task.assignees.map((a) => a.name)} />
              <span className="truncate">{task.assignees.map((a) => a.name).join(", ")}</span>
            </span>
          ) : (
            <span className="text-sm text-gray-400">Nobody assigned yet</span>
          )}
          {canAssign && (
            <button
              type="button"
              onClick={() => setEditingPeople((v) => !v)}
              className="inline-flex items-center gap-1 text-xs font-medium text-accent-600 hover:text-accent-700"
            >
              <UserPlus size={13} /> {editingPeople ? "Done" : "Change"}
            </button>
          )}
          {task.checklist && task.checklist.length > 0 && (
            <span className="text-xs text-gray-400">
              ☑ {checklistDone}/{task.checklist.length}
            </span>
          )}
          {task.driveLink && (
            <a href={task.driveLink} target="_blank" rel="noreferrer" className="text-accent-600">
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
        <div className="mt-3 border-t border-hairline pt-3">
          <PeoplePicker
            selected={task.assigneeIds}
            disabled={setAssignees.isPending}
            onChange={(userIds) => setAssignees.mutate({ id: task.id, userIds })}
          />
        </div>
      )}
    </div>
  );
}

function AdhocTaskRow({ task, viewer }: { task: ProjectTask; viewer: Viewer }) {
  return (
    <Card className={cn("px-4 py-3", task.flagged && "border-orange-300")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to={`/tasks/${task.id}`} className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-gray-900">{taskLabel(task.stageName)}</span>
            <StatusBadge status={task.status as never} />
            {task.flagged && <Badge tone="orange">Flagged</Badge>}
          </div>
          <p className="mt-0.5 text-sm text-gray-500">
            {task.assignees.length > 0
              ? task.assignees.map((a) => a.name).join(", ")
              : "Nobody assigned"}
          </p>
          <ScheduleLine startDate={task.startDate} deadline={task.deadline} />
        </Link>
        <div className="flex shrink-0 items-center gap-3">
          <DeadlineChip deadline={task.deadline} />
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
          <div>
            <Label htmlFor="at-stage">Kind of work</Label>
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
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="at-start">Start date</Label>
              <Input
                id="at-start"
                type="date"
                value={startDate}
                max={deadline || undefined}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="at-due">Deadline</Label>
              <Input
                id="at-due"
                type="date"
                value={deadline}
                min={startDate || undefined}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </div>
          </div>
          <div className="sm:col-span-2">
            <Label>Who's on it</Label>
            <PeoplePicker selected={assigneeIds} onChange={setAssigneeIds} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="at-details">Notes (optional)</Label>
            <Textarea
              id="at-details"
              placeholder="Anything the team needs to know"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
            />
          </div>
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
  const activity = useQuery(trpc.activity.forEntity.queryOptions({ entityType, entityId, limit: 50 }));

  if (activity.isPending)
    return (
      <Card>
        <SkeletonRows rows={3} />
      </Card>
    );
  if (activity.isError) return <ErrorBanner message="Couldn't load activity." />;
  if (activity.data.length === 0)
    return (
      <Card>
        <EmptyState title="No activity yet" />
      </Card>
    );

  return (
    <Card>
      <ul className="divide-y divide-gray-50">
        {activity.data.map((entry) => (
          <li key={entry.id} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
            <span className="text-sm text-gray-700">
              <span className="font-medium">{entry.actorName ?? "System"}</span>{" "}
              {describeAction(entry.action, entry.detail as Record<string, unknown> | null)}
            </span>
            <span className="shrink-0 text-xs text-gray-400">
              {new Date(entry.createdAt).toLocaleString("en-GB", {
                day: "numeric",
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

/** Progress bar used by ledger + money screens. */
export function BudgetBar({ spent, budget }: { spent: number; budget: number | null }) {
  if (!budget || budget <= 0) return null;
  const pct = Math.min(100, Math.round((spent / budget) * 100));
  const over = spent > budget;
  return (
    <div className="w-full">
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className={cn("h-full rounded-full", over ? "bg-status-overdue" : pct > 80 ? "bg-status-due-soon" : "bg-status-done")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className={cn("mt-1 text-xs", over ? "font-medium text-status-overdue" : "text-gray-400")}>
        {pct}% of budget{over ? " — over!" : ""}
      </p>
    </div>
  );
}
