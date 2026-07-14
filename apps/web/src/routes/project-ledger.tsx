import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { formatMoney } from "@mams/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorBanner, SkeletonRows } from "@/components/ui/feedback";
import { Input, Label, Select } from "@/components/ui/input";
import { todayISO } from "@/lib/dates";
import { useTRPC } from "@/lib/trpc";
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
    return <ErrorBanner message="Couldn't load the ledger." onRetry={() => ledger.refetch()} />;

  const l = ledger.data;

  return (
    <div className="space-y-6">
      {/* totals */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Income" value={formatMoney(l.income)} tone="text-gray-900" />
        <StatTile label="Spent (approved)" value={formatMoney(l.spent)} tone="text-gray-900" />
        <StatTile
          label="Profit"
          value={formatMoney(l.profit)}
          tone={l.profit >= 0 ? "text-status-done" : "text-status-overdue"}
        />
        <StatTile
          label={l.budget !== null ? "Budget left" : "Pending requests"}
          value={
            l.budget !== null ? formatMoney(l.remainingBudget ?? 0) : formatMoney(l.pendingAmount)
          }
          tone={
            l.budget !== null && (l.remainingBudget ?? 0) < 0 ? "text-status-overdue" : "text-gray-900"
          }
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
          <EmptyState title="No money recorded yet" />
        ) : (
          <ul className="divide-y divide-gray-50">
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

export function StatTile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <Card>
      <CardBody className="py-3">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</p>
        <p className={`mt-1 text-lg font-semibold tabular-nums ${tone ?? "text-gray-900"}`}>{value}</p>
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
          <p className="truncate text-sm font-medium text-gray-800">{title}</p>
          {status === "pending" && <Badge tone="amber">Pending</Badge>}
          {status === "rejected" && <Badge tone="red">Rejected</Badge>}
          {receiptLink && (
            <a href={receiptLink} target="_blank" rel="noreferrer" className="text-accent-600">
              <ExternalLink size={13} />
            </a>
          )}
        </div>
        <p className="truncate text-xs text-gray-400">{sub}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span
          className={`text-sm font-semibold tabular-nums ${
            kind === "income"
              ? "text-status-done"
              : status === "rejected"
                ? "text-gray-300 line-through"
                : "text-gray-800"
          }`}
        >
          {amount}
        </span>
        <button onClick={onDelete} className="rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-500">
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
      <CardBody className="flex flex-wrap items-center gap-4">
        <div className="w-44">
          <Label htmlFor="budget">Project budget (EGP)</Label>
          <div className="flex gap-2">
            <Input
              id="budget"
              type="number"
              min={0}
              placeholder="e.g. 20000"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <Button
              variant="secondary"
              disabled={update.isPending}
              onClick={() =>
                update.mutate({ id: projectId, budget: value ? Number(value) : null })
              }
            >
              Save
            </Button>
          </div>
        </div>
        <div className="min-w-40 flex-1">
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
      <CardBody className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="inc-amount">Amount (EGP)</Label>
            <Input id="inc-amount" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="inc-date">Date</Label>
            <Input id="inc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div>
          <Label htmlFor="inc-note">Note</Label>
          <Input id="inc-note" placeholder="e.g. 50% down payment" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <Button
          size="sm"
          disabled={add.isPending || !amount}
          onClick={() =>
            add.mutate({ projectId, amount: Number(amount), receivedOn: date, note: note || undefined })
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
      <CardBody className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="exp-amount">Amount (EGP)</Label>
            <Input id="exp-amount" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="exp-date">Date</Label>
            <Input id="exp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="exp-cat">Category</Label>
            <Select id="exp-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Choose…</option>
              {categories.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="exp-note">Note</Label>
            <Input id="exp-note" placeholder="e.g. lens rental" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
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
