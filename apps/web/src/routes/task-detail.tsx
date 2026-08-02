import { can, taskLabel } from "@mams/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Flag, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorBanner, SkeletonRows } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/input";
import { AvatarStack, PageHeader } from "@/components/ui/page";
import { PeoplePicker } from "@/components/people-picker";
import { TaskActionButton } from "@/components/task-action";
import { DeadlineChip, StatusBadge } from "@/components/task-bits";
import { formatShort } from "@/lib/dates";
import { useMe, type Viewer } from "@/lib/session";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { ActivityList } from "./project-detail";

export function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const trpc = useTRPC();
  const me = useMe();
  const queryClient = useQueryClient();
  const task = useQuery(trpc.tasks.get.queryOptions({ id: id! }));

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: trpc.tasks.pathKey() });
    queryClient.invalidateQueries({ queryKey: trpc.projects.pathKey() });
  };
  const transition = useMutation(trpc.tasks.transition.mutationOptions({ onSettled: invalidate }));

  if (task.isPending)
    return (
      <Card>
        <SkeletonRows rows={6} />
      </Card>
    );
  if (task.isError)
    return <ErrorBanner message="This task didn't load." onRetry={() => task.refetch()} />;

  const t = task.data;
  const viewer = me.data as Viewer;
  const label = taskLabel(t.stageName);
  const canManage = can(viewer, "tasks.manage");
  const canAssign = can(viewer, "tasks.assign");
  const canApprove = can(viewer, "tasks.approve");
  const onTask = t.assigneeIds.includes(viewer.id);

  return (
    <div className="settle">
      <PageHeader
        backTo={`/projects/${t.projectId}`}
        backLabel={t.projectTitle}
        eyebrow={`${t.projectTitle} · ${t.clientName}`}
        title={label}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={t.status as never} />
            {/* a finished task's deadline is history — it must not still read as late */}
            <DeadlineChip deadline={t.deadline} muted={t.status === "done"} />
            <TaskActionButton
              task={{
                id: t.id,
                status: t.status as never,
                stageName: t.stageName,
                assigneeIds: t.assigneeIds,
                requiresApproval: t.requiresApproval,
                chainPosition: t.chainPosition,
              }}
              viewer={viewer}
              size="md"
            />
            {canApprove && t.status === "awaiting_approval" && (
              <Button
                variant="secondary"
                disabled={transition.isPending}
                onClick={() => transition.mutate({ id: t.id, to: "in_progress" })}
              >
                Request changes
              </Button>
            )}
            {canApprove && t.status === "done" && (
              <Button
                variant="secondary"
                disabled={transition.isPending}
                onClick={() =>
                  transition.mutate(
                    { id: t.id, to: "in_progress" },
                    {
                      onSuccess: () =>
                        toast.info("Reopened — the next stage was adjusted if needed."),
                    },
                  )
                }
              >
                <RotateCcw size={14} /> Reopen
              </Button>
            )}
          </div>
        }
      />

      {t.flagged && (
        <div className="mb-6 flex items-start gap-3 rounded-card border border-late/25 border-l-[3px] border-l-late bg-late-tint px-4 py-3.5">
          <Flag size={15} className="mt-0.5 shrink-0 text-late" />
          <div>
            <p className="eyebrow text-late">Needs attention</p>
            {t.flagNote && <p className="mt-1 text-base text-late-ink">{t.flagNote}</p>}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3 lg:gap-8">
        <div className="space-y-6 lg:col-span-2">
          {t.details && (
            <Card>
              <CardHeader>
                <CardTitle>Details</CardTitle>
              </CardHeader>
              <CardBody>
                <p className="whitespace-pre-wrap text-base leading-relaxed text-ink-700">
                  {t.details}
                </p>
              </CardBody>
            </Card>
          )}
          <ChecklistCard task={t} canEdit={canManage || onTask} />
          <CommentsCard taskId={t.id} />
        </div>

        <div className="space-y-6">
          {(canManage || canAssign) && (
            <ManageCard task={t} canManage={canManage} canAssign={canAssign} onChanged={invalidate} />
          )}
          <Card>
            <CardHeader>
              <CardTitle>At a glance</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className="eyebrow text-ink-400">On this task</span>
                {t.assignees.length > 0 ? (
                  <AvatarStack names={t.assignees.map((a) => a.name)} />
                ) : (
                  <span className="text-base text-ink-400">Nobody yet</span>
                )}
              </div>
              {t.assignees.length > 0 && (
                <p className="text-right text-small text-ink-500">
                  {t.assignees.map((a) => a.name).join(", ")}
                </p>
              )}
              <InfoRow label="Stage" value={t.stageName ?? "No stage"} />
              <InfoRow label="Starts" value={t.startDate ? formatShort(t.startDate) : "——"} mono />
              <InfoRow label="Due" value={t.deadline ? formatShort(t.deadline) : "——"} mono />
              {t.driveLink && (
                <a
                  href={t.driveLink}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-small font-medium text-ink-600 transition-colors hover:text-ink-950"
                >
                  Open in Drive <ExternalLink size={13} />
                </a>
              )}
            </CardBody>
          </Card>
          <ActivityList entityType="task" entityId={t.id} />
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-rule-soft pt-3">
      <span className="eyebrow text-ink-400">{label}</span>
      <span className={cn("text-base text-ink-800", mono && "font-mono text-small tabular-nums")}>
        {value}
      </span>
    </div>
  );
}

function ChecklistCard({
  task,
  canEdit,
}: {
  task: { id: string; checklist: { text: string; done: boolean }[] | null };
  canEdit: boolean;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [newItem, setNewItem] = useState("");
  const items = task.checklist ?? [];
  const save = useMutation(
    trpc.tasks.updateChecklist.mutationOptions({
      onSettled: () => queryClient.invalidateQueries({ queryKey: trpc.tasks.pathKey() }),
    }),
  );

  if (items.length === 0 && !canEdit) return null;
  const doneCount = items.filter((i) => i.done).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Checklist</CardTitle>
        {items.length > 0 && (
          <span className="ml-auto font-mono text-small tabular-nums text-ink-400">
            {doneCount}/{items.length}
          </span>
        )}
      </CardHeader>
      <CardBody className="space-y-1">
        {items.map((item, idx) => (
          <label
            key={idx}
            className="flex cursor-pointer items-center gap-2.5 rounded-[8px] px-1 py-1.5 transition-colors hover:bg-ink-50"
          >
            <input
              type="checkbox"
              checked={item.done}
              disabled={!canEdit || save.isPending}
              onChange={(e) => {
                const next = items.map((it, i) =>
                  i === idx ? { ...it, done: e.target.checked } : it,
                );
                save.mutate({ id: task.id, checklist: next });
              }}
              className="size-4.5 shrink-0 rounded-[5px] border-rule accent-ink-900"
            />
            <span
              className={cn("text-base", item.done ? "text-ink-300 line-through" : "text-ink-700")}
            >
              {item.text}
            </span>
          </label>
        ))}
        {canEdit && (
          <form
            className="flex gap-2 pt-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newItem.trim()) return;
              save.mutate({
                id: task.id,
                checklist: [...items, { text: newItem.trim(), done: false }],
              });
              setNewItem("");
            }}
          >
            <Input
              placeholder="Add an item — “reel 4”"
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
            />
            <Button type="submit" variant="secondary" size="md" disabled={save.isPending}>
              Add
            </Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

function CommentsCard({ taskId }: { taskId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const comments = useQuery(trpc.comments.listByTask.queryOptions({ taskId }));
  const [body, setBody] = useState("");
  const create = useMutation(
    trpc.comments.create.mutationOptions({
      onSuccess: () => {
        setBody("");
        queryClient.invalidateQueries({ queryKey: trpc.comments.pathKey() });
      },
    }),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Comments</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        {comments.isPending ? (
          <SkeletonRows rows={2} />
        ) : comments.isError ? (
          <ErrorBanner message="Comments didn't load." />
        ) : comments.data.length === 0 ? (
          <EmptyState
            className="py-6"
            title="No comments yet"
            hint="Anything the next person needs to know goes here."
          />
        ) : (
          <ul className="space-y-3">
            {comments.data.map((c) => (
              <li key={c.id} className="rounded-card border border-rule-soft bg-paper/60 px-3.5 py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-base font-medium text-ink-900">{c.authorName}</span>
                  <span className="font-mono text-small tabular-nums text-ink-300">
                    {new Date(c.createdAt).toLocaleString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-base text-ink-700">{c.body}</p>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!body.trim()) return;
            create.mutate({ taskId, body: body.trim() });
          }}
        >
          <Textarea
            placeholder="Write a comment…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div>
            <Button type="submit" size="sm" disabled={create.isPending || !body.trim()}>
              Post comment
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function ManageCard({
  task,
  canManage,
  canAssign,
  onChanged,
}: {
  task: {
    id: string;
    assigneeIds: string[];
    startDate: string | null;
    deadline: string | null;
    flagged: boolean;
    driveLink: string | null;
  };
  canManage: boolean;
  canAssign: boolean;
  onChanged: () => void;
}) {
  const trpc = useTRPC();
  const [flagNote, setFlagNote] = useState("");
  const [drive, setDrive] = useState(task.driveLink ?? "");

  const onError = (err: { message: string }) => toast.error(err.message);
  const setAssignees = useMutation(
    trpc.tasks.setAssignees.mutationOptions({ onSettled: onChanged, onError }),
  );
  const setSchedule = useMutation(
    trpc.tasks.setSchedule.mutationOptions({ onSettled: onChanged, onError }),
  );
  const flag = useMutation(trpc.tasks.flag.mutationOptions({ onSettled: onChanged, onError }));
  const unflag = useMutation(trpc.tasks.unflag.mutationOptions({ onSettled: onChanged, onError }));
  const setDriveLink = useMutation(
    trpc.tasks.setDriveLink.mutationOptions({ onSettled: onChanged, onError }),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Manage</CardTitle>
      </CardHeader>
      <CardBody className="space-y-5">
        {canAssign && (
          <Field label="People on this task">
            <PeoplePicker
              selected={task.assigneeIds}
              disabled={setAssignees.isPending}
              onChange={(userIds) => setAssignees.mutate({ id: task.id, userIds })}
            />
          </Field>
        )}
        {canManage && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Starts" htmlFor="t-start">
                <Input
                  id="t-start"
                  type="date"
                  defaultValue={task.startDate ?? ""}
                  max={task.deadline ?? undefined}
                  disabled={setSchedule.isPending}
                  onChange={(e) =>
                    setSchedule.mutate({ id: task.id, startDate: e.target.value || null })
                  }
                />
              </Field>
              <Field label="Due" htmlFor="t-deadline">
                <Input
                  id="t-deadline"
                  type="date"
                  defaultValue={task.deadline ?? ""}
                  min={task.startDate ?? undefined}
                  disabled={setSchedule.isPending}
                  onChange={(e) =>
                    setSchedule.mutate({ id: task.id, deadline: e.target.value || null })
                  }
                />
              </Field>
            </div>
            <Field label="Drive link" htmlFor="t-drive">
              <div className="flex gap-2">
                <Input
                  id="t-drive"
                  type="url"
                  placeholder="https://drive.google.com/…"
                  value={drive}
                  onChange={(e) => setDrive(e.target.value)}
                />
                <Button
                  variant="secondary"
                  size="md"
                  disabled={setDriveLink.isPending}
                  onClick={() => setDriveLink.mutate({ id: task.id, driveLink: drive || null })}
                >
                  Save
                </Button>
              </div>
            </Field>
            <div className="border-t border-rule-soft pt-4">
              {task.flagged ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={unflag.isPending}
                  onClick={() => unflag.mutate({ id: task.id })}
                >
                  Remove flag
                </Button>
              ) : (
                <div className="space-y-2">
                  <Input
                    placeholder="What's blocking it? (optional)"
                    value={flagNote}
                    onChange={(e) => setFlagNote(e.target.value)}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={flag.isPending}
                    onClick={() => flag.mutate({ id: task.id, note: flagNote || undefined })}
                  >
                    <Flag size={14} /> Flag for attention
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
