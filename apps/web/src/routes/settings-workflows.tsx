import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorBanner, SkeletonRows } from "@/components/ui/feedback";
import { Input, Label, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page";
import { useTRPC } from "@/lib/trpc";
import { SettingsTabs } from "./settings-users";

export function WorkflowsSettingsPage() {
  return (
    <div>
      <PageHeader
        title="Workflows"
        subtitle="Build the flows your projects follow — save them once, reuse forever"
      />
      <SettingsTabs current="workflows" />
      <div className="mt-6 space-y-6">
        <TemplatesCard />
        <StageCatalogCard />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flow templates
// ---------------------------------------------------------------------------

function TemplatesCard() {
  const trpc = useTRPC();
  const templates = useQuery(trpc.workflows.listTemplates.queryOptions());
  const [building, setBuilding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <div>
          <CardTitle>Flows</CardTitle>
          <p className="mt-0.5 text-sm text-gray-500">
            A flow is an ordered chain of stages. New projects pick one and the chain is created
            automatically — editing a flow never changes projects already running.
          </p>
        </div>
        <Button size="sm" onClick={() => setBuilding(true)}>
          <Plus size={15} /> New flow
        </Button>
      </CardHeader>

      {building && (
        <CardBody className="border-b border-gray-100 bg-slate-50/50">
          <FlowBuilder onDone={() => setBuilding(false)} />
        </CardBody>
      )}

      {templates.isPending ? (
        <SkeletonRows rows={3} />
      ) : templates.isError ? (
        <CardBody>
          <ErrorBanner message="Couldn't load flows." onRetry={() => templates.refetch()} />
        </CardBody>
      ) : (
        <ul className="divide-y divide-gray-100">
          {templates.data.map((tpl) => (
            <li key={tpl.id} className="px-5 py-4">
              {editingId === tpl.id ? (
                <FlowBuilder
                  existing={{
                    id: tpl.id,
                    name: tpl.name,
                    chain: tpl.chain.map((c) => ({
                      stageId: c.stageId,
                      requiresApproval: c.requiresApproval,
                    })),
                  }}
                  onDone={() => setEditingId(null)}
                />
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-gray-900">{tpl.name}</p>
                      {!tpl.active && <Badge tone="red">Hidden</Badge>}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {tpl.chain.map((c, i) => (
                        <span key={c.position} className="flex items-center gap-1.5">
                          {i > 0 && <span className="text-gray-300">→</span>}
                          <Badge tone={c.requiresApproval ? "amber" : "gray"}>
                            {c.stageName}
                            {c.requiresApproval ? " 🔒" : ""}
                          </Badge>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setEditingId(tpl.id)}>
                      Edit
                    </Button>
                    <ToggleTemplateButton id={tpl.id} active={tpl.active} />
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ToggleTemplateButton({ id, active }: { id: string; active: boolean }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const toggle = useMutation(
    trpc.workflows.setTemplateActive.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.workflows.pathKey() }),
    }),
  );
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={toggle.isPending}
      onClick={() => toggle.mutate({ id, active: !active })}
    >
      {active ? "Hide" : "Show"}
    </Button>
  );
}

function FlowBuilder({
  existing,
  onDone,
}: {
  existing?: { id: string; name: string; chain: { stageId: string; requiresApproval: boolean }[] };
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const stages = useQuery(trpc.workflows.listStages.queryOptions());
  const [name, setName] = useState(existing?.name ?? "");
  const [chain, setChain] = useState(existing?.chain ?? []);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: trpc.workflows.pathKey() });
  const create = useMutation(
    trpc.workflows.createTemplate.mutationOptions({
      onSuccess: () => {
        toast.success(`Flow "${name}" saved — it's now available when creating projects.`);
        invalidate();
        onDone();
      },
      onError: (err) => toast.error(err.message),
    }),
  );
  const update = useMutation(
    trpc.workflows.updateTemplate.mutationOptions({
      onSuccess: () => {
        toast.success("Flow updated (running projects are unchanged).");
        invalidate();
        onDone();
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  const activeStages = stages.data?.filter((s) => s.active) ?? [];
  const stageName = (id: string) => stages.data?.find((s) => s.id === id)?.name ?? "?";

  function move(index: number, delta: number) {
    const next = [...chain];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    setChain(next);
  }

  function save() {
    if (!name.trim()) return toast.error("Give the flow a name.");
    if (chain.length === 0) return toast.error("Add at least one stage.");
    if (existing) update.mutate({ id: existing.id, name: name.trim(), chain });
    else create.mutate({ name: name.trim(), chain });
  }

  return (
    <div className="space-y-4">
      <div className="max-w-sm">
        <Label htmlFor="flow-name">Flow name</Label>
        <Input
          id="flow-name"
          placeholder='e.g. "Event coverage"'
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div>
        <Label>Stages, in order</Label>
        {chain.length === 0 && (
          <p className="mb-2 text-sm text-gray-400">No stages yet — add the first one below.</p>
        )}
        <ol className="space-y-2">
          {chain.map((step, i) => (
            <li key={i} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
              <span className="w-6 text-center text-xs font-bold text-gray-400">{i + 1}</span>
              <span className="flex-1 text-sm font-medium text-gray-800">{stageName(step.stageId)}</span>
              <label className="flex items-center gap-1.5 text-xs text-gray-500" title="Adham must approve before the next stage starts">
                <input
                  type="checkbox"
                  className="size-3.5 accent-accent-600"
                  checked={step.requiresApproval}
                  onChange={(e) =>
                    setChain(chain.map((s, j) => (j === i ? { ...s, requiresApproval: e.target.checked } : s)))
                  }
                />
                needs approval
              </label>
              <button onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1 text-gray-400 hover:bg-gray-100 disabled:opacity-30">
                <ArrowUp size={14} />
              </button>
              <button onClick={() => move(i, 1)} disabled={i === chain.length - 1} className="rounded p-1 text-gray-400 hover:bg-gray-100 disabled:opacity-30">
                <ArrowDown size={14} />
              </button>
              <button onClick={() => setChain(chain.filter((_, j) => j !== i))} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500">
                <X size={14} />
              </button>
            </li>
          ))}
        </ol>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {activeStages.map((s) => (
            <button
              key={s.id}
              onClick={() => setChain([...chain, { stageId: s.id, requiresApproval: false }])}
              className="rounded-full border border-dashed border-gray-300 px-3 py-1 text-xs font-medium text-gray-500 hover:border-accent-500 hover:bg-accent-50 hover:text-accent-700"
            >
              + {s.name}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <Button onClick={save} disabled={create.isPending || update.isPending}>
          {existing ? "Save changes" : "Save flow"}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stage catalog
// ---------------------------------------------------------------------------

function StageCatalogCard() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const stages = useQuery(trpc.workflows.listStages.queryOptions());
  const skills = useQuery(trpc.skills.list.queryOptions());
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDays, setNewDays] = useState(3);
  const [newSkillIds, setNewSkillIds] = useState<string[]>([]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: trpc.workflows.pathKey() });
  const createStage = useMutation(
    trpc.workflows.createStage.mutationOptions({
      onSuccess: () => {
        toast.success(`Stage "${newName}" added.`);
        setAdding(false);
        setNewName("");
        setNewSkillIds([]);
        invalidate();
      },
      onError: (err) => toast.error(err.message),
    }),
  );
  const updateStage = useMutation(
    trpc.workflows.updateStage.mutationOptions({
      onSuccess: invalidate,
      onError: (err) => toast.error(err.message),
    }),
  );

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <div>
          <CardTitle>Stage catalog</CardTitle>
          <p className="mt-0.5 text-sm text-gray-500">
            The building blocks of every flow: who can do a stage, and how many days it gets by
            default when it starts.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setAdding((v) => !v)}>
          <Plus size={15} /> New stage
        </Button>
      </CardHeader>

      {adding && (
        <CardBody className="border-b border-gray-100 bg-slate-50/50">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="st-name">Stage name</Label>
              <Input id="st-name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="st-days">Default days</Label>
              <Input
                id="st-days"
                type="number"
                min={0}
                max={60}
                value={newDays}
                onChange={(e) => setNewDays(Number(e.target.value))}
              />
            </div>
            <div>
              <Label>Who can do it</Label>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {skills.data
                  ?.filter((s) => s.active)
                  .map((s) => {
                    const on = newSkillIds.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        onClick={() =>
                          setNewSkillIds(on ? newSkillIds.filter((x) => x !== s.id) : [...newSkillIds, s.id])
                        }
                        className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                          on
                            ? "border-accent-600 bg-accent-50 text-accent-700"
                            : "border-gray-300 bg-white text-gray-500"
                        }`}
                      >
                        {s.name}
                      </button>
                    );
                  })}
              </div>
            </div>
          </div>
          <div className="mt-3">
            <Button
              size="sm"
              disabled={createStage.isPending || !newName.trim()}
              onClick={() =>
                createStage.mutate({
                  name: newName.trim(),
                  defaultDurationDays: newDays,
                  skillIds: newSkillIds,
                })
              }
            >
              Add stage
            </Button>
          </div>
        </CardBody>
      )}

      {stages.isPending ? (
        <SkeletonRows rows={4} />
      ) : stages.isError ? (
        <CardBody>
          <ErrorBanner message="Couldn't load stages." onRetry={() => stages.refetch()} />
        </CardBody>
      ) : stages.data.length === 0 ? (
        <EmptyState title="No stages yet" />
      ) : (
        <ul className="divide-y divide-gray-100">
          {stages.data.map((stage) => (
            <li key={stage.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-gray-900">{stage.name}</p>
                  {stage.reminderRule === "end_of_last_day" && (
                    <Badge tone="blue" title="Assignee gets a reminder at 6pm on the deadline day">
                      ⏰ last-day reminder
                    </Badge>
                  )}
                  {!stage.active && <Badge tone="red">Hidden</Badge>}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {stage.skills.length === 0 ? (
                    <span className="text-xs text-gray-400">Anyone</span>
                  ) : (
                    stage.skills.map((s) => <Badge key={s.id}>{s.name}</Badge>)
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-sm text-gray-500">
                <Input
                  type="number"
                  min={0}
                  max={60}
                  className="w-16 text-center"
                  defaultValue={stage.defaultDurationDays}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (v !== stage.defaultDurationDays) {
                      updateStage.mutate({ id: stage.id, defaultDurationDays: v });
                    }
                  }}
                />
                <span className="text-xs">days</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => updateStage.mutate({ id: stage.id, active: !stage.active })}
                >
                  {stage.active ? "Hide" : "Show"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
