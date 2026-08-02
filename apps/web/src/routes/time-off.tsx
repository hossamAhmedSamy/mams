import {
  ADJUSTMENT_LABELS,
  adjustmentSign,
  daysBeyondBalance,
  formatMoney,
  type LeaveType,
  LEAVE_TYPES,
  LEAVE_TYPE_HINTS,
  LEAVE_TYPE_LABELS,
  leaveDays,
  periodLabel,
} from "@mams/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  BalanceRow,
  DeductionNote,
  LeaveStatusBadge,
  LeaveTypeChip,
  leaveSpan,
} from "@/components/leave-bits";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorBanner, SkeletonRows } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page";
import { formatShort, todayISO } from "@/lib/dates";
import { useTRPC } from "@/lib/trpc";

/**
 * The member's half of HR: what's left of the year, how to ask for more days,
 * and what has actually been paid. Everything on this screen is about the one
 * person reading it — nobody else's balance or pay is reachable from here.
 */
export function TimeOffPage() {
  const trpc = useTRPC();
  const mine = useQuery(trpc.hr.me.queryOptions());
  const [asking, setAsking] = useState(false);

  return (
    <div className="settle space-y-6">
      <PageHeader
        eyebrow={mine.data ? `Your ${mine.data.year}` : "Your year"}
        title="Time off & pay"
        subtitle="Ask for days off, see what's left, and keep your payslips in one place"
        actions={
          <Button onClick={() => setAsking((v) => !v)}>
            <Plus size={16} /> Request time off
          </Button>
        }
      />

      {mine.isPending ? (
        <Card>
          <SkeletonRows rows={4} />
        </Card>
      ) : mine.isError ? (
        <ErrorBanner message="Your time off didn't load." onRetry={() => mine.refetch()} />
      ) : (
        <>
          <Card>
            <CardBody className="py-5">
              <BalanceRow balance={mine.data.balance} />
            </CardBody>
          </Card>

          {asking && <RequestForm balance={mine.data.balance} onDone={() => setAsking(false)} />}

          <Card>
            <CardHeader>
              <CardTitle>Your requests</CardTitle>
            </CardHeader>
            {mine.data.requests.length === 0 ? (
              <EmptyState
                title="No days booked yet"
                hint="Ask for time off here and Adham sees it straight away."
                action={<Button onClick={() => setAsking(true)}>Request time off</Button>}
              />
            ) : (
              <ul className="divide-y divide-rule-soft">
                {mine.data.requests.map((req) => (
                  <RequestRow key={req.id} req={req} />
                ))}
              </ul>
            )}
          </Card>

          <PayCard salary={mine.data.salary} payslips={mine.data.payslips} />
        </>
      )}
    </div>
  );
}

type MyRequest = {
  id: string;
  type: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string | null;
  status: string;
  decisionNote: string | null;
  deductFromSalary: string | null;
};

function RequestRow({ req }: { req: MyRequest }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const cancel = useMutation(
    trpc.hr.cancelMyLeave.mutationOptions({
      onSuccess: () => {
        toast.success("Request withdrawn");
        queryClient.invalidateQueries({ queryKey: trpc.hr.pathKey() });
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base font-medium text-ink-900">
            {leaveSpan(req.startDate, req.endDate, req.days)}
          </span>
          <LeaveTypeChip type={req.type as LeaveType} />
          <LeaveStatusBadge status={req.status} />
        </div>
        {req.reason && <p className="mt-1 text-base text-ink-700">{req.reason}</p>}
        {req.status === "rejected" && req.decisionNote && (
          <p className="mt-2 rounded-[8px] border-l-2 border-late bg-late-tint px-2.5 py-1.5 text-small text-late-ink">
            {req.decisionNote}
          </p>
        )}
        {req.status === "approved" && req.decisionNote && (
          <p className="mt-1 text-small text-ink-500">{req.decisionNote}</p>
        )}
        {req.status === "approved" && <DeductionNote amount={req.deductFromSalary} />}
      </div>
      {req.status === "pending" && (
        <Button
          variant="ghost"
          size="sm"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate({ id: req.id })}
        >
          Withdraw
        </Button>
      )}
    </li>
  );
}

function RequestForm({
  balance,
  onDone,
}: {
  balance: Parameters<typeof daysBeyondBalance>[2];
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [type, setType] = useState<LeaveType>("annual");
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(todayISO());
  const [reason, setReason] = useState("");

  const valid = Boolean(startDate) && Boolean(endDate) && endDate >= startDate;
  const days = valid ? leaveDays(startDate, endDate) : 0;
  const beyond = valid ? daysBeyondBalance(type, days, balance) : 0;

  const request = useMutation(
    trpc.hr.requestLeave.mutationOptions({
      onSuccess: () => {
        toast.success("Sent — Adham has been notified.");
        queryClient.invalidateQueries({ queryKey: trpc.hr.pathKey() });
        onDone();
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>New request</CardTitle>
      </CardHeader>
      <CardBody>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            request.mutate({ type, startDate, endDate, reason: reason.trim() || undefined });
          }}
        >
          <Field label="Kind of leave" htmlFor="lv-type" hint={LEAVE_TYPE_HINTS[type]}>
            <Select
              id="lv-type"
              value={type}
              onChange={(e) => setType(e.target.value as LeaveType)}
            >
              {LEAVE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {LEAVE_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="First day" htmlFor="lv-from">
              <Input
                id="lv-from"
                type="date"
                required
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (endDate < e.target.value) setEndDate(e.target.value);
                }}
              />
            </Field>
            <Field label="Last day" htmlFor="lv-to">
              <Input
                id="lv-to"
                type="date"
                required
                min={startDate}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </Field>
          </div>
          <Field
            label="Why (optional)"
            htmlFor="lv-reason"
            className="sm:col-span-2"
            hint="A line of context makes it an easy yes."
          >
            <Textarea
              id="lv-reason"
              placeholder="Family wedding in Alexandria"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>

          {valid && (
            <div className="sm:col-span-2">
              <p className="text-base text-ink-700">
                <span className="font-mono font-medium">{days}</span> day{days === 1 ? "" : "s"} off,{" "}
                {formatShort(startDate)}
                {startDate !== endDate ? ` – ${formatShort(endDate)}` : ""}.
              </p>
              {beyond > 0 && (
                <p className="mt-1.5 rounded-[8px] border-l-2 border-now bg-now-tint px-2.5 py-1.5 text-small text-now-ink">
                  <span className="font-mono font-medium">{beyond}</span> of those day
                  {beyond === 1 ? " is" : "s are"} past your balance — Adham can still approve, and
                  may take {beyond === 1 ? "it" : "them"} off that month's pay.
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={request.isPending || !valid}>
              {request.isPending ? "Sending…" : "Send request"}
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

type MyPayslip = {
  id: string;
  period: string;
  baseAmount: number;
  netAmount: number;
  paidOn: string | null;
  note: string | null;
  adjustments: { id: string; kind: string; amount: number; note: string | null }[];
};

function PayCard({
  salary,
  payslips,
}: {
  salary: { monthlyAmount: number; from: string } | null;
  payslips: MyPayslip[];
}) {
  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>Your pay</CardTitle>
          <p className="mt-0.5 text-small text-ink-400">Only you and Adham can see this.</p>
        </div>
        {salary && (
          <span className="ml-auto font-mono text-lead font-medium tabular-nums text-ink-900">
            {formatMoney(salary.monthlyAmount)}
            <span className="ml-1 text-small font-normal text-ink-400">/ month</span>
          </span>
        )}
      </CardHeader>

      {payslips.length === 0 ? (
        <EmptyState
          title={salary ? "No payslips yet" : "No salary set yet"}
          hint={
            salary
              ? "Each month's payslip lands here once Adham marks it paid."
              : "Once Adham sets your monthly salary, your payslips appear here."
          }
        />
      ) : (
        <ul className="divide-y divide-rule-soft">
          {payslips.map((slip) => (
            <li key={slip.id} className="px-5 py-3.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-base font-medium text-ink-900">{periodLabel(slip.period)}</p>
                  <p className="mt-0.5 text-small text-ink-400">
                    Paid{" "}
                    <span className="font-mono">
                      {slip.paidOn ? formatShort(slip.paidOn) : "—"}
                    </span>
                    {slip.adjustments.length === 0 ? "" : ` · base ${formatMoney(slip.baseAmount)}`}
                  </p>
                </div>
                <span className="font-mono text-lead font-medium tabular-nums text-ink-900">
                  {formatMoney(slip.netAmount)}
                </span>
              </div>
              {slip.adjustments.length > 0 && (
                <ul className="mt-2 space-y-1 border-l-2 border-rule pl-3">
                  {slip.adjustments.map((line) => (
                    <li key={line.id} className="flex justify-between gap-3 text-small">
                      <span className="min-w-0 truncate text-ink-500">
                        {ADJUSTMENT_LABELS[line.kind as keyof typeof ADJUSTMENT_LABELS]}
                        {line.note ? ` · ${line.note}` : ""}
                      </span>
                      <span className="shrink-0 font-mono tabular-nums text-ink-600">
                        {adjustmentSign(line.kind as keyof typeof ADJUSTMENT_LABELS) > 0 ? "+" : "−"}
                        {formatMoney(line.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
