import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { formatMoney } from "@mams/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorBanner, SkeletonRows } from "@/components/ui/feedback";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page";
import { todayISO } from "@/lib/dates";
import { useTRPC } from "@/lib/trpc";

/** Member money screen: request on location, track what happened. */
export function ExpensesPage() {
  const trpc = useTRPC();
  const mine = useQuery(trpc.finance.myExpenses.queryOptions());
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses"
        subtitle="Paid for something? Request it here — Adham gets notified instantly"
        actions={
          <Button onClick={() => setShowForm((v) => !v)}>
            <Plus size={16} /> Request expense
          </Button>
        }
      />

      {showForm && <RequestForm onDone={() => setShowForm(false)} />}

      <Card>
        <CardHeader>
          <CardTitle>My requests</CardTitle>
        </CardHeader>
        {mine.isPending ? (
          <SkeletonRows rows={3} />
        ) : mine.isError ? (
          <CardBody>
            <ErrorBanner message="Couldn't load your requests." onRetry={() => mine.refetch()} />
          </CardBody>
        ) : mine.data.length === 0 ? (
          <EmptyState
            title="No requests yet"
            hint="Rented gear, transport, props — request it and keep the receipt link."
          />
        ) : (
          <ul className="divide-y divide-gray-50">
            {mine.data.map((exp) => (
              <RequestRow key={exp.id} exp={exp} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function RequestRow({
  exp,
}: {
  exp: {
    id: string;
    amount: string;
    spentOn: string;
    note: string | null;
    status: string;
    decisionNote: string | null;
    categoryName: string;
    projectTitle: string | null;
  };
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const cancel = useMutation(
    trpc.finance.cancelMyRequest.mutationOptions({
      onSuccess: () => {
        toast.success("Request canceled");
        queryClient.invalidateQueries({ queryKey: trpc.finance.pathKey() });
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold tabular-nums text-gray-900">{formatMoney(exp.amount)}</span>
            {exp.status === "pending" && <Badge tone="amber">Waiting for Adham</Badge>}
            {exp.status === "approved" && <Badge tone="green">Approved ✓</Badge>}
            {exp.status === "rejected" && <Badge tone="red">Rejected</Badge>}
          </div>
          <p className="mt-0.5 text-sm text-gray-600">{exp.note}</p>
          <p className="text-xs text-gray-400">
            {exp.categoryName}
            {exp.projectTitle ? ` · ${exp.projectTitle}` : " · General"} · {exp.spentOn}
          </p>
          {exp.status === "rejected" && exp.decisionNote && (
            <p className="mt-1 rounded bg-red-50 px-2 py-1 text-xs text-red-700">
              “{exp.decisionNote}”
            </p>
          )}
        </div>
        {exp.status === "pending" && (
          <Button
            variant="ghost"
            size="sm"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate({ id: exp.id })}
          >
            Cancel
          </Button>
        )}
      </div>
    </li>
  );
}

function RequestForm({ onDone }: { onDone: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const categories = useQuery(trpc.finance.listCategories.queryOptions());
  const projects = useQuery(trpc.projects.list.queryOptions({ status: "active" }));

  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [receiptLink, setReceiptLink] = useState("");

  const request = useMutation(
    trpc.finance.requestExpense.mutationOptions({
      onSuccess: () => {
        toast.success("Request sent — Adham has been notified.");
        queryClient.invalidateQueries({ queryKey: trpc.finance.pathKey() });
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
            request.mutate({
              amount: Number(amount),
              categoryId,
              projectId: projectId || undefined,
              spentOn: date,
              note,
              receiptLink: receiptLink || undefined,
            });
          }}
        >
          <div>
            <Label htmlFor="rq-amount">Amount (EGP)</Label>
            <Input
              id="rq-amount"
              type="number"
              inputMode="decimal"
              min={1}
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="rq-cat">Category</Label>
            <Select id="rq-cat" required value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Choose…</option>
              {categories.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="rq-project">Project (if any)</Label>
            <Select id="rq-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">General / not project-related</option>
              {projects.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.clientName} — {p.title}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="rq-date">Date paid</Label>
            <Input id="rq-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="rq-note">What was it for?</Label>
            <Textarea
              id="rq-note"
              required
              minLength={3}
              placeholder="e.g. Rented 85mm lens for the Kuja shoot"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="rq-receipt">Receipt photo link (Drive, optional)</Label>
            <Input
              id="rq-receipt"
              type="url"
              placeholder="https://drive.google.com/…"
              value={receiptLink}
              onChange={(e) => setReceiptLink(e.target.value)}
            />
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={request.isPending || !amount || !categoryId || !note.trim()}>
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
