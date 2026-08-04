import {
  formatMoney,
  type LeaveType,
  LEAVE_TYPE_LABELS,
  taskLabel,
} from "@mams/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Wallet } from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";
import { leaveSpan } from "@/components/leave-bits";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { ErrorBanner, SkeletonRows } from "@/components/ui/feedback";
import { Avatar, AvatarStack, SectionLabel } from "@/components/ui/page";
import { deadlineLabel, formatShort } from "@/lib/dates";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

/**
 * The owner's deck: the portal as a work regulator rather than a task list.
 *
 * Two questions, in the order he asks them — what is stuck on me, and what is
 * the floor doing. Decisions that take two seconds (an edit to sign off) happen
 * here; decisions with money or a person's balance behind them send him to the
 * screen that shows the whole picture.
 */
export function OwnerDeck() {
  const trpc = useTRPC();
  const deck = useQuery(trpc.dashboard.deck.queryOptions());

  if (deck.isPending) {
    return (
      <Card>
        <SkeletonRows rows={4} />
      </Card>
    );
  }
  if (deck.isError) {
    return <ErrorBanner message="Your deck didn't load." onRetry={() => deck.refetch()} />;
  }

  const { needs, floor, away, money, company, today } = deck.data;
  const waiting = needs.approvals.length + needs.leave.length + needs.claims.length;
  const nothingToRun = waiting === 0 && !floor && !money;
  if (nothingToRun) return null;

  return (
    <div className="space-y-9">
      {waiting > 0 && (
        <section>
          <SectionLabel tone="now" count={waiting} className="mb-3">
            Waiting on you
          </SectionLabel>
          <Card edge="now">
            <ul className="divide-y divide-rule-soft">
              {needs.approvals.map((task) => (
                <ApprovalRow key={task.id} task={task} today={today} />
              ))}
              {needs.leave.map((req) => (
                <LeaveRow key={req.id} req={req} />
              ))}
              {needs.claims.map((claim) => (
                <ClaimRow key={claim.id} claim={claim} />
              ))}
            </ul>
          </Card>
        </section>
      )}

      {floor && (
        <section className="space-y-4">
          <SectionLabel className="mb-3">On the floor</SectionLabel>

          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <Tile
              label="Late"
              value={floor.late.length}
              tone={floor.late.length > 0 ? "late" : "neutral"}
              to="/board"
            />
            <Tile label="Running today" value={floor.today.length} tone="now" to="/calendar" />
            <Tile
              label="Nobody on it"
              value={floor.unassigned.length}
              tone={floor.unassigned.length > 0 ? "late" : "neutral"}
              to="/board"
            />
            <Tile label="Campaigns live" value={company.activeProjects} to="/board" />
          </div>

          {(floor.late.length > 0 || floor.today.length > 0) && (
            <Card>
              <ul className="divide-y divide-rule-soft">
                {[...floor.late, ...floor.today].slice(0, 6).map((task) => (
                  <FloorRow key={task.id} task={task} today={today} />
                ))}
              </ul>
            </Card>
          )}
        </section>
      )}

      {(away.today.length > 0 || away.upcoming.length > 0 || money) && (
        <section className="grid items-start gap-4 lg:grid-cols-2">
          {(away.today.length > 0 || away.upcoming.length > 0) && (
            <div>
              <SectionLabel className="mb-3">Who's away</SectionLabel>
              <Card>
                <CardBody className="space-y-2.5 py-4">
                  {away.today.map((person) => (
                    <div key={person.id} className="flex items-center gap-2.5">
                      <Avatar name={person.userName} size="sm" />
                      <span className="text-base text-ink-800">{person.userName}</span>
                      <Badge tone="now" className="ml-auto">
                        Off today
                      </Badge>
                    </div>
                  ))}
                  {away.upcoming.map((person) => (
                    <div key={person.id} className="flex items-center gap-2.5">
                      <Avatar name={person.userName} size="sm" />
                      <span className="text-base text-ink-600">{person.userName}</span>
                      <span className="ml-auto font-mono text-small text-ink-400">
                        {formatShort(person.startDate)} – {formatShort(person.endDate)}
                      </span>
                    </div>
                  ))}
                </CardBody>
              </Card>
            </div>
          )}

          {money && (
            <div>
              <SectionLabel className="mb-3">This month</SectionLabel>
              <Card>
                <CardBody className="py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                    <MoneyFigure label="In" value={money.inThisMonth} tone="done" />
                    <MoneyFigure label="Out" value={money.outThisMonth} />
                    <MoneyFigure
                      label="Net"
                      value={money.inThisMonth - money.outThisMonth}
                      tone={money.inThisMonth - money.outThisMonth >= 0 ? "done" : "late"}
                    />
                  </div>
                  <Link
                    to="/money"
                    className="mt-3 inline-flex items-center gap-1.5 text-small font-medium text-ink-500 transition-colors hover:text-ink-900"
                  >
                    <Wallet size={13} /> The books <ArrowRight size={13} />
                  </Link>
                </CardBody>
              </Card>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  tone = "neutral",
  to,
}: {
  label: string;
  value: number;
  tone?: "neutral" | "late" | "now";
  to: string;
}) {
  const color = tone === "late" ? "text-late" : tone === "now" ? "text-now-ink" : "text-ink-900";
  return (
    <Link
      to={to}
      className="rounded-card border border-rule bg-surface p-3.5 transition-[border-color,box-shadow] hover:border-ink-300 hover:shadow-lift"
    >
      <p className="eyebrow text-ink-400">{label}</p>
      <p className={cn("mt-1.5 font-mono text-h2 font-medium tabular-nums", color)}>
        {String(value).padStart(2, "0")}
      </p>
    </Link>
  );
}

function MoneyFigure({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "done" | "late";
}) {
  const color = tone === "done" ? "text-done" : tone === "late" ? "text-late" : "text-ink-900";
  return (
    <div>
      <p className="eyebrow text-ink-400">{label}</p>
      <p className={cn("mt-1 font-mono text-title font-medium tabular-nums", color)}>
        {formatMoney(value)}
      </p>
    </div>
  );
}

/** The signing-off point: the edit is done, it needs the owner's eye. */
function ApprovalRow({
  task,
  today,
}: {
  task: {
    id: string;
    projectTitle: string;
    clientName: string;
    stageName: string | null;
    deadline: string | null;
    assignees: { id: string; name: string }[];
  };
  today: string;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const approve = useMutation(
    trpc.tasks.transition.mutationOptions({
      onSuccess: () => {
        toast.success("Approved — the campaign is done");
        queryClient.invalidateQueries({ queryKey: trpc.dashboard.pathKey() });
        queryClient.invalidateQueries({ queryKey: trpc.tasks.pathKey() });
        queryClient.invalidateQueries({ queryKey: trpc.projects.pathKey() });
      },
      onError: (err) => toast.error(err.message),
    }),
  );
  const due = task.deadline ? deadlineLabel(task.deadline, today) : null;

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="now">Approve</Badge>
          <Link to={`/tasks/${task.id}`} className="text-base font-medium text-ink-900 hover:underline">
            {taskLabel(task.stageName)} — {task.projectTitle}
          </Link>
          {due && (
            <span
              className={cn(
                "font-mono text-small font-medium",
                due.tone === "late" ? "text-late" : due.tone === "now" ? "text-now-ink" : "text-ink-400",
              )}
            >
              {due.text}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-small text-ink-400">
          {task.clientName}
          {task.assignees.length > 0 ? ` · ${task.assignees.map((a) => a.name).join(", ")}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <AvatarStack names={task.assignees.map((a) => a.name)} />
        <Button
          size="sm"
          disabled={approve.isPending}
          onClick={() => approve.mutate({ id: task.id, to: "done" })}
        >
          <Check size={14} /> Approve
        </Button>
      </div>
    </li>
  );
}

function LeaveRow({
  req,
}: {
  req: {
    id: string;
    userName: string;
    type: LeaveType;
    startDate: string;
    endDate: string;
    days: number;
    reason: string | null;
  };
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="ink">Time off</Badge>
          <span className="text-base font-medium text-ink-900">{req.userName}</span>
          <span className="text-base text-ink-600">
            {leaveSpan(req.startDate, req.endDate, req.days)}
          </span>
        </div>
        <p className="mt-0.5 text-small text-ink-400">
          {LEAVE_TYPE_LABELS[req.type]}
          {req.reason ? ` · ${req.reason}` : ""}
        </p>
      </div>
      <Link to="/people" className={buttonVariants({ variant: "secondary", size: "sm" })}>
        Decide
      </Link>
    </li>
  );
}

function ClaimRow({
  claim,
}: {
  claim: {
    id: string;
    amount: number;
    note: string | null;
    requesterName: string | null;
    categoryName: string;
  };
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="ink">Expense</Badge>
          <span className="font-mono text-base font-medium tabular-nums text-ink-900">
            {formatMoney(claim.amount)}
          </span>
          <span className="min-w-0 truncate text-base text-ink-600">{claim.note}</span>
        </div>
        <p className="mt-0.5 text-small text-ink-400">
          {claim.requesterName ?? "Someone"} · {claim.categoryName}
        </p>
      </div>
      <Link to="/money" className={buttonVariants({ variant: "secondary", size: "sm" })}>
        Decide
      </Link>
    </li>
  );
}

function FloorRow({
  task,
  today,
}: {
  task: {
    id: string;
    projectTitle: string;
    clientName: string;
    stageName: string | null;
    deadline: string | null;
    flagged: boolean;
    assignees: { id: string; name: string }[];
  };
  today: string;
}) {
  const due = task.deadline ? deadlineLabel(task.deadline, today) : null;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
      <div className="min-w-0">
        <Link
          to={`/tasks/${task.id}`}
          className="text-base font-medium text-ink-900 hover:underline"
        >
          {taskLabel(task.stageName)} — {task.projectTitle}
        </Link>
        <p className="mt-0.5 text-small text-ink-400">
          {task.clientName}
          {task.assignees.length > 0
            ? ` · ${task.assignees.map((a) => a.name.split(" ")[0]).join(", ")}`
            : " · nobody on it"}
          {task.flagged ? " · flagged" : ""}
        </p>
      </div>
      {due && (
        <span
          className={cn(
            "shrink-0 font-mono text-small font-medium",
            due.tone === "late" ? "text-late" : due.tone === "now" ? "text-now-ink" : "text-ink-400",
          )}
        >
          {due.text}
        </span>
      )}
    </li>
  );
}
