import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, ExternalLink, Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { formatMoney } from "@mams/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorBanner, SkeletonRows } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page";
import { todayISO } from "@/lib/dates";
import { useTRPC } from "@/lib/trpc";
import { BudgetBar } from "./project-detail";
import { StatTile } from "./project-ledger";

function monthRange(cursor: string) {
  const [y, m] = cursor.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${cursor}-01`, to: `${cursor}-${String(last).padStart(2, "0")}` };
}

export function MoneyPage() {
  const [cursor, setCursor] = useState(() => todayISO().slice(0, 7));
  const trpc = useTRPC();
  const { from, to } = monthRange(cursor);
  const overview = useQuery(trpc.finance.overview.queryOptions({ from, to }));

  const [y, m] = cursor.split("-").map(Number) as [number, number];
  const monthLabel = new Date(y, m - 1).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
  function shift(delta: number) {
    setCursor(new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7));
  }

  return (
    <div className="settle space-y-6">
      <PageHeader
        eyebrow="The books"
        title="Money"
        subtitle="What came in, what went out, and what's still waiting on you"
        actions={
          <div className="flex items-center overflow-hidden rounded-field border border-rule bg-surface">
            <button
              aria-label="Previous month"
              onClick={() => shift(-1)}
              className="flex size-9 items-center justify-center text-ink-400 transition-colors hover:bg-ink-50 hover:text-ink-900"
            >
              <ChevronLeft size={17} />
            </button>
            <span className="display border-x border-rule px-3.5 text-small leading-9 text-ink-800">
              {monthLabel}
            </span>
            <button
              aria-label="Next month"
              onClick={() => shift(1)}
              className="flex size-9 items-center justify-center text-ink-400 transition-colors hover:bg-ink-50 hover:text-ink-900"
            >
              <ChevronRight size={17} />
            </button>
          </div>
        }
      />

      <PendingRequestsCard />

      {overview.isPending ? (
        <Card>
          <SkeletonRows rows={4} />
        </Card>
      ) : overview.isError ? (
        <ErrorBanner message="The overview didn't load." onRetry={() => overview.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Income" value={formatMoney(overview.data.totalIncome)} />
            <StatTile label="Spend" value={formatMoney(overview.data.totalSpend)} />
            <StatTile label="Overhead" value={formatMoney(overview.data.overheadSpend)} />
            <StatTile
              label="Net"
              value={formatMoney(overview.data.totalIncome - overview.data.totalSpend)}
              tone={
                overview.data.totalIncome - overview.data.totalSpend >= 0 ? "done" : "late"
              }
            />
          </div>

          {/* items-start: a short card must not stretch to match a long one */}
          <div className="grid items-start gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Spend by category</CardTitle>
                <span className="ml-auto text-small text-ink-400">{monthLabel}</span>
              </CardHeader>
              {overview.data.spendByCategory.length === 0 ? (
                <EmptyState
                  title="No approved spend this month"
                  hint="Approved claims and recurring costs both show up here."
                />
              ) : (
                <CardBody className="space-y-3.5">
                  {overview.data.spendByCategory.map((c) => {
                    const max = overview.data.spendByCategory[0]!.total;
                    return (
                      <div key={c.name}>
                        <div className="flex justify-between gap-3">
                          <span className="text-base text-ink-700">{c.name}</span>
                          <span className="font-mono text-small font-medium tabular-nums text-ink-900">
                            {formatMoney(c.total)}
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
                          <div
                            className="h-full rounded-full bg-ink-700"
                            style={{ width: `${Math.max(4, Math.round((c.total / max) * 100))}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </CardBody>
              )}
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Project budgets</CardTitle>
                <span className="ml-auto text-small text-ink-400">Active</span>
              </CardHeader>
              {overview.data.projects.length === 0 ? (
                <EmptyState title="No active projects" hint="Budgets appear once a project runs." />
              ) : (
                <ul className="divide-y divide-rule-soft">
                  {overview.data.projects.map((p) => (
                    <li key={p.id} className="px-5 py-3.5">
                      <div className="flex justify-between gap-3">
                        <span className="min-w-0 truncate text-base text-ink-800">
                          {p.title} <span className="text-ink-400">· {p.clientName}</span>
                        </span>
                        <span className="shrink-0 font-mono text-small tabular-nums text-ink-600">
                          {formatMoney(p.spent)}
                          {p.budget ? ` / ${formatMoney(p.budget)}` : ""}
                        </span>
                      </div>
                      {p.budget ? (
                        <div className="mt-2">
                          <BudgetBar spent={p.spent} budget={p.budget} />
                        </div>
                      ) : (
                        <p className="mt-1 text-small text-ink-400">No budget set</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}

      <RecordExpenseCard />
      <RecurringCard />
    </div>
  );
}

function RecordExpenseCard() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
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
        queryClient.invalidateQueries({ queryKey: trpc.finance.pathKey() });
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>Record expense</CardTitle>
          <p className="mt-0.5 text-small text-ink-400">
            One-off costs not tied to a project — office supplies, gear bought outright. Posts as
            Overhead. For a project's costs, use that project's Ledger tab instead.
          </p>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Amount (EGP)" htmlFor="oh-amount">
            <Input
              id="oh-amount"
              type="number"
              min={0}
              className="font-mono"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Date" htmlFor="oh-date">
            <Input id="oh-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Category" htmlFor="oh-cat">
            <Select id="oh-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Choose…</option>
              {categories.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Note" htmlFor="oh-note">
          <Input
            id="oh-note"
            placeholder="Printer ink"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <Button
          size="sm"
          disabled={add.isPending || !amount || !categoryId}
          onClick={() =>
            add.mutate({
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

function PendingRequestsCard() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const pending = useQuery(trpc.finance.pendingRequests.queryOptions());
  const decide = useMutation(
    trpc.finance.decide.mutationOptions({
      onSuccess: (_, vars) => {
        toast.success(vars.approve ? "Approved" : "Rejected");
        queryClient.invalidateQueries({ queryKey: trpc.finance.pathKey() });
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  if (pending.isPending || pending.isError) return null;
  if (pending.data.length === 0) return null;

  return (
    <Card edge="now">
      <CardHeader>
        <CardTitle>Waiting on you</CardTitle>
        <Badge tone="now" className="ml-auto">
          {pending.data.length}
        </Badge>
      </CardHeader>
      <ul className="divide-y divide-rule-soft">
        {pending.data.map((req) => (
          <li key={req.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-lead font-medium tabular-nums text-ink-900">
                  {formatMoney(req.amount)}
                </span>
                <span className="text-base text-ink-700">{req.note}</span>
                {req.receiptLink && (
                  <a
                    href={req.receiptLink}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Open receipt"
                    className="text-ink-400 transition-colors hover:text-ink-900"
                  >
                    <ExternalLink size={13} />
                  </a>
                )}
              </div>
              <p className="mt-0.5 text-small text-ink-400">
                {req.requesterName} · {req.categoryName}
                {req.projectTitle ? ` · ${req.projectTitle}` : " · General"}
                {" · "}
                <span className="font-mono">{req.spentOn}</span>
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ id: req.id, approve: true })}
              >
                <Check size={14} /> Approve
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={decide.isPending}
                onClick={() => {
                  const note =
                    window.prompt("Why reject? The person who claimed it sees this.") ?? undefined;
                  decide.mutate({ id: req.id, approve: false, note });
                }}
              >
                <X size={14} /> Reject
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function RecurringCard() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const recurring = useQuery(trpc.finance.recurring.list.queryOptions());
  const categories = useQuery(trpc.finance.listCategories.queryOptions());
  const users = useQuery(trpc.users.list.queryOptions());
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [userId, setUserId] = useState("");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [day, setDay] = useState(1);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: trpc.finance.pathKey() });
  const create = useMutation(
    trpc.finance.recurring.create.mutationOptions({
      onSuccess: () => {
        toast.success("Saved — it posts itself every month.");
        setAdding(false);
        setName("");
        setAmount("");
        setUserId("");
        invalidate();
      },
      onError: (err) => toast.error(err.message),
    }),
  );
  const update = useMutation(trpc.finance.recurring.update.mutationOptions({ onSuccess: invalidate }));

  const memberName = users.data?.find((u) => u.id === userId)?.name;

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>Recurring</CardTitle>
          <p className="mt-0.5 text-small text-ink-400">
            Salaries, rent, subscriptions — posted as approved overhead on the chosen day.
          </p>
        </div>
        <Button variant="secondary" size="sm" className="ml-auto" onClick={() => setAdding((v) => !v)}>
          <Plus size={15} /> Add
        </Button>
      </CardHeader>

      {adding && (
        <CardBody className="border-b border-rule-soft bg-paper/60">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Salary for (optional)" htmlFor="rec-member">
              <Select
                id="rec-member"
                value={userId}
                onChange={(e) => {
                  setUserId(e.target.value);
                  const n = users.data?.find((u) => u.id === e.target.value)?.name;
                  if (n) setName(`Salary — ${n}`);
                }}
              >
                <option value="">Not a salary</option>
                {users.data
                  ?.filter((u) => u.active)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Name" htmlFor="rec-name">
              <Input
                id="rec-name"
                placeholder="Office rent"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Amount (EGP)" htmlFor="rec-amount">
              <Input
                id="rec-amount"
                type="number"
                min={0}
                className="font-mono"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field label="Category" htmlFor="rec-cat">
              <Select id="rec-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Choose…</option>
                {categories.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Day of month" htmlFor="rec-day">
              <Input
                id="rec-day"
                type="number"
                min={1}
                max={28}
                className="font-mono"
                value={day}
                onChange={(e) => setDay(Number(e.target.value))}
              />
            </Field>
          </div>
          <div className="mt-4">
            <Button
              size="sm"
              disabled={create.isPending || !name.trim() || !amount || !categoryId}
              onClick={() =>
                create.mutate({
                  name: name.trim(),
                  amount: Number(amount),
                  categoryId,
                  dayOfMonth: day,
                  userId: userId || undefined,
                })
              }
            >
              Save {memberName ? `salary for ${memberName}` : "recurring item"}
            </Button>
          </div>
        </CardBody>
      )}

      {recurring.isPending ? (
        <SkeletonRows rows={2} />
      ) : recurring.isError ? (
        <CardBody>
          <ErrorBanner message="Recurring items didn't load." />
        </CardBody>
      ) : recurring.data.length === 0 ? (
        <EmptyState
          title="Nothing recurring yet"
          hint="Add salaries and monthly costs once, and they post themselves from then on."
        />
      ) : (
        <ul className="divide-y divide-rule-soft">
          {recurring.data.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-base font-medium text-ink-800">{item.name}</p>
                  {!item.active && <Badge tone="neutral">Paused</Badge>}
                </div>
                <p className="text-small text-ink-400">
                  {item.categoryName} · day <span className="font-mono">{item.dayOfMonth}</span> of
                  each month
                  {item.lastPostedPeriod ? ` · last posted ${item.lastPostedPeriod}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="font-mono text-base font-medium tabular-nums text-ink-900">
                  {formatMoney(item.amount)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={update.isPending}
                  onClick={() => update.mutate({ id: item.id, active: !item.active })}
                >
                  {item.active ? "Pause" : "Resume"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
