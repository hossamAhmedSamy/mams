import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { nextAction } from "@/components/task-bits";
import { formatShort } from "@/lib/dates";
import { useTRPC } from "@/lib/trpc";

type ActionTask = {
  id: string;
  title: string;
  status: "waiting" | "todo" | "in_progress" | "awaiting_approval" | "done";
  assigneeId: string | null;
  requiresApproval: boolean;
  chainPosition?: number | null;
};

/**
 * The one primary action button (PLAN.md §8.1). Completing a chain task opens
 * the handoff dialog: "this finishes X — here's where it goes next", with the
 * admin able to change who/when right there.
 */
export function TaskActionButton({
  task,
  viewer,
  size = "sm",
}: {
  task: ActionTask;
  viewer: { id: string; role: "admin" | "member" };
  size?: "sm" | "md";
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: trpc.tasks.pathKey() });
    queryClient.invalidateQueries({ queryKey: trpc.projects.pathKey() });
  };
  const transition = useMutation(
    trpc.tasks.transition.mutationOptions({
      onSuccess: (_, vars) => {
        if (vars.to !== "done") return;
      },
      onError: (err) => toast.error(err.message || "That didn't work — try again."),
      onSettled: invalidate,
    }),
  );

  const action = nextAction(task, viewer);
  if (!action) return null;

  const isChainCompletion =
    action.to === "done" && task.chainPosition !== null && task.chainPosition !== undefined;

  async function run() {
    if (isChainCompletion) {
      setConfirming(true);
      return;
    }
    await transition.mutateAsync({ id: task.id, to: action!.to });
    toast.success(
      action!.to === "in_progress" && task.status === "todo"
        ? `Started "${task.title}"`
        : action!.to === "done"
          ? `"${task.title}" completed ✓`
          : "Done",
    );
  }

  return (
    <>
      <Button size={size} disabled={transition.isPending} onClick={run}>
        {action.label}
      </Button>
      {confirming && (
        <CompleteDialog
          task={task}
          viewer={viewer}
          onClose={() => setConfirming(false)}
          onDone={invalidate}
        />
      )}
    </>
  );
}

function CompleteDialog({
  task,
  viewer,
  onClose,
  onDone,
}: {
  task: ActionTask;
  viewer: { id: string; role: "admin" | "member" };
  onClose: () => void;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const isAdmin = viewer.role === "admin";
  const preview = useQuery(trpc.tasks.handoffPreview.queryOptions({ id: task.id }));
  const users = useQuery({ ...trpc.users.list.queryOptions(), enabled: isAdmin });

  const [overrideAssignee, setOverrideAssignee] = useState<string | null>(null);
  const [overrideDeadline, setOverrideDeadline] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const transition = useMutation(trpc.tasks.transition.mutationOptions());
  const assign = useMutation(trpc.tasks.assign.mutationOptions());
  const setDeadline = useMutation(trpc.tasks.setDeadline.mutationOptions());

  const p = preview.data;
  const gated = task.requiresApproval && !isAdmin;

  async function confirm() {
    setBusy(true);
    try {
      // admin overrides become a pre-assignment / explicit deadline on the
      // successor BEFORE completion — the engine then honors them (Rule A)
      if (isAdmin && p?.kind === "handoff") {
        const chosen = overrideAssignee ?? p.assigneeId;
        if (chosen !== p.assigneeId || (chosen && p.route === "same_person")) {
          await assign.mutateAsync({ id: p.nextTaskId, assigneeId: chosen });
        }
        if (overrideDeadline) {
          await setDeadline.mutateAsync({ id: p.nextTaskId, deadline: overrideDeadline });
        }
      }
      await transition.mutateAsync({ id: task.id, to: "done" });
      if (gated) {
        toast.success(`Sent for approval — Adham has been notified.`);
      } else if (p?.kind === "handoff") {
        const who = isAdmin
          ? (users.data?.find((u) => u.id === (overrideAssignee ?? p.assigneeId))?.name ??
            p.assigneeName)
          : p.assigneeName;
        toast.success(
          who
            ? `"${task.title}" done — ${p.nextTitle} goes to ${who}.`
            : `"${task.title}" done — ${p.nextTitle} needs an assignee (admin notified).`,
        );
      } else if (p?.kind === "last_stage") {
        toast.success(`"${task.title}" done — that was the last stage! 🎉`);
      } else {
        toast.success(`"${task.title}" completed ✓`);
      }
      onDone();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't complete the task.");
      setBusy(false);
    }
  }

  return (
    <Modal
      title={gated ? "Submit for approval" : `Finish “${task.title}”?`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={busy || preview.isPending}>
            {busy ? "Working…" : gated ? "Submit" : "Mark done"}
          </Button>
        </>
      }
    >
      {preview.isPending ? (
        <p className="text-sm text-gray-500">Checking what happens next…</p>
      ) : gated ? (
        <p className="text-sm text-gray-600">
          This stage needs Adham's approval. He'll be notified, and the next stage starts once he
          approves.
        </p>
      ) : p?.kind === "handoff" ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3">
            <span className="text-sm font-medium text-gray-500 line-through">{task.title}</span>
            <ArrowRight size={16} className="shrink-0 text-accent-600" />
            <div>
              <p className="text-sm font-semibold text-gray-900">{p.nextTitle}</p>
              <p className="text-xs text-gray-500">
                {p.assigneeName
                  ? p.route === "pre_assigned"
                    ? `already assigned to ${p.assigneeName}`
                    : `goes to ${p.assigneeName} (same person, right skill)`
                  : "no one qualifies — lands in the unassigned queue"}
                {p.defaultDeadline ? ` · due ${formatShort(p.defaultDeadline)}` : ""}
              </p>
            </div>
          </div>
          {isAdmin && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="ho-assignee">Hand off to</Label>
                <Select
                  id="ho-assignee"
                  value={overrideAssignee ?? p.assigneeId ?? ""}
                  onChange={(e) => setOverrideAssignee(e.target.value || null)}
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
              </div>
              <div>
                <Label htmlFor="ho-deadline">Deadline</Label>
                <Input
                  id="ho-deadline"
                  type="date"
                  value={overrideDeadline ?? p.defaultDeadline ?? ""}
                  onChange={(e) => setOverrideDeadline(e.target.value || null)}
                />
              </div>
            </div>
          )}
          {!isAdmin && !p.assigneeName && (
            <p className="text-xs text-gray-500">Adham will be notified to assign the next stage.</p>
          )}
        </div>
      ) : p?.kind === "last_stage" ? (
        <p className="text-sm text-gray-600">
          This is the <span className="font-medium">last stage</span> — completing it finishes the
          whole project.
        </p>
      ) : (
        <p className="text-sm text-gray-600">Mark this task as done?</p>
      )}
    </Modal>
  );
}
