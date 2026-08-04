import {
  ADJUSTMENT_LABELS,
  type AdjustmentKind,
  adjustmentSign,
  dailyRate,
  formatMoney,
  periodLabel,
} from "@mams/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Plus, Trash2, Wallet } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorBanner, SkeletonRows } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Avatar, Stat } from "@/components/ui/page";
import { formatShort, todayISO } from "@/lib/dates";
import { useTRPC } from "@/lib/trpc";

/**
 * Payroll is a month you open, adjust and close. Nothing leaves the drafts
 * until "Pay" is pressed on a person — and pressing it is also what writes the
 * money into the books, so HR and Money can never disagree.
 */
export function PayrollSection() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState(() => todayISO().slice(0, 7));
  const run = useQuery(trpc.hr.payroll.queryOptions({ period }));

  const prepare = useMutation(
    trpc.hr.preparePayroll.mutationOptions({
      onSuccess: (res) => {
        toast.success(
          res.created === 0 && res.charged === 0
            ? "Already up to date"
            : `${res.created} payslip${res.created === 1 ? "" : "s"} ready${
                res.charged > 0 ? ` · ${res.charged} unpaid-day line${res.charged === 1 ? "" : "s"} added` : ""
              }`,
        );
        queryClient.invalidateQueries({ queryKey: trpc.hr.pathKey() });
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  const [y, m] = period.split("-").map(Number) as [number, number];
  function shift(delta: number) {
    setPeriod(new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center overflow-hidden rounded-field border border-rule bg-surface">
          <button
            aria-label="Previous month"
            onClick={() => shift(-1)}
            className="flex size-9 items-center justify-center text-ink-400 transition-colors hover:bg-ink-50 hover:text-ink-900"
          >
            <ChevronLeft size={17} />
          </button>
          <span className="display border-x border-rule px-3.5 text-small leading-9 text-ink-800">
            {periodLabel(period)}
          </span>
          <button
            aria-label="Next month"
            onClick={() => shift(1)}
            className="flex size-9 items-center justify-center text-ink-400 transition-colors hover:bg-ink-50 hover:text-ink-900"
          >
            <ChevronRight size={17} />
          </button>
        </div>
        <Button
          variant="secondary"
          disabled={prepare.isPending}
          onClick={() => prepare.mutate({ period })}
        >
          <Wallet size={16} />
          {run.data?.prepared ? "Refresh this month" : "Prepare payroll"}
        </Button>
      </div>

      {run.isPending ? (
        <Card>
          <SkeletonRows rows={4} />
        </Card>
      ) : run.isError ? (
        <ErrorBanner message="Payroll didn't load." onRetry={() => run.refetch()} />
      ) : run.data.rows.length === 0 ? (
        <Card>
          <EmptyState
            title="Nobody is on a salary yet"
            hint="Set monthly salaries below, then prepare the month to get payslips."
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Card>
              <CardBody className="py-3.5">
                <Stat label="Payroll this month" value={formatMoney(run.data.totalNet)} />
              </CardBody>
            </Card>
            <Card>
              <CardBody className="py-3.5">
                <Stat label="Paid" value={formatMoney(run.data.totalPaid)} tone="done" />
              </CardBody>
            </Card>
            <Card className="col-span-2 lg:col-span-1">
              <CardBody className="py-3.5">
                <Stat
                  label="Still to pay"
                  value={String(run.data.unpaidCount).padStart(2, "0")}
                  tone={run.data.unpaidCount > 0 ? "now" : "done"}
                  note={run.data.unpaidCount === 0 ? "Everyone is paid" : "people"}
                />
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{periodLabel(period)}</CardTitle>
              {!run.data.prepared && (
                <Badge tone="now" className="ml-auto">
                  Not prepared
                </Badge>
              )}
            </CardHeader>
            <ul className="divide-y divide-rule-soft">
              {run.data.rows.map((row) => (
                <PayrollRow key={row.userId} row={row} monthPrepared={run.data.prepared} />
              ))}
            </ul>
          </Card>
        </>
      )}

      <SalariesCard />
    </div>
  );
}

type PayrollRowData = {
  userId: string;
  name: string;
  monthlyAmount: number | null;
  payslip: {
    id: string;
    status: string;
    baseAmount: number;
    netAmount: number;
    paidOn: string | null;
    adjustments: { id: string; kind: AdjustmentKind; amount: number; note: string | null }[];
  } | null;
};

function PayrollRow({ row, monthPrepared }: { row: PayrollRowData; monthPrepared: boolean }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: trpc.hr.pathKey() });

  const removeLine = useMutation(
    trpc.hr.removeAdjustment.mutationOptions({ onSuccess: invalidate, onError: (e) => toast.error(e.message) }),
  );
  const pay = useMutation(
    trpc.hr.markPaid.mutationOptions({
      onSuccess: (res) => {
        toast.success(`${row.name} paid — ${formatMoney(res.net)} posted to Money`);
        queryClient.invalidateQueries({ queryKey: trpc.hr.pathKey() });
        queryClient.invalidateQueries({ queryKey: trpc.finance.pathKey() });
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  const slip = row.payslip;
  const paid = slip?.status === "paid";

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={row.name} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-base font-medium text-ink-900">{row.name}</p>
            <p className="text-small text-ink-400">
              {row.monthlyAmount === null ? (
                "No salary set"
              ) : (
                <>
                  base <span className="font-mono">{formatMoney(slip?.baseAmount ?? row.monthlyAmount)}</span>
                  {paid && slip?.paidOn ? ` · paid ${formatShort(slip.paidOn)}` : ""}
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="font-mono text-lead font-medium tabular-nums text-ink-900">
            {formatMoney(slip?.netAmount ?? row.monthlyAmount ?? 0)}
          </span>
          {paid ? (
            <Badge tone="done">Paid</Badge>
          ) : slip ? (
            <Button size="sm" disabled={pay.isPending} onClick={() => pay.mutate({ payslipId: slip.id })}>
              <Check size={14} /> Pay
            </Button>
          ) : (
            // the card header already says so when the whole month is unprepared;
            // this only earns its place when the month is half done
            monthPrepared && <Badge tone="neutral">Not prepared</Badge>
          )}
        </div>
      </div>

      {slip && (slip.adjustments.length > 0 || !paid) && (
        <div className="mt-2.5 border-l-2 border-rule pl-3">
          {slip.adjustments.map((line) => (
            <div key={line.id} className="flex items-center justify-between gap-3 py-0.5 text-small">
              <span className="min-w-0 truncate text-ink-500">
                {ADJUSTMENT_LABELS[line.kind]}
                {line.note ? ` · ${line.note}` : ""}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="font-mono tabular-nums text-ink-600">
                  {adjustmentSign(line.kind) > 0 ? "+" : "−"}
                  {formatMoney(line.amount)}
                </span>
                {!paid && (
                  <button
                    aria-label="Remove line"
                    disabled={removeLine.isPending}
                    onClick={() => removeLine.mutate({ id: line.id })}
                    className="text-ink-300 transition-colors hover:text-late"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </span>
            </div>
          ))}
          {!paid &&
            (adding ? (
              <AddAdjustment payslipId={slip.id} onDone={() => setAdding(false)} />
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="mt-1 inline-flex items-center gap-1 text-small font-medium text-ink-400 transition-colors hover:text-ink-900"
              >
                <Plus size={13} /> Bonus, deduction or advance
              </button>
            ))}
        </div>
      )}
    </li>
  );
}

function AddAdjustment({ payslipId, onDone }: { payslipId: string; onDone: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<AdjustmentKind>("bonus");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const add = useMutation(
    trpc.hr.addAdjustment.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.hr.pathKey() });
        onDone();
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <Select
        aria-label="Kind"
        className="h-9 w-36"
        value={kind}
        onChange={(e) => setKind(e.target.value as AdjustmentKind)}
      >
        <option value="bonus">Bonus</option>
        <option value="deduction">Deduction</option>
        <option value="advance">Advance taken</option>
      </Select>
      <Input
        aria-label="Amount"
        type="number"
        min={1}
        placeholder="Amount"
        className="h-9 w-28 font-mono"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <Input
        aria-label="Note"
        placeholder="What for?"
        className="h-9 w-44"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <Button
        size="sm"
        disabled={add.isPending || !amount || Number(amount) <= 0}
        onClick={() =>
          add.mutate({ payslipId, kind, amount: Number(amount), note: note.trim() || undefined })
        }
      >
        Add
      </Button>
      <Button size="sm" variant="ghost" onClick={onDone}>
        Cancel
      </Button>
    </div>
  );
}

/** The standing figures behind every month: who earns what, from when. */
function SalariesCard() {
  const trpc = useTRPC();
  const salaries = useQuery(trpc.hr.salaries.queryOptions());
  const [editing, setEditing] = useState<{ id: string; name: string; amount: number | null } | null>(
    null,
  );

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>Salaries</CardTitle>
          <p className="mt-0.5 text-small text-ink-400">
            Monthly pay per person. A raise is a new figure from a date — old payslips keep theirs.
          </p>
        </div>
      </CardHeader>

      {salaries.isPending ? (
        <SkeletonRows rows={3} />
      ) : salaries.isError ? (
        <CardBody>
          <ErrorBanner message="Salaries didn't load." onRetry={() => salaries.refetch()} />
        </CardBody>
      ) : (
        <ul className="divide-y divide-rule-soft">
          {salaries.data.map((person) => (
            <li
              key={person.id}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <Avatar name={person.name} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-base text-ink-800">{person.name}</p>
                  <p className="text-small text-ink-400">
                    {person.monthlyAmount === null ? (
                      "No salary set"
                    ) : (
                      <>
                        since <span className="font-mono">{formatShort(person.effectiveFrom!)}</span>
                        {" · "}
                        <span className="font-mono">{formatMoney(dailyRate(person.monthlyAmount))}</span>{" "}
                        a day
                      </>
                    )}
                    {person.upcoming
                      ? ` · ${formatMoney(person.upcoming.amount)} from ${formatShort(person.upcoming.from)}`
                      : ""}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="font-mono text-base font-medium tabular-nums text-ink-900">
                  {person.monthlyAmount === null ? "—" : formatMoney(person.monthlyAmount)}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setEditing({ id: person.id, name: person.name, amount: person.monthlyAmount })
                  }
                >
                  {person.monthlyAmount === null ? "Set" : "Change"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && <SalaryModal person={editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function SalaryModal({
  person,
  onClose,
}: {
  person: { id: string; name: string; amount: number | null };
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState(person.amount ? String(person.amount) : "");
  const [from, setFrom] = useState(() => `${todayISO().slice(0, 7)}-01`);
  const [note, setNote] = useState("");

  const save = useMutation(
    trpc.hr.setSalary.mutationOptions({
      onSuccess: (res) => {
        toast.success(
          res.pausedRecurring.length > 0
            ? `Saved — paused the old recurring item so pay isn't posted twice`
            : "Salary saved",
        );
        queryClient.invalidateQueries({ queryKey: trpc.hr.pathKey() });
        queryClient.invalidateQueries({ queryKey: trpc.finance.pathKey() });
        onClose();
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  return (
    <Modal
      eyebrow={person.name}
      title={person.amount === null ? "Set salary" : "Change salary"}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending || !amount || Number(amount) < 0}
            onClick={() =>
              save.mutate({
                userId: person.id,
                monthlyAmount: Number(amount),
                effectiveFrom: from,
                note: note.trim() || undefined,
              })
            }
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Monthly salary (EGP)" htmlFor="sal-amount">
          <Input
            id="sal-amount"
            type="number"
            min={0}
            className="font-mono"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field
          label="From"
          htmlFor="sal-from"
          hint="Payslips before this date keep the old figure."
        >
          <Input id="sal-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Note (optional)" htmlFor="sal-note">
          <Input
            id="sal-note"
            placeholder="Raise after the annual review"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        {amount && Number(amount) > 0 && (
          <p className="text-small text-ink-400">
            A day off costs{" "}
            <span className="font-mono text-ink-700">{formatMoney(dailyRate(Number(amount)))}</span>{" "}
            when it comes out of pay.
          </p>
        )}
      </div>
    </Modal>
  );
}
