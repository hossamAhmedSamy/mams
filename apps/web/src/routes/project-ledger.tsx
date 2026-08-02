import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { formatMoney } from "@mams/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorBanner, SkeletonRows } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/input";
import { Stat } from "@/components/ui/page";
import { todayISO } from "@/lib/dates";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { BudgetBar } from "./project-detail";

export function LedgerTab({ projectId }: { projectId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const ledger = useQuery(trpc.finance.projectLedger.queryOptions({ projectId }));

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: trpc.finance.pathKey() });
    queryClient.invalidateQueries({ queryKey: trpc.projects.pathKey() });
  };
  const deleteOpts = {
    onSuccess: () => {
      toast.success("Entry deleted");
      invalidate();
    },
    onError: (err: { message: string }) => toast.error(err.message),
  };
  const deleteExpense = useMutation(trpc.finance.deleteExpense.mutationOptions(deleteOpts));
  const deleteIncome = useMutation(trpc.finance.deleteIncome.mutationOptions(deleteOpts));
  const confirmDelete = (fn: () => void) => {
    if (window.confirm("Delete this entry?")) fn();
  };

  if (ledger.isPending)
    return (
      <Card>
        <SkeletonRows rows={4} />
      </Card>
    );
  if (ledger.isError)
    return <ErrorBanner message="The ledger didn't load." onRetry={() => ledger.refetch()} />;

  const l = ledger.data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Income" value={formatMoney(l.income)} />
        <StatTile label="Spent (approved)" value={formatMoney(l.spent)} />
        <StatTile
          label="Profit"
          value={formatMoney(l.profit)}
          tone={l.profit >= 0 ? "done" : "late"}
        />
        <StatTile
          label={l.budget !== null ? "Budget left" : "Pending requests"}
          value={
            l.budget !== null ? formatMoney(l.remainingBudget ?? 0) : formatMoney(l.pendingAmount)
          }
          tone={l.budget !== null && (l.remainingBudget ?? 0) < 0 ? "late" : "neutral"}
        />
      </div>

      <BudgetCard projectId={projectId} budget={l.budget} spent={l.spent} onChanged={invalidate} />

      <div className="grid gap-6 lg:grid-cols-2">
        <AddIncomeCard projectId={projectId} onAdded={invalidate} />
        <AddExpenseCard projectId={projectId} onAdded={invalidate} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Entries</CardTitle>
        </CardHeader>
        {l.expenses.length === 0 && l.incomes.length === 0 ? (
          <EmptyState
            title="No money recorded yet"
            hint="Income and approved spend on this project both land here."
          />
        ) : (
          <ul className="divide-y divide-rule-soft">
            {l.incomes.map((inc) => (
              <LedgerRow
                key={`i-${inc.id}`}
                kind="income"
                title={inc.note || "Income"}
                sub={inc.receivedOn}
                amount={`+${formatMoney(inc.amount)}`}
                onDelete={() => confirmDelete(() => deleteIncome.mutate({ id: inc.id }))}
              />
            ))}
            {l.expenses.map((exp) => (
              <LedgerRow
                key={`e-${exp.id}`}
                kind="expense"
                title={exp.note || exp.categoryName}
                sub={`${exp.categoryName} · ${exp.spentOn}${exp.requesterName ? ` · ${exp.requesterName}` : ""}`}
                amount={`−${formatMoney(exp.amount)}`}
                status={exp.status as "pending" | "approved" | "rejected"}
                receiptLink={exp.receiptLink}
                onDelete={() => confirmDelete(() => deleteExpense.mutate({ id: exp.id }))}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export function StatTile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "late" | "now" | "done";
}) {
  return (
    <Card>
      <CardBody className="py-3.5">
        <Stat label={label} value={value} tone={tone} />
      </CardBody>
    </Card>
  );
}

function LedgerRow({
  kind,
  title,
  sub,
  amount,
  status,
  receiptLink,
  onDelete,
}: {
  kind: "income" | "expense";
  title: string;
  sub: string;
  amount: string;
  status?: "pending" | "approved" | "rejected";
  receiptLink?: string | null;
  onDelete: () => void;
}) {
  return (
    <li className="flex items-center justify-between gap-3 px-5 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate text-base font-medium text-ink-800">{title}</p>
          {status === "pending" && <Badge tone="now">Pending</Badge>}
          {status === "rejected" && <Badge tone="late">Rejected</Badge>}
          {receiptLink && (
            <a
              href={receiptLink}
              target="_blank"
              rel="noreferrer"
              aria-label="Open receipt"
              className="text-ink-400 transition-colors hover:text-ink-900"
            >
              <ExternalLink size={13} />
            </a>
          )}
        </div>
        <p className="truncate text-small text-ink-400">{sub}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span
          className={cn(
            "font-mono text-base font-medium tabular-nums",
            kind === "income"
              ? "text-done"
              : status === "rejected"
                ? "text-ink-200 line-through"
                : "text-ink-800",
          )}
        >
          {amount}
        </span>
        <button
          onClick={onDelete}
          aria-label="Delete entry"
          className="rounded-[6px] p-1 text-ink-300 transition-colors hover:bg-late-tint hover:text-late"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </li>
  );
}

function BudgetCard({
  projectId,
  budget,
  spent,
  onChanged,
}: {
  projectId: string;
  budget: number | null;
  spent: number;
  onChanged: () => void;
}) {
  const trpc = useTRPC();
  const [value, setValue] = useState(budget?.toString() ?? "");
  const update = useMutation(
    trpc.projects.update.mutationOptions({
      onSuccess: () => {
        toast.success("Budget saved");
        onChanged();
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  return (
    <Card>
      <CardBody className="flex flex-wrap items-end gap-5">
        <Field label="Project budget (EGP)" htmlFor="budget" className="w-52">
          <div className="flex gap-2">
            <Input
              id="budget"
              type="number"
              min={0}
              placeholder="20000"
              className="font-mono"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <Button
              variant="secondary"
              disabled={update.isPending}
              onClick={() => update.mutate({ id: projectId, budget: value ? Number(value) : null })}
            >
              Save
            </Button>
          </div>
        </Field>
        <div className="min-w-40 flex-1 pb-1">
          <BudgetBar spent={spent} budget={budget} />
        </div>
      </CardBody>
    </Card>
  );
}

function AddIncomeCard({ projectId, onAdded }: { projectId: string; onAdded: () => void }) {
  const trpc = useTRPC();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const add = useMutation(
    trpc.finance.addIncome.mutationOptions({
      onSuccess: () => {
        toast.success("Income recorded");
        setAmount("");
        setNote("");
        onAdded();
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Record income</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (EGP)" htmlFor="inc-amount">
            <Input
              id="inc-amount"
              type="number"
              min={0}
              className="font-mono"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Date" htmlFor="inc-date">
            <Input id="inc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Note" htmlFor="inc-note">
          <Input
            id="inc-note"
            placeholder="50% down payment"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <Button
          size="sm"
          disabled={add.isPending || !amount}
          onClick={() =>
            add.mutate({
              projectId,
              amount: Number(amount),
              receivedOn: date,
              note: note || undefined,
            })
          }
        >
          Add income
        </Button>
      </CardBody>
    </Card>
  );
}

function AddExpenseCard({ projectId, onAdded }: { projectId: string; onAdded: () => void }) {
  const trpc = useTRPC();
  const categories = useQuery(trpc.finance.listCategories.queryOptions());
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [categoryId, setCategoryId] = useState("");
  const [note, setNote] = useState("");
  const add = useMutation(
    trpc.finance.addExpense.mutationOptions({
      onSuccess: () => {
        toast.success("Expense recorded");
        setAmount("");
        setNote("");
        onAdded();
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Record expense</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (EGP)" htmlFor="exp-amount">
            <Input
              id="exp-amount"
              type="number"
              min={0}
              className="font-mono"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Date" htmlFor="exp-date">
            <Input id="exp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category" htmlFor="exp-cat">
            <Select id="exp-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Choose…</option>
              {categories.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Note" htmlFor="exp-note">
            <Input
              id="exp-note"
              placeholder="Lens rental"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </div>
        <Button
          size="sm"
          disabled={add.isPending || !amount || !categoryId}
          onClick={() =>
            add.mutate({
              projectId,
              categoryId,
              amount: Number(amount),
              spentOn: date,
              note: note || undefined,
            })
          }
        >
          Add expense
        </Button>
      </CardBody>
    </Card>
  );
}
