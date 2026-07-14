import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState, ErrorBanner, SkeletonRows } from "@/components/ui/feedback";
import { Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page";
import { TaskActionButton } from "@/components/task-action";
import { DeadlineChip, PriorityDot, StatusBadge } from "@/components/task-bits";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useMe } from "./app-layout";

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const trpc = useTRPC();
  const me = useMe();
  const queryClient = useQueryClient();
  const project = useQuery(trpc.projects.get.queryOptions({ id: id! }));
  const [tab, setTab] = useState<"tasks" | "activity">("tasks");

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
  const isAdmin = me.data?.role === "admin";
  const chain = p.tasks.filter((t) => t.chainPosition !== null);
  const adhoc = p.tasks.filter((t) => t.chainPosition === null);

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
              {isAdmin ? (
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

      {chain.length > 0 && <ChainStepper chain={chain} isAdmin={isAdmin ?? false} />}

      <div className="flex gap-1 border-b border-gray-200">
        {(["tasks", "activity"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "border-b-2 px-4 py-2 text-sm font-medium capitalize",
              tab === t
                ? "border-accent-600 text-accent-700"
                : "border-transparent text-gray-500 hover:text-gray-700",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "tasks" ? (
        <div className="space-y-2">
          {p.tasks.length === 0 && (
            <Card>
              <EmptyState title="No tasks" hint="This project has no workflow or tasks yet." />
            </Card>
          )}
          {[...chain, ...adhoc].map((task) => (
            <TaskRow key={task.id} task={task} viewer={me.data!} />
          ))}
        </div>
      ) : (
        <ActivityList entityType="project" entityId={p.id} />
      )}
    </div>
  );
}

function ChainStepper({
  chain,
  isAdmin,
}: {
  chain: {
    id: string;
    title: string;
    status: string;
    stageName: string | null;
    assigneeId: string | null;
    assigneeName: string | null;
    deadline: string | null;
  }[];
  isAdmin: boolean;
}) {
  return (
    <Card>
      <CardBody className="overflow-x-auto">
        <ol className="flex min-w-max items-start gap-0">
          {chain.map((task, i) => (
            <li key={task.id} className="flex items-start">
              {i > 0 && <div className="mx-2 mt-4 h-px w-8 bg-gray-200" />}
              <StepperNode task={task} isAdmin={isAdmin} />
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}

function StepperNode({
  task,
  isAdmin,
}: {
  task: {
    id: string;
    title: string;
    status: string;
    assigneeId: string | null;
    assigneeName: string | null;
    deadline: string | null;
  };
  isAdmin: boolean;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const users = useQuery({ ...trpc.users.list.queryOptions(), enabled: isAdmin });
  const assign = useMutation(
    trpc.tasks.assign.mutationOptions({
      onSettled: () => queryClient.invalidateQueries({ queryKey: trpc.projects.pathKey() }),
    }),
  );

  const done = task.status === "done";
  const active = task.status === "todo" || task.status === "in_progress" || task.status === "awaiting_approval";

  return (
    <div className="flex w-32 flex-col items-center text-center">
      <Link
        to={`/tasks/${task.id}`}
        className={cn(
          "flex size-8 items-center justify-center rounded-full border-2 text-xs font-semibold",
          done
            ? "border-status-done bg-status-done text-white"
            : active
              ? "border-accent-600 bg-accent-50 text-accent-700"
              : "border-gray-300 bg-white text-gray-400",
        )}
      >
        {done ? <Check size={15} /> : ""}
      </Link>
      <Link to={`/tasks/${task.id}`} className="mt-1 text-xs font-medium text-gray-800">
        {task.title}
      </Link>
      {active && task.deadline && (
        <div className="mt-0.5">
          <DeadlineChip deadline={task.deadline} />
        </div>
      )}
      {/* waiting-stage pre-assignment: this dropdown IS the pre-assignment UI */}
      {isAdmin && !done ? (
        <Select
          className="mt-1 h-7 w-full text-xs"
          value={task.assigneeId ?? ""}
          disabled={assign.isPending}
          onChange={(e) => assign.mutate({ id: task.id, assigneeId: e.target.value || null })}
        >
          <option value="">Unassigned</option>
          {users.data
            ?.filter((u) => u.active)
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
        </Select>
      ) : (
        <span className="mt-0.5 text-xs text-gray-500">{task.assigneeName ?? "—"}</span>
      )}
    </div>
  );
}

function TaskRow({
  task,
  viewer,
}: {
  task: {
    id: string;
    title: string;
    status: string;
    chainPosition: number | null;
    deadline: string | null;
    flagged: boolean;
    requiresApproval: boolean;
    assigneeId: string | null;
    assigneeName: string | null;
    stageName: string | null;
  };
  viewer: { id: string; role: "admin" | "member" };
}) {
  return (
    <Card className={task.flagged ? "border-orange-300" : ""}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link to={`/tasks/${task.id}`} className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {task.chainPosition !== null && (
              <span className="text-xs font-semibold text-gray-400">#{task.chainPosition}</span>
            )}
            <span className="font-medium text-gray-900">{task.title}</span>
            <StatusBadge status={task.status as never} />
            {task.flagged && <Badge tone="orange">Flagged</Badge>}
          </div>
          <p className="mt-0.5 text-sm text-gray-500">
            {task.assigneeName ?? "Unassigned"}
          </p>
        </Link>
        <div className="flex shrink-0 items-center gap-3">
          <DeadlineChip deadline={task.deadline} />
          <TaskActionButton
            task={{
              id: task.id,
              title: task.title,
              status: task.status as never,
              assigneeId: task.assigneeId,
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
    case "status_changed":
      return `moved ${detail?.from ?? "?"} → ${detail?.to ?? "?"}`;
    case "assigned":
      return "changed the assignee";
    case "deadline_changed":
      return `set the deadline to ${detail?.to ?? "none"}`;
    case "handoff":
      return `handed off (${detail?.route ?? "?"})`;
    case "flagged":
      return "flagged this";
    case "unflagged":
      return "removed the flag";
    case "reverted_to_waiting":
      return "reverted to waiting (predecessor reopened)";
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
