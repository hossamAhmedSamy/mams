import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorBanner, SkeletonRows } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Label, Select } from "@/components/ui/input";
import { PeoplePicker } from "@/components/people-picker";
import { PriorityDot } from "@/components/task-bits";
import { AvatarStack, PageHeader } from "@/components/ui/page";
import { formatShort, todayISO } from "@/lib/dates";
import { useCan } from "@/lib/session";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export function BoardPage() {
  const trpc = useTRPC();
  const can = useCan();
  const projects = useQuery(trpc.projects.list.queryOptions({}));
  const clients = useQuery(trpc.clients.list.queryOptions());
  const [showCreate, setShowCreate] = useState(false);
  const [clientFilter, setClientFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [lateOnly, setLateOnly] = useState(false);

  const canCreate = can("projects.manage");

  const filtered = useMemo(() => {
    if (!projects.data) return [];
    return projects.data.filter(
      (p) =>
        (!clientFilter || p.clientId === clientFilter) &&
        (!statusFilter || p.status === statusFilter) &&
        (!lateOnly || p.isLate),
    );
  }, [projects.data, clientFilter, statusFilter, lateOnly]);

  return (
    <div className="settle">
      <PageHeader
        eyebrow="Every production"
        title="Projects"
        subtitle="Where each one has got to, and who is holding it"
        actions={
          canCreate && (
            <Button onClick={() => setShowCreate((v) => !v)}>
              <Plus size={16} /> New project
            </Button>
          )
        }
      />

      {showCreate && (
        <div className="mb-6">
          <CreateProjectCard onDone={() => setShowCreate(false)} />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select
          className="w-44"
          aria-label="Filter by client"
          value={clientFilter}
          onChange={(e) => setClientFilter(e.target.value)}
        >
          <option value="">All clients</option>
          {clients.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select
          className="w-40"
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="on_hold">On hold</option>
          <option value="completed">Completed</option>
          <option value="archived">Archived</option>
        </Select>
        <Checkbox
          className="ml-1"
          label="Late only"
          checked={lateOnly}
          onChange={(e) => setLateOnly(e.target.checked)}
        />
      </div>

      <Card className="overflow-hidden">
        {projects.isPending ? (
          <SkeletonRows rows={5} />
        ) : projects.isError ? (
          <CardBody>
            <ErrorBanner message="Projects didn't load." onRetry={() => projects.refetch()} />
          </CardBody>
        ) : filtered.length === 0 ? (
          <EmptyState
            title="Nothing matches those filters"
            hint={
              canCreate
                ? "Clear a filter, or start a project and its stages will appear here."
                : "Try clearing a filter."
            }
          />
        ) : (
          <>
            {/* phone: card list (quick glance on location, mid-work) */}
            <ul className="divide-y divide-rule-soft sm:hidden">
              {filtered.map((p) => (
                <li key={p.id}>
                  <Link
                    to={`/projects/${p.id}`}
                    className={cn(
                      "block px-4 py-3.5 active:bg-ink-50",
                      p.isLate && "border-l-[3px] border-l-late",
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="display truncate text-base text-ink-900">{p.title}</span>
                      {p.dueDate && (
                        <span
                          className={cn(
                            "shrink-0 font-mono text-small tabular-nums",
                            p.isLate ? "font-medium text-late" : "text-ink-400",
                          )}
                        >
                          {formatShort(p.dueDate).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-small text-ink-400">
                      {p.clientName}
                      {p.campaign ? ` · ${p.campaign}` : ""}
                    </p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                      <StageBar done={p.stagesDone} total={p.stagesTotal} late={p.isLate} />
                      {p.status === "completed" ? (
                        <Badge tone="done">Completed</Badge>
                      ) : p.currentStage ? (
                        <span className="truncate text-small text-ink-600">{p.currentStage}</span>
                      ) : null}
                      {p.currentAssignees.length > 0 && <AvatarStack names={p.currentAssignees} />}
                      <PriorityDot priority={p.priority as "high" | "medium" | "low"} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>

            {/* desktop: table */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-rule text-left">
                    {["Client / Project", "Stage", "On it", "Progress", "Due"].map((h) => (
                      <th key={h} className="eyebrow px-4 py-3 text-ink-400">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => (
                    <tr
                      key={p.id}
                      className={cn(
                        "border-b border-rule-soft transition-colors last:border-0 hover:bg-ink-50/70",
                        p.isLate && "shadow-[inset_3px_0_0_var(--color-late)]",
                      )}
                    >
                      <td className="px-4 py-3.5">
                        <Link to={`/projects/${p.id}`} className="block">
                          <span className="display text-base text-ink-900">{p.title}</span>
                          <span className="mt-0.5 flex items-center gap-2 text-small text-ink-400">
                            {p.clientName}
                            {p.campaign ? ` · ${p.campaign}` : ""}
                            <PriorityDot priority={p.priority as "high" | "medium" | "low"} />
                          </span>
                        </Link>
                      </td>
                      <td className="px-4 py-3.5">
                        {p.status === "completed" ? (
                          <Badge tone="done">Completed</Badge>
                        ) : p.currentStage ? (
                          <span className="text-base text-ink-700">{p.currentStage}</span>
                        ) : (
                          <span className="font-mono text-small text-ink-300">——</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        {p.currentAssignees.length > 0 ? (
                          <AvatarStack names={p.currentAssignees} />
                        ) : (
                          <span className="text-small text-ink-300">Unassigned</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <StageBar done={p.stagesDone} total={p.stagesTotal} late={p.isLate} />
                      </td>
                      <td className="px-4 py-3.5">
                        {p.dueDate ? (
                          <span
                            className={cn(
                              "font-mono text-small tabular-nums",
                              p.isLate ? "font-medium text-late" : "text-ink-600",
                            )}
                          >
                            {formatShort(p.dueDate).toUpperCase()}
                          </span>
                        ) : (
                          <span className="font-mono text-small text-ink-300">——</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

/**
 * Progress as the chain it actually is: one segment per stage, filled behind
 * the work, saffron on the stage that is live. "3/5" makes you do arithmetic;
 * this you just see.
 */
function StageBar({ done, total, late }: { done: number; total: number; late?: boolean }) {
  if (total <= 0) return <span className="font-mono text-small text-ink-300">——</span>;
  return (
    <span className="inline-flex items-center gap-2" title={`${done} of ${total} stages done`}>
      <span className="flex gap-0.5">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 w-3 rounded-full",
              i < done ? "bg-ink-700" : i === done ? (late ? "bg-late" : "bg-now") : "bg-ink-100",
            )}
          />
        ))}
      </span>
      <span className="font-mono text-small tabular-nums text-ink-400">
        {done}/{total}
      </span>
    </span>
  );
}

function CreateProjectCard({ onDone }: { onDone: () => void }) {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const clients = useQuery(trpc.clients.list.queryOptions());
  const templates = useQuery(trpc.workflows.listTemplates.queryOptions());

  const [clientId, setClientId] = useState("");
  const [newClientName, setNewClientName] = useState("");
  const [title, setTitle] = useState("");
  const [campaign, setCampaign] = useState("");
  const [priority, setPriority] = useState<"high" | "medium" | "low">("medium");
  const [startDate, setStartDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState("");
  const [budget, setBudget] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [firstAssigneeIds, setFirstAssigneeIds] = useState<string[]>([]);
  const [driveLink, setDriveLink] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createClient = useMutation(trpc.clients.create.mutationOptions());
  const createProject = useMutation(
    trpc.projects.create.mutationOptions({
      onSuccess: async (created) => {
        await queryClient.invalidateQueries({ queryKey: trpc.projects.pathKey() });
        await queryClient.invalidateQueries({ queryKey: trpc.clients.pathKey() });
        onDone();
        // straight into the project — the dates on this form are only the
        // outer bounds; shooting and editing still need their own deadlines
        // and assignees, which happens on the project page, not here.
        navigate(`/projects/${created.id}`);
      },
      onError: (err) => setError(err.message),
    }),
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      let cid = clientId;
      if (cid === "__new__") {
        if (!newClientName.trim()) return setError("Enter the new client's name.");
        const created = await createClient.mutateAsync({ name: newClientName.trim() });
        cid = created.id;
      }
      if (!cid) return setError("Pick a client.");
      createProject.mutate({
        clientId: cid,
        title,
        campaign: campaign || undefined,
        priority,
        dueDate: dueDate || undefined,
        driveLink: driveLink || undefined,
        budget: budget ? Number(budget) : undefined,
        workflowTemplateId: templateId || undefined,
        firstAssigneeIds,
        startDate: startDate || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  const selectedTemplate = templates.data?.find((t) => t.id === templateId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>New project</CardTitle>
      </CardHeader>
      <CardBody>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="p-client">Client</Label>
            <Select id="p-client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Choose…</option>
              {clients.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value="__new__">+ New client…</option>
            </Select>
            {clientId === "__new__" && (
              <Input
                className="mt-2"
                placeholder="New client name"
                value={newClientName}
                onChange={(e) => setNewClientName(e.target.value)}
              />
            )}
          </div>
          <Field label="Title" htmlFor="p-title" hint="What the client asked for — “18 reels”">
            <Input id="p-title" required value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Campaign (optional)" htmlFor="p-campaign">
            <Input id="p-campaign" value={campaign} onChange={(e) => setCampaign(e.target.value)} />
          </Field>
          <Field label="Priority" htmlFor="p-priority">
            <Select
              id="p-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as typeof priority)}
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts" htmlFor="p-start">
              <Input
                id="p-start"
                type="date"
                value={startDate}
                max={dueDate || undefined}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </Field>
            <Field label="Due" htmlFor="p-due">
              <Input
                id="p-due"
                type="date"
                value={dueDate}
                min={startDate || undefined}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Budget, EGP (optional)" htmlFor="p-budget">
            <Input
              id="p-budget"
              type="number"
              min={0}
              placeholder="20000"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          </Field>
          <Field label="Google Drive link (optional)" htmlFor="p-drive">
            <Input
              id="p-drive"
              type="url"
              placeholder="https://drive.google.com/…"
              value={driveLink}
              onChange={(e) => setDriveLink(e.target.value)}
            />
          </Field>
          <Field
            label="Workflow"
            htmlFor="p-template"
            hint={selectedTemplate?.chain.map((c) => c.stageName).join("  →  ")}
          >
            <Select id="p-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">No template (ad-hoc tasks)</option>
              {templates.data
                ?.filter((t) => t.active)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </Select>
          </Field>
          {templateId && (
            <Field label="Who starts the first stage" className="sm:col-span-2">
              <PeoplePicker
                selected={firstAssigneeIds}
                onChange={setFirstAssigneeIds}
                emptyHint="Leave empty and it lands in the unassigned queue."
              />
            </Field>
          )}
          {error && (
            <p className="rounded-field border-l-2 border-late bg-late-tint px-3 py-2 text-small text-late-ink sm:col-span-2">
              {error}
            </p>
          )}
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={createProject.isPending || createClient.isPending}>
              {createProject.isPending ? "Creating…" : "Create project"}
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
