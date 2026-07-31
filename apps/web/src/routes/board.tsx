import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorBanner, SkeletonRows } from "@/components/ui/feedback";
import { Input, Label, Select } from "@/components/ui/input";
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
    <div className="space-y-6">
      <PageHeader
        title="Projects"
        subtitle="Where everything stands"
        actions={
          canCreate && (
            <Button onClick={() => setShowCreate((v) => !v)}>
              <Plus size={16} /> New project
            </Button>
          )
        }
      />

      {showCreate && <CreateProjectCard onDone={() => setShowCreate(false)} />}

      <div className="flex flex-wrap items-center gap-2">
        <Select
          className="w-44"
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
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="on_hold">On hold</option>
          <option value="completed">Completed</option>
          <option value="archived">Archived</option>
        </Select>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={lateOnly}
            onChange={(e) => setLateOnly(e.target.checked)}
            className="size-4 accent-red-600"
          />
          Late only
        </label>
      </div>

      <Card>
        {projects.isPending ? (
          <SkeletonRows rows={5} />
        ) : projects.isError ? (
          <CardBody>
            <ErrorBanner message="Couldn't load projects." onRetry={() => projects.refetch()} />
          </CardBody>
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No projects match"
            hint={canCreate ? "Create your first project to get the board moving." : "Nothing here yet."}
          />
        ) : (
          <>
          {/* phone: card list (quick glance on location, mid-work) */}
          <ul className="divide-y divide-gray-100 sm:hidden">
            {filtered.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/projects/${p.id}`}
                  className={cn("block px-4 py-3 active:bg-gray-50", p.isLate && "border-l-[3px] border-red-500")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-gray-900">{p.title}</span>
                    {p.dueDate && (
                      <span className={cn("shrink-0 text-xs", p.isLate ? "font-semibold text-red-600" : "text-gray-400")}>
                        {formatShort(p.dueDate)}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {p.clientName}
                    {p.campaign ? ` · ${p.campaign}` : ""}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <PriorityDot priority={p.priority as "high" | "medium" | "low"} />
                    {p.status === "completed" ? (
                      <Badge tone="green">Completed</Badge>
                    ) : p.currentStage ? (
                      <Badge tone="accent">{p.currentStage}</Badge>
                    ) : null}
                    <span className="text-xs text-gray-400">
                      {p.stagesTotal > 0 ? `${p.stagesDone}/${p.stagesTotal} stages` : ""}
                      {p.currentAssignees.length > 0 ? ` · ${p.currentAssignees.join(", ")}` : ""}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          {/* desktop: table */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="px-4 py-3">Client / Project</th>
                  <th className="px-4 py-3">Priority</th>
                  <th className="px-4 py-3">Stage</th>
                  <th className="px-4 py-3">On it</th>
                  <th className="px-4 py-3">Progress</th>
                  <th className="px-4 py-3">Due</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr
                    key={p.id}
                    className={`border-b border-gray-50 hover:bg-gray-50 ${p.isLate ? "shadow-[inset_3px_0_0_theme(colors.red.500)]" : ""}`}
                  >
                    <td className="px-4 py-3">
                      <Link to={`/projects/${p.id}`} className="block">
                        <span className="font-medium text-gray-900">{p.title}</span>
                        <span className="block text-xs text-gray-500">
                          {p.clientName}
                          {p.campaign ? ` · ${p.campaign}` : ""}
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <PriorityDot priority={p.priority as "high" | "medium" | "low"} />
                    </td>
                    <td className="px-4 py-3">
                      {p.status === "completed" ? (
                        <Badge tone="green">Completed</Badge>
                      ) : p.currentStage ? (
                        <Badge tone="accent">{p.currentStage}</Badge>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {p.currentAssignees.length > 0 ? (
                        <AvatarStack names={p.currentAssignees} />
                      ) : (
                        <span className="text-xs text-gray-400">Unassigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {p.stagesTotal > 0 ? `${p.stagesDone}/${p.stagesTotal}` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {p.dueDate ? (
                        <span className={p.isLate ? "font-medium text-red-600" : "text-gray-600"}>
                          {formatShort(p.dueDate)}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
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

function CreateProjectCard({ onDone }: { onDone: () => void }) {
  const trpc = useTRPC();
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
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: trpc.projects.pathKey() });
        await queryClient.invalidateQueries({ queryKey: trpc.clients.pathKey() });
        onDone();
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
          <div>
            <Label htmlFor="p-title">Title (e.g. “18 reels”)</Label>
            <Input id="p-title" required value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="p-campaign">Campaign (optional)</Label>
            <Input id="p-campaign" value={campaign} onChange={(e) => setCampaign(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="p-priority">Priority</Label>
            <Select
              id="p-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as typeof priority)}
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="p-start">Start date</Label>
              <Input
                id="p-start"
                type="date"
                value={startDate}
                max={dueDate || undefined}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="p-due">Due date</Label>
              <Input
                id="p-due"
                type="date"
                value={dueDate}
                min={startDate || undefined}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="p-budget">Budget (EGP, optional)</Label>
            <Input
              id="p-budget"
              type="number"
              min={0}
              placeholder="e.g. 20000"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="p-drive">Google Drive link (optional)</Label>
            <Input
              id="p-drive"
              type="url"
              placeholder="https://drive.google.com/…"
              value={driveLink}
              onChange={(e) => setDriveLink(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="p-template">Workflow</Label>
            <Select
              id="p-template"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              <option value="">No template (ad-hoc tasks)</option>
              {templates.data
                ?.filter((t) => t.active)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </Select>
            {selectedTemplate && (
              <p className="mt-1 text-xs text-gray-500">
                {selectedTemplate.chain.map((c) => c.stageName).join(" → ")}
              </p>
            )}
          </div>
          {templateId && (
            <div className="sm:col-span-2">
              <Label>Who starts the first stage</Label>
              <PeoplePicker
                selected={firstAssigneeIds}
                onChange={setFirstAssigneeIds}
                emptyHint="Leave empty and it lands in the unassigned queue."
              />
            </div>
          )}
          {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
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
