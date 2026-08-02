import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { formatMoney } from "@mams/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorBanner, SkeletonRows } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page";
import { todayISO } from "@/lib/dates";
import { useTRPC } from "@/lib/trpc";

/** Member money screen: request on location, track what happened. */
export function ExpensesPage() {
  const trpc = useTRPC();
  const mine = useQuery(trpc.finance.myExpenses.queryOptions());
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="settle">
      <PageHeader
        eyebrow="Your spend"
        title="Expenses"
        subtitle="Paid for something on a shoot? Claim it here and Adham is notified straight away"
        actions={
          <Button onClick={() => setShowForm((v) => !v)}>
            <Plus size={16} /> Request expense
          </Button>
        }
      />

      {showForm && (
        <div className="mb-6">
          <RequestForm onDone={() => setShowForm(false)} />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>My requests</CardTitle>
        </CardHeader>
        {mine.isPending ? (
          <SkeletonRows rows={3} />
        ) : mine.isError ? (
          <CardBody>
            <ErrorBanner message="Your requests didn't load." onRetry={() => mine.refetch()} />
          </CardBody>
        ) : mine.data.length === 0 ? (
          <EmptyState
            title="Nothing claimed yet"
            hint="Rented gear, transport, props — claim it here and keep the receipt link with it."
          />
        ) : (
          <ul className="divide-y divide-rule-soft">
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
    <li className="px-5 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-lead font-medium tabular-nums text-ink-900">
              {formatMoney(exp.amount)}
            </span>
            {exp.status === "pending" && <Badge tone="now">Waiting on Adham</Badge>}
            {exp.status === "approved" && <Badge tone="done">Approved</Badge>}
            {exp.status === "rejected" && <Badge tone="late">Rejected</Badge>}
          </div>
          <p className="mt-1 text-base text-ink-700">{exp.note}</p>
          <p className="mt-0.5 text-small text-ink-400">
            {exp.categoryName}
            {exp.projectTitle ? ` · ${exp.projectTitle}` : " · General"}
            {" · "}
            <span className="font-mono">{exp.spentOn}</span>
          </p>
          {exp.status === "rejected" && exp.decisionNote && (
            <p className="mt-2 rounded-[8px] border-l-2 border-late bg-late-tint px-2.5 py-1.5 text-small text-late-ink">
              {exp.decisionNote}
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
          <Field label="Amount (EGP)" htmlFor="rq-amount">
            <Input
              id="rq-amount"
              type="number"
              inputMode="decimal"
              min={1}
              required
              className="font-mono"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Category" htmlFor="rq-cat">
            <Select
              id="rq-cat"
              required
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">Choose…</option>
              {categories.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Project (if any)" htmlFor="rq-project">
            <Select id="rq-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">General / not project-related</option>
              {projects.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.clientName} — {p.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date paid" htmlFor="rq-date">
            <Input id="rq-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="What was it for?" htmlFor="rq-note" className="sm:col-span-2">
            <Textarea
              id="rq-note"
              required
              minLength={3}
              placeholder="Rented an 85mm lens for the Kuja shoot"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <Field
            label="Receipt link (optional)"
            htmlFor="rq-receipt"
            className="sm:col-span-2"
            hint="A photo of the receipt in Drive keeps the claim airtight."
          >
            <Input
              id="rq-receipt"
              type="url"
              placeholder="https://drive.google.com/…"
              value={receiptLink}
              onChange={(e) => setReceiptLink(e.target.value)}
            />
          </Field>
          <div className="flex gap-2 sm:col-span-2">
            <Button
              type="submit"
              disabled={request.isPending || !amount || !categoryId || !note.trim()}
            >
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
