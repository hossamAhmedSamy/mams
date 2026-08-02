import {
  DEFAULT_ALLOWANCE,
  dailyRate,
  formatMoney,
  type LeaveBalance,
  type LeaveType,
  LEAVE_TYPES,
  LEAVE_TYPE_LABELS,
  leaveDays,
} from "@mams/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Check, SlidersHorizontal, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { LeaveTypeChip, leaveSpan } from "@/components/leave-bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { EmptyState, ErrorBanner, SkeletonRows } from "@/components/ui/feedback";
import { Modal } from "@/components/ui/modal";
import { Avatar, PageHeader, SectionLabel } from "@/components/ui/page";
import { formatShort, todayISO } from "@/lib/dates";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { PayrollSection } from "./payroll";

type Tab = "time-off" | "payroll";

/**
 * The owner's HR console. Two tabs because the two jobs happen on different
 * days: answering people, and paying people.
 */
export function PeoplePage() {
  const [tab, setTab] = useState<Tab>("time-off");
  const trpc = useTRPC();
  const pending = useQuery(trpc.hr.pending.queryOptions());
  const waiting = pending.data?.length ?? 0;

  return (
    <div className="settle space-y-6">
      <PageHeader
        eyebrow="Your team"
        title="People"
        subtitle="Time off, balances and the monthly payroll"
      />

      <div className="flex gap-1 border-b border-rule">
        {(
          [
            ["time-off", "Time off", waiting],
            ["payroll", "Payroll", 0],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-base font-medium transition-colors",
              tab === key
                ? "border-ink-900 text-ink-900"
                : "border-transparent text-ink-400 hover:text-ink-700",
            )}
          >
            {label}
            {count > 0 && (
              <span className="rounded-full bg-now px-1.5 font-mono text-[11px] text-white">
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "time-off" ? <TimeOffSection /> : <PayrollSection />}
    </div>
  );
}

function TimeOffSection() {
  const trpc = useTRPC();
  const [year, setYear] = useState(() => Number(todayISO().slice(0, 4)));
  const pending = useQuery(trpc.hr.pending.queryOptions());
  const team = useQuery(trpc.hr.team.queryOptions({ year }));
  const [logging, setLogging] = useState<{ id: string; name: string } | null>(null);

  return (
    <div className="space-y-6">
      {pending.isError ? (
        <ErrorBanner message="The requests didn't load." onRetry={() => pending.refetch()} />
      ) : pending.data && pending.data.length > 0 ? (
        <Card edge="now">
          <CardHeader>
            <CardTitle>Waiting on you</CardTitle>
            <Badge tone="now" className="ml-auto">
              {pending.data.length}
            </Badge>
          </CardHeader>
          <ul className="divide-y divide-rule-soft">
            {pending.data.map((req) => (
              <PendingRow key={req.id} req={req} />
            ))}
          </ul>
        </Card>
      ) : null}

      <div>
        <SectionLabel
          className="mb-3"
          count={team.data?.length}
          action={
            <div className="flex items-center gap-1">
              <button
                aria-label="Previous year"
                onClick={() => setYear((y) => y - 1)}
                className="px-1.5 font-mono text-small text-ink-300 transition-colors hover:text-ink-900"
              >
                ‹
              </button>
              <span className="font-mono text-small text-ink-500">{year}</span>
              <button
                aria-label="Next year"
                onClick={() => setYear((y) => y + 1)}
                className="px-1.5 font-mono text-small text-ink-300 transition-colors hover:text-ink-900"
              >
                ›
              </button>
            </div>
          }
        >
          The team
        </SectionLabel>

        {team.isPending ? (
          <Card>
            <SkeletonRows rows={4} />
          </Card>
        ) : team.isError ? (
          <ErrorBanner message="The team didn't load." onRetry={() => team.refetch()} />
        ) : (
          <div className="space-y-2">
            {team.data.map((person) => (
              <PersonCard
                key={person.id}
                person={person}
                year={year}
                onLogLeave={() => setLogging({ id: person.id, name: person.name })}
              />
            ))}
          </div>
        )}
      </div>

      {logging && <LogLeaveModal person={logging} onClose={() => setLogging(null)} />}
    </div>
  );
}

type PendingLeave = {
  id: string;
  userId: string;
  userName: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  reason: string | null;
  balance: LeaveBalance;
  daysBeyondBalance: number;
  suggestedDeduction: number;
  monthlyAmount: string | null;
};

function PendingRow({ req }: { req: PendingLeave }) {
  const [deciding, setDeciding] = useState<"approve" | "reject" | null>(null);

  const pool =
    req.type === "sick" ? req.balance.sick : req.type === "unpaid" ? null : req.balance.annual;

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Avatar name={req.userName} size="sm" />
          <span className="text-base font-medium text-ink-900">{req.userName}</span>
          <LeaveTypeChip type={req.type} />
        </div>
        <p className="mt-1 text-base text-ink-700">
          {leaveSpan(req.startDate, req.endDate, req.days)}
        </p>
        {req.reason && <p className="mt-0.5 text-small text-ink-500">{req.reason}</p>}
        <p className="mt-1 text-small text-ink-400">
          {pool ? (
            <>
              {req.type === "sick" ? "Sick" : "Annual"} balance{" "}
              <span className="font-mono">{pool.left}</span> of{" "}
              <span className="font-mono">{pool.allowed}</span> left
            </>
          ) : (
            "Unpaid leave — no balance involved"
          )}
          {req.daysBeyondBalance > 0 && (
            <span className="text-late">
              {" · "}
              <span className="font-mono">{req.daysBeyondBalance}</span> day
              {req.daysBeyondBalance === 1 ? "" : "s"} beyond it
            </span>
          )}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" onClick={() => setDeciding("approve")}>
          <Check size={14} /> Approve
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setDeciding("reject")}>
          <X size={14} /> Reject
        </Button>
      </div>

      {deciding && <DecideModal req={req} mode={deciding} onClose={() => setDeciding(null)} />}
    </li>
  );
}

/**
 * Approving is where the owner's two levers live: yes/no, and whether these
 * days come off the person's pay. The amount is pre-filled with what the days
 * are actually worth, so saying yes to both is one tap.
 */
function DecideModal({
  req,
  mode,
  onClose,
}: {
  req: PendingLeave;
  mode: "approve" | "reject";
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const approving = mode === "approve";
  const [note, setNote] = useState("");
  const [deduct, setDeduct] = useState(() => req.suggestedDeduction > 0);
  const [amount, setAmount] = useState(() =>
    req.suggestedDeduction > 0 ? String(req.suggestedDeduction) : "",
  );

  const decide = useMutation(
    trpc.hr.decideLeave.mutationOptions({
      onSuccess: () => {
        toast.success(approving ? `Approved — ${req.userName} has been told` : "Rejected");
        queryClient.invalidateQueries({ queryKey: trpc.hr.pathKey() });
        onClose();
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  const perDay = req.monthlyAmount ? dailyRate(req.monthlyAmount) : 0;

  return (
    <Modal
      eyebrow={`${req.userName} · ${leaveSpan(req.startDate, req.endDate, req.days)}`}
      title={approving ? "Approve time off" : "Reject time off"}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={approving ? "primary" : "danger"}
            disabled={decide.isPending}
            onClick={() =>
              decide.mutate({
                id: req.id,
                approve: approving,
                note: note.trim() || undefined,
                deductAmount: approving && deduct && amount ? Number(amount) : undefined,
              })
            }
          >
            {approving ? "Approve" : "Reject"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label={approving ? "Note (optional)" : "Why?"}
          htmlFor="dec-note"
          hint={`${req.userName} sees this.`}
        >
          <Textarea
            id="dec-note"
            placeholder={approving ? "Enjoy it — hand the Kuja edit over first." : "We're shooting that week — can you move it?"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>

        {approving && (
          <div className="rounded-card border border-rule bg-paper/60 p-3.5">
            <Checkbox
              label="Take these days off their pay"
              checked={deduct}
              onChange={(e) => setDeduct(e.target.checked)}
            />
            {deduct && (
              <div className="mt-3 space-y-2">
                <Field label="Amount (EGP)" htmlFor="dec-amount">
                  <Input
                    id="dec-amount"
                    type="number"
                    min={0}
                    className="font-mono"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </Field>
                <p className="text-small text-ink-400">
                  {perDay > 0 ? (
                    <>
                      <span className="font-mono">{formatMoney(perDay)}</span> a day
                      {req.daysBeyondBalance > 0 && (
                        <>
                          {" "}
                          × <span className="font-mono">{req.daysBeyondBalance}</span> day
                          {req.daysBeyondBalance === 1 ? "" : "s"} past the balance
                        </>
                      )}
                      . It lands on {req.startDate.slice(0, 7)}'s payslip when you prepare payroll.
                    </>
                  ) : (
                    "No salary is set for this person yet — set one in Payroll first."
                  )}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

type TeamPerson = {
  id: string;
  name: string;
  allowance: { annual: number; casual: number; sick: number };
  customAllowance: boolean;
  balance: LeaveBalance;
  offToday: boolean;
  upcoming: {
    id: string;
    type: LeaveType;
    startDate: string;
    endDate: string;
    days: number;
    status: string;
  }[];
};

function PersonCard({
  person,
  year,
  onLogLeave,
}: {
  person: TeamPerson;
  year: number;
  onLogLeave: () => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <Card edge={person.offToday ? "now" : "none"}>
      <CardBody className="py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar name={person.name} size="sm" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-base font-medium text-ink-900">{person.name}</p>
                {person.offToday && <Badge tone="now">Off today</Badge>}
                {person.customAllowance && <Badge tone="neutral">Custom allowance</Badge>}
              </div>
              <p className="mt-0.5 text-small text-ink-400">
                Annual <span className="font-mono text-ink-700">{person.balance.annual.left}</span>/
                <span className="font-mono">{person.balance.annual.allowed}</span>
                {" · casual "}
                <span className="font-mono text-ink-700">{person.balance.casual.left}</span>/
                <span className="font-mono">{person.balance.casual.allowed}</span>
                {" · sick "}
                <span className="font-mono text-ink-700">{person.balance.sick.left}</span>/
                <span className="font-mono">{person.balance.sick.allowed}</span>
                {person.balance.unpaid.used > 0 && (
                  <>
                    {" · "}
                    <span className="font-mono">{person.balance.unpaid.used}</span> unpaid
                  </>
                )}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="secondary" size="sm" onClick={onLogLeave}>
              <CalendarPlus size={14} /> Log leave
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Allowance for ${person.name}`}
              onClick={() => setEditing(true)}
            >
              <SlidersHorizontal size={14} />
            </Button>
          </div>
        </div>

        {person.upcoming.length > 0 && (
          <ul className="mt-2.5 space-y-1 border-l-2 border-rule pl-3">
            {person.upcoming.map((leave) => (
              <UpcomingRow key={leave.id} leave={leave} />
            ))}
          </ul>
        )}
      </CardBody>

      {editing && (
        <AllowanceModal person={person} year={year} onClose={() => setEditing(false)} />
      )}
    </Card>
  );
}

function UpcomingRow({ leave }: { leave: TeamPerson["upcoming"][number] }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const remove = useMutation(
    trpc.hr.deleteLeave.mutationOptions({
      onSuccess: () => {
        toast.success("Removed");
        queryClient.invalidateQueries({ queryKey: trpc.hr.pathKey() });
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  return (
    <li className="flex items-center justify-between gap-3 text-small">
      <span className="min-w-0 truncate text-ink-500">
        {leaveSpan(leave.startDate, leave.endDate, leave.days)} ·{" "}
        {LEAVE_TYPE_LABELS[leave.type].toLowerCase()}
        {leave.status === "pending" && <span className="text-now-ink"> · waiting on you</span>}
      </span>
      {leave.status === "approved" && (
        <button
          aria-label="Remove this leave"
          disabled={remove.isPending}
          onClick={() => remove.mutate({ id: leave.id })}
          className="shrink-0 text-ink-300 transition-colors hover:text-late"
        >
          <Trash2 size={13} />
        </button>
      )}
    </li>
  );
}

function AllowanceModal({
  person,
  year,
  onClose,
}: {
  person: TeamPerson;
  year: number;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [annual, setAnnual] = useState(String(person.allowance.annual));
  const [casual, setCasual] = useState(String(person.allowance.casual));
  const [sick, setSick] = useState(String(person.allowance.sick));

  const save = useMutation(
    trpc.hr.setAllowance.mutationOptions({
      onSuccess: () => {
        toast.success(`${person.name}'s ${year} allowance saved`);
        queryClient.invalidateQueries({ queryKey: trpc.hr.pathKey() });
        onClose();
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  return (
    <Modal
      eyebrow={`${person.name} · ${year}`}
      title="Yearly allowance"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending}
            onClick={() =>
              save.mutate({
                userId: person.id,
                year,
                annualDays: Number(annual),
                casualDays: Number(casual),
                sickDays: Number(sick),
              })
            }
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Annual" htmlFor="al-annual">
            <Input
              id="al-annual"
              type="number"
              min={0}
              className="font-mono"
              value={annual}
              onChange={(e) => setAnnual(e.target.value)}
            />
          </Field>
          <Field label="Casual" htmlFor="al-casual">
            <Input
              id="al-casual"
              type="number"
              min={0}
              className="font-mono"
              value={casual}
              onChange={(e) => setCasual(e.target.value)}
            />
          </Field>
          <Field label="Sick" htmlFor="al-sick">
            <Input
              id="al-sick"
              type="number"
              min={0}
              className="font-mono"
              value={sick}
              onChange={(e) => setSick(e.target.value)}
            />
          </Field>
        </div>
        <p className="text-small text-ink-400">
          Casual days come out of the annual days — {DEFAULT_ALLOWANCE.casual} of the{" "}
          {DEFAULT_ALLOWANCE.annual} by default. Sick days are their own pool.
        </p>
      </div>
    </Modal>
  );
}

/** "Mariam took yesterday off" — recorded straight in, no request needed. */
function LogLeaveModal({
  person,
  onClose,
}: {
  person: { id: string; name: string };
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const salaries = useQuery(trpc.hr.salaries.queryOptions());
  const [type, setType] = useState<LeaveType>("casual");
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(todayISO());
  const [reason, setReason] = useState("");
  const [deduct, setDeduct] = useState(false);
  const [amount, setAmount] = useState("");

  const valid = Boolean(startDate) && Boolean(endDate) && endDate >= startDate;
  const days = valid ? leaveDays(startDate, endDate) : 0;
  const monthly = salaries.data?.find((s) => s.id === person.id)?.monthlyAmount ?? null;
  const perDay = monthly ? dailyRate(monthly) : 0;

  const log = useMutation(
    trpc.hr.logLeave.mutationOptions({
      onSuccess: () => {
        toast.success(`Recorded for ${person.name}`);
        queryClient.invalidateQueries({ queryKey: trpc.hr.pathKey() });
        onClose();
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  return (
    <Modal
      eyebrow={person.name}
      title="Log time off"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={log.isPending || !valid}
            onClick={() =>
              log.mutate({
                userId: person.id,
                type,
                startDate,
                endDate,
                reason: reason.trim() || undefined,
                deductAmount: deduct && amount ? Number(amount) : undefined,
              })
            }
          >
            Record {days} day{days === 1 ? "" : "s"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Kind of leave" htmlFor="log-type">
          <Select
            id="log-type"
            value={type}
            onChange={(e) => {
              const next = e.target.value as LeaveType;
              setType(next);
              if (next === "unpaid" && perDay > 0) {
                setDeduct(true);
                setAmount(String(Math.round(perDay * days * 100) / 100));
              }
            }}
          >
            {LEAVE_TYPES.map((t) => (
              <option key={t} value={t}>
                {LEAVE_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First day" htmlFor="log-from">
            <Input
              id="log-from"
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                if (endDate < e.target.value) setEndDate(e.target.value);
              }}
            />
          </Field>
          <Field label="Last day" htmlFor="log-to">
            <Input
              id="log-to"
              type="date"
              min={startDate}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Note (optional)" htmlFor="log-note">
          <Input
            id="log-note"
            placeholder="Called in the morning"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>

        <div className="rounded-card border border-rule bg-paper/60 p-3.5">
          <Checkbox
            label="Take these days off their pay"
            checked={deduct}
            onChange={(e) => {
              setDeduct(e.target.checked);
              if (e.target.checked && !amount && perDay > 0) {
                setAmount(String(Math.round(perDay * days * 100) / 100));
              }
            }}
          />
          {deduct && (
            <div className="mt-3">
              <Field label="Amount (EGP)" htmlFor="log-amount">
                <Input
                  id="log-amount"
                  type="number"
                  min={0}
                  className="font-mono"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </Field>
              <p className="mt-1.5 text-small text-ink-400">
                {perDay > 0 ? (
                  <>
                    <span className="font-mono">{formatMoney(perDay)}</span> a day ×{" "}
                    <span className="font-mono">{days}</span> ={" "}
                    <span className="font-mono">{formatMoney(perDay * days)}</span>
                  </>
                ) : (
                  "No salary set for this person yet."
                )}
              </p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
