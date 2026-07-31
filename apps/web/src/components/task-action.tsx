import { can, taskLabel, type TaskStatus } from "@mams/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { PeoplePicker } from "@/components/people-picker";
import { nextAction, type Viewer } from "@/components/task-bits";
import { formatShort } from "@/lib/dates";
import { useTRPC } from "@/lib/trpc";

type ActionTask = {
  id: string;
  status: TaskStatus;
  stageName: string | null;
  assigneeIds: string[];
  requiresApproval: boolean;
  chainPosition?: number | null;
};

/**
 * The one primary action button (PLAN.md §8.1). Completing a chain task opens
 * the handoff dialog: "this finishes X — here's where it goes next", with
 * whoever may assign able to change the people and the dates right there.
 */
export function TaskActionButton({
  task,
  viewer,
  size = "sm",
}: {
  task: ActionTask;
  viewer: Viewer;
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
      onError: (err) => toast.error(err.message || "That didn't work — try again."),
      onSettled: invalidate,
    }),
  );

  const action = nextAction(task, viewer);
  if (!action) return null;

  const label = taskLabel(task.stageName);
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
        ? `Started "${label}"`
        : action!.to === "done"
          ? `"${label}" completed ✓`
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
  viewer: Viewer;
  onClose: () => void;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const canAssign = can(viewer, "tasks.assign");
  const canSchedule = can(viewer, "tasks.manage");
  const preview = useQuery(trpc.tasks.handoffPreview.queryOptions({ id: task.id }));
  const users = useQuery(trpc.users.list.queryOptions());

  const [overrideAssignees, setOverrideAssignees] = useState<string[] | null>(null);
  const [overrideStart, setOverrideStart] = useState<string | null>(null);
  const [overrideDeadline, setOverrideDeadline] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const transition = useMutation(trpc.tasks.transition.mutationOptions());
  const setAssignees = useMutation(trpc.tasks.setAssignees.mutationOptions());
  const setSchedule = useMutation(trpc.tasks.setSchedule.mutationOptions());

  const p = preview.data;
  const label = taskLabel(task.stageName);
  const gated = task.requiresApproval && !can(viewer, "tasks.approve");
  const plannedAssignees =
    p?.kind === "handoff" ? (overrideAssignees ?? p.assignees.map((a) => a.id)) : [];

  async function confirm() {
    setBusy(true);
    try {
      // overrides become a pre-assignment / explicit schedule on the successor
      // BEFORE completion — the engine then honors them (Rule A)
      if (p?.kind === "handoff") {
        if (canAssign && overrideAssignees) {
          await setAssignees.mutateAsync({ id: p.nextTaskId, userIds: overrideAssignees });
        }
        if (canSchedule && (overrideStart || overrideDeadline)) {
          await setSchedule.mutateAsync({
            id: p.nextTaskId,
            ...(overrideStart ? { startDate: overrideStart } : {}),
            ...(overrideDeadline ? { deadline: overrideDeadline } : {}),
          });
        }
      }
      await transition.mutateAsync({ id: task.id, to: "done" });
      if (gated) {
        toast.success("Sent for approval — the approvers have been notified.");
      } else if (p?.kind === "handoff") {
        const names = plannedAssignees
          .map((id) => users.data?.find((u) => u.id === id)?.name)
          .filter(Boolean)
          .join(" & ");
        toast.success(
          names
            ? `"${label}" done — ${p.nextLabel} goes to ${names}.`
            : `"${label}" done — ${p.nextLabel} still needs someone.`,
        );
      } else if (p?.kind === "last_stage") {
        toast.success(`"${label}" done — that was the last stage! 🎉`);
      } else {
        toast.success(`"${label}" completed ✓`);
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
      title={gated ? "Submit for approval" : `Finish “${label}”?`}
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
          This stage needs approval. The approvers are notified, and the next stage starts once one
          of them signs off.
        </p>
      ) : p?.kind === "handoff" ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl bg-canvas px-4 py-3">
            <span className="text-sm font-medium text-gray-500 line-through">{label}</span>
            <ArrowRight size={16} className="shrink-0 text-accent-600" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900">{p.nextLabel}</p>
              <p className="text-xs text-gray-500">
                {p.assignees.length > 0
                  ? p.route === "pre_assigned"
                    ? `already assigned to ${p.assignees.map((a) => a.name).join(" & ")}`
                    : `stays with ${p.assignees.map((a) => a.name).join(" & ")} (same people, right skills)`
                  : "no one qualifies — it lands in the unassigned queue"}
                {p.defaultDeadline ? ` · due ${formatShort(p.defaultDeadline)}` : ""}
              </p>
            </div>
          </div>

          {canAssign && (
            <div>
              <Label>Hand off to</Label>
              <PeoplePicker
                selected={plannedAssignees}
                onChange={setOverrideAssignees}
                emptyHint="Nobody yet — it goes to the unassigned queue."
              />
            </div>
          )}
          {canSchedule && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="ho-start">Start date</Label>
                <Input
                  id="ho-start"
                  type="date"
                  value={overrideStart ?? p.defaultStartDate ?? ""}
                  onChange={(e) => setOverrideStart(e.target.value || null)}
                />
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
          {!canAssign && p.assignees.length === 0 && (
            <p className="text-xs text-gray-500">
              Whoever assigns work will be notified to staff the next stage.
            </p>
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
