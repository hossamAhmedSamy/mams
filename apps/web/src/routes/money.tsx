import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, ExternalLink, Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { formatMoney } from "@mams/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorBanner, SkeletonRows } from "@/components/ui/feedback";
import { Input, Label, Select } from "@/components/ui/input";
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
    <div className="space-y-6">
      <PageHeader
        title="Money"
        subtitle="Requests, budgets, and where it all goes"
        actions={
          <div className="flex items-center rounded-lg border border-gray-300 bg-white">
            <button onClick={() => shift(-1)} className="flex size-9 items-center justify-center rounded-l-lg text-gray-500 hover:bg-gray-50">
              <ChevronLeft size={17} />
            </button>
            <span className="border-x border-gray-200 px-3 text-sm font-medium text-gray-700">
              {monthLabel}
            </span>
            <button onClick={() => shift(1)} className="flex size-9 items-center justify-center rounded-r-lg text-gray-500 hover:bg-gray-50">
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
        <ErrorBanner message="Couldn't load the overview." onRetry={() => overview.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label={`Income · ${monthLabel}`} value={formatMoney(overview.data.totalIncome)} />
            <StatTile label="Spend" value={formatMoney(overview.data.totalSpend)} />
            <StatTile label="Overhead (salaries etc.)" value={formatMoney(overview.data.overheadSpend)} />
            <StatTile
              label="Net"
              value={formatMoney(overview.data.totalIncome - overview.data.totalSpend)}
              tone={
                overview.data.totalIncome - overview.data.totalSpend >= 0
                  ? "text-status-done"
                  : "text-status-overdue"
              }
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Spend by category · {monthLabel}</CardTitle>
              </CardHeader>
              {overview.data.spendByCategory.length === 0 ? (
                <EmptyState title="No approved spend this month" />
              ) : (
                <CardBody className="space-y-3">
                  {overview.data.spendByCategory.map((c) => {
                    const max = overview.data.spendByCategory[0]!.total;
                    return (
                      <div key={c.name}>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-700">{c.name}</span>
                          <span className="font-medium tabular-nums text-gray-900">
                            {formatMoney(c.total)}
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                          <div
                            className="h-full rounded-full bg-accent-500"
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
                <CardTitle>Project budgets (active)</CardTitle>
              </CardHeader>
              {overview.data.projects.length === 0 ? (
                <EmptyState title="No active projects" />
              ) : (
                <ul className="divide-y divide-gray-50">
                  {overview.data.projects.map((p) => (
                    <li key={p.id} className="px-5 py-3">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium text-gray-800">
                          {p.title} <span className="text-gray-400">· {p.clientName}</span>
                        </span>
                        <span className="tabular-nums text-gray-600">
                          {formatMoney(p.spent)}
                          {p.budget ? ` / ${formatMoney(p.budget)}` : ""}
                        </span>
                      </div>
                      {p.budget ? (
                        <div className="mt-1.5">
                          <BudgetBar spent={p.spent} budget={p.budget} />
                        </div>
                      ) : (
                        <p className="mt-1 text-xs text-gray-400">No budget set</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}

      <RecurringCard />
    </div>
  );
}

function PendingRequestsCard() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const pending = useQuery(trpc.finance.pendingRequests.queryOptions());
  const decide = useMutation(
    trpc.finance.decide.mutationOptions({
      onSuccess: (_, vars) => {
        toast.success(vars.approve ? "Approved ✓" : "Rejected");
        queryClient.invalidateQueries({ queryKey: trpc.finance.pathKey() });
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  if (pending.isPending || pending.isError) return null;
  if (pending.data.length === 0) return null;

  return (
    <Card className="border-amber-200">
      <CardHeader>
        <CardTitle>
          Requests waiting for you <Badge tone="amber">{pending.data.length}</Badge>
        </CardTitle>
      </CardHeader>
      <ul className="divide-y divide-gray-50">
        {pending.data.map((req) => (
          <li key={req.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold tabular-nums text-gray-900">
                  {formatMoney(req.amount)}
                </span>
                <span className="text-sm text-gray-600">{req.note}</span>
                {req.receiptLink && (
                  <a href={req.receiptLink} target="_blank" rel="noreferrer" className="text-accent-600">
                    <ExternalLink size={13} />
                  </a>
                )}
              </div>
              <p className="text-xs text-gray-400">
                {req.requesterName} · {req.categoryName}
                {req.projectTitle ? ` · ${req.projectTitle}` : " · General"} · {req.spentOn}
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
                  const note = window.prompt("Why reject? (optional, the member sees this)") ?? undefined;
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
        toast.success("Recurring item saved — it posts automatically every month.");
        setAdding(false);
        setName("");
        setAmount("");
        setUserId("");
        invalidate();
      },
      onError: (err) => toast.error(err.message),
    }),
  );
  const update = useMutation(
    trpc.finance.recurring.update.mutationOptions({ onSuccess: invalidate }),
  );

  const memberName = users.data?.find((u) => u.id === userId)?.name;

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <div>
          <CardTitle>Recurring · salaries, rent, subscriptions</CardTitle>
          <p className="mt-0.5 text-sm text-gray-500">
            Posted automatically as approved overhead on the chosen day, every month.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setAdding((v) => !v)}>
          <Plus size={15} /> Add
        </Button>
      </CardHeader>

      {adding && (
        <CardBody className="border-b border-gray-100 bg-slate-50/50">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <Label htmlFor="rec-member">Salary for (optional)</Label>
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
            </div>
            <div>
              <Label htmlFor="rec-name">Name</Label>
              <Input
                id="rec-name"
                placeholder='e.g. "Office rent"'
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="rec-amount">Amount (EGP)</Label>
              <Input id="rec-amount" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="rec-cat">Category</Label>
              <Select id="rec-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Choose…</option>
                {categories.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="rec-day">Day of month</Label>
              <Input
                id="rec-day"
                type="number"
                min={1}
                max={28}
                value={day}
                onChange={(e) => setDay(Number(e.target.value))}
              />
            </div>
          </div>
          <div className="mt-3">
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
          <ErrorBanner message="Couldn't load recurring items." />
        </CardBody>
      ) : recurring.data.length === 0 ? (
        <EmptyState
          title="Nothing recurring yet"
          hint="Add salaries and monthly costs so they post themselves."
        />
      ) : (
        <ul className="divide-y divide-gray-50">
          {recurring.data.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-gray-800">{item.name}</p>
                  {!item.active && <Badge tone="red">Paused</Badge>}
                </div>
                <p className="text-xs text-gray-400">
                  {item.categoryName} · day {item.dayOfMonth} of each month
                  {item.lastPostedPeriod ? ` · last posted ${item.lastPostedPeriod}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="font-semibold tabular-nums text-gray-900">
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
