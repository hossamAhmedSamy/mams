import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Flag, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorBanner, SkeletonRows } from "@/components/ui/feedback";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { AvatarStack, PageHeader } from "@/components/ui/page";
import { TaskActionButton } from "@/components/task-action";
import { DeadlineChip, StatusBadge } from "@/components/task-bits";
import { useTRPC } from "@/lib/trpc";
import { useMe } from "./app-layout";
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
    return <ErrorBanner message="Couldn't load this task." onRetry={() => task.refetch()} />;

  const t = task.data;
  const isAdmin = me.data?.role === "admin";

  return (
    <div className="space-y-6">
      <PageHeader
        backTo={`/projects/${t.projectId}`}
        backLabel={t.projectTitle}
        title={t.title}
        subtitle={`${t.projectTitle} · ${t.clientName}${t.stageName ? ` · ${t.stageName}` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={t.status as never} />
            <DeadlineChip deadline={t.deadline} />
            <TaskActionButton
              task={{
                id: t.id,
                title: t.title,
                status: t.status as never,
                assigneeId: t.assigneeId,
                requiresApproval: t.requiresApproval,
                chainPosition: t.chainPosition,
              }}
              viewer={me.data!}
              size="md"
            />
            {isAdmin && t.status === "awaiting_approval" && (
              <Button
                variant="secondary"
                disabled={transition.isPending}
                onClick={() => transition.mutate({ id: t.id, to: "in_progress" })}
              >
                Request changes
              </Button>
            )}
            {isAdmin && t.status === "done" && (
              <Button
                variant="secondary"
                disabled={transition.isPending}
                onClick={() =>
                  transition.mutate(
                    { id: t.id, to: "in_progress" },
                    { onSuccess: () => toast.info("Reopened — the next stage was adjusted if needed.") },
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
        <div className="flex items-start gap-2 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3">
          <Flag size={16} className="mt-0.5 shrink-0 text-orange-600" />
          <div>
            <p className="text-sm font-medium text-orange-800">Needs attention</p>
            {t.flagNote && <p className="text-sm text-orange-700">{t.flagNote}</p>}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {t.details && (
            <Card>
              <CardHeader>
                <CardTitle>Details</CardTitle>
              </CardHeader>
              <CardBody>
                <p className="whitespace-pre-wrap text-sm text-gray-700">{t.details}</p>
              </CardBody>
            </Card>
          )}
          <ChecklistCard task={t} canEdit={isAdmin || t.assigneeId === me.data!.id} />
          <CommentsCard taskId={t.id} />
        </div>

        <div className="space-y-6">
          {isAdmin && (
            <AdminControls
              task={{ ...t, helperIds: t.helpers.map((h) => h.id) }}
              onChanged={invalidate}
            />
          )}
          <Card>
            <CardHeader>
              <CardTitle>Info</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2 text-sm">
              <InfoRow label="Owner" value={t.assigneeName ?? "Unassigned"} />
              {t.helpers.length > 0 && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-gray-500">Helpers</span>
                  <AvatarStack names={t.helpers.map((h) => h.name)} />
                </div>
              )}
              <InfoRow label="Stage" value={t.stageName ?? "Ad-hoc"} />
              <InfoRow label="Start" value={t.startDate ?? "—"} />
              <InfoRow label="Deadline" value={t.deadline ?? "—"} />
              {t.driveLink && (
                <a
                  href={t.driveLink}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-accent-600 hover:underline"
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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-800">{value}</span>
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Checklist{" "}
          {items.length > 0 && (
            <span className="font-normal text-gray-400">
              {items.filter((i) => i.done).length}/{items.length}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-2">
        {items.map((item, idx) => (
          <label key={idx} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={item.done}
              disabled={!canEdit || save.isPending}
              onChange={(e) => {
                const next = items.map((it, i) => (i === idx ? { ...it, done: e.target.checked } : it));
                save.mutate({ id: task.id, checklist: next });
              }}
              className="size-4 accent-accent-600"
            />
            <span className={item.done ? "text-gray-400 line-through" : "text-gray-700"}>
              {item.text}
            </span>
          </label>
        ))}
        {canEdit && (
          <form
            className="flex gap-2 pt-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newItem.trim()) return;
              save.mutate({ id: task.id, checklist: [...items, { text: newItem.trim(), done: false }] });
              setNewItem("");
            }}
          >
            <Input
              placeholder="Add item (e.g. reel 4)"
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
      <CardBody className="space-y-3">
        {comments.isPending ? (
          <SkeletonRows rows={2} />
        ) : comments.isError ? (
          <ErrorBanner message="Couldn't load comments." />
        ) : comments.data.length === 0 ? (
          <EmptyState title="No comments yet" />
        ) : (
          <ul className="space-y-3">
            {comments.data.map((c) => (
              <li key={c.id} className="rounded-lg bg-gray-50 px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-gray-800">{c.authorName}</span>
                  <span className="text-xs text-gray-400">
                    {new Date(c.createdAt).toLocaleString("en-GB", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-gray-700">{c.body}</p>
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
              Comment
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function AdminControls({
  task,
  onChanged,
}: {
  task: {
    id: string;
    assigneeId: string | null;
    helperIds: string[];
    deadline: string | null;
    flagged: boolean;
    driveLink: string | null;
  };
  onChanged: () => void;
}) {
  const trpc = useTRPC();
  const users = useQuery(trpc.users.list.queryOptions());
  const [flagNote, setFlagNote] = useState("");
  const [drive, setDrive] = useState(task.driveLink ?? "");

  const assign = useMutation(trpc.tasks.assign.mutationOptions({ onSettled: onChanged }));
  const setHelpers = useMutation(trpc.tasks.setHelpers.mutationOptions({ onSettled: onChanged }));
  const setDeadline = useMutation(trpc.tasks.setDeadline.mutationOptions({ onSettled: onChanged }));
  const flag = useMutation(trpc.tasks.flag.mutationOptions({ onSettled: onChanged }));
  const unflag = useMutation(trpc.tasks.unflag.mutationOptions({ onSettled: onChanged }));
  const setDriveLink = useMutation(trpc.tasks.setDriveLink.mutationOptions({ onSettled: onChanged }));

  const activeUsers = users.data?.filter((u) => u.active) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Manage</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <div>
          <Label htmlFor="t-assignee">Owner (accountable)</Label>
          <Select
            id="t-assignee"
            value={task.assigneeId ?? ""}
            disabled={assign.isPending}
            onChange={(e) => assign.mutate({ id: task.id, assigneeId: e.target.value || null })}
          >
            <option value="">Unassigned</option>
            {activeUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Helpers (also work on this)</Label>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {activeUsers
              .filter((u) => u.id !== task.assigneeId)
              .map((u) => {
                const on = task.helperIds.includes(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    disabled={setHelpers.isPending}
                    onClick={() =>
                      setHelpers.mutate({
                        id: task.id,
                        userIds: on
                          ? task.helperIds.filter((x) => x !== u.id)
                          : [...task.helperIds, u.id],
                      })
                    }
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      on
                        ? "border-accent-600 bg-accent-50 text-accent-700"
                        : "border-gray-300 bg-white text-gray-500 hover:bg-gray-50"
                    }`}
                  >
                    {u.name}
                  </button>
                );
              })}
          </div>
        </div>
        <div>
          <Label htmlFor="t-deadline">Deadline</Label>
          <Input
            id="t-deadline"
            type="date"
            defaultValue={task.deadline ?? ""}
            disabled={setDeadline.isPending}
            onChange={(e) => setDeadline.mutate({ id: task.id, deadline: e.target.value || null })}
          />
        </div>
        <div>
          <Label htmlFor="t-drive">Drive link</Label>
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
        </div>
        <div className="border-t border-gray-100 pt-3">
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
                placeholder="Flag note (optional)"
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
      </CardBody>
    </Card>
  );
}
