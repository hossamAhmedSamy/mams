import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Bell, Lock, Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorBanner, SkeletonRows } from "@/components/ui/feedback";
import { Field, Input, Label } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { SettingsTabs } from "./settings-users";

export function WorkflowsSettingsPage() {
  return (
    <div className="settle">
      <PageHeader
        eyebrow="How work moves"
        title="Workflows"
        subtitle="Build the flows your projects follow — save one once, reuse it forever"
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
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>Flows</CardTitle>
          <p className="mt-1 max-w-2xl text-small text-ink-400">
            A flow is an ordered chain of stages. New projects pick one and the chain is created for
            them — editing a flow never touches projects already running.
          </p>
        </div>
        <Button size="sm" className="ml-auto" onClick={() => setBuilding(true)}>
          <Plus size={15} /> New flow
        </Button>
      </CardHeader>

      {building && (
        <CardBody className="border-b border-rule-soft bg-paper/60">
          <FlowBuilder onDone={() => setBuilding(false)} />
        </CardBody>
      )}

      {templates.isPending ? (
        <SkeletonRows rows={3} />
      ) : templates.isError ? (
        <CardBody>
          <ErrorBanner message="Flows didn't load." onRetry={() => templates.refetch()} />
        </CardBody>
      ) : templates.data.length === 0 ? (
        <EmptyState
          title="No flows yet"
          hint="Build the chain a shoot actually follows once, and every project can reuse it."
        />
      ) : (
        <ul className="divide-y divide-rule-soft">
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
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="display text-lead text-ink-900">{tpl.name}</p>
                      {!tpl.active && <Badge tone="neutral">Hidden</Badge>}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
                      {tpl.chain.map((c, i) => (
                        <span key={c.position} className="flex items-center gap-1.5">
                          {i > 0 && <span className="text-ink-200">→</span>}
                          <Badge tone={c.requiresApproval ? "now" : "ink"}>
                            {c.stageName}
                            {c.requiresApproval && <Lock size={9} strokeWidth={3} />}
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

/**
 * The one place in the app where numbering is honest: a flow *is* a sequence,
 * and the number is the position the work will move through.
 */
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
        toast.success(`Flow "${name}" saved — projects can use it now.`);
        invalidate();
        onDone();
      },
      onError: (err) => toast.error(err.message),
    }),
  );
  const update = useMutation(
    trpc.workflows.updateTemplate.mutationOptions({
      onSuccess: () => {
        toast.success("Flow updated. Running projects are unchanged.");
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
    <div className="space-y-5">
      <Field label="Flow name" htmlFor="flow-name" className="max-w-sm">
        <Input
          id="flow-name"
          placeholder="Event coverage"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>

      <div>
        <Label>Stages, in order</Label>
        {chain.length === 0 && (
          <p className="mb-2 text-small text-ink-400">Nothing in this flow yet — add a stage below.</p>
        )}
        <ol className="space-y-2">
          {chain.map((step, i) => (
            <li
              key={i}
              className="flex items-center gap-2 rounded-field border border-rule bg-surface px-3 py-2"
            >
              <span className="w-6 shrink-0 text-center font-mono text-small tabular-nums text-ink-300">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-base font-medium text-ink-800">
                {stageName(step.stageId)}
              </span>
              <label
                className="flex shrink-0 cursor-pointer items-center gap-1.5 text-small text-ink-500"
                title="An approver must sign off before the next stage starts"
              >
                <input
                  type="checkbox"
                  className="size-4 rounded-[4px] border-rule accent-ink-900"
                  checked={step.requiresApproval}
                  onChange={(e) =>
                    setChain(
                      chain.map((s, j) =>
                        j === i ? { ...s, requiresApproval: e.target.checked } : s,
                      ),
                    )
                  }
                />
                needs approval
              </label>
              <button
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label="Move up"
                className="rounded-[6px] p-1 text-ink-400 transition-colors hover:bg-ink-50 hover:text-ink-900 disabled:opacity-25"
              >
                <ArrowUp size={14} />
              </button>
              <button
                onClick={() => move(i, 1)}
                disabled={i === chain.length - 1}
                aria-label="Move down"
                className="rounded-[6px] p-1 text-ink-400 transition-colors hover:bg-ink-50 hover:text-ink-900 disabled:opacity-25"
              >
                <ArrowDown size={14} />
              </button>
              <button
                onClick={() => setChain(chain.filter((_, j) => j !== i))}
                aria-label="Remove stage"
                className="rounded-[6px] p-1 text-ink-400 transition-colors hover:bg-late-tint hover:text-late"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ol>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {activeStages.map((s) => (
            <button
              key={s.id}
              onClick={() => setChain([...chain, { stageId: s.id, requiresApproval: false }])}
              className="rounded-full border border-dashed border-ink-200 px-3 py-1.5 text-small font-medium text-ink-500 transition-colors hover:border-ink-900 hover:text-ink-900"
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
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>Stage catalog</CardTitle>
          <p className="mt-1 max-w-2xl text-small text-ink-400">
            The building blocks of every flow: who can do a stage, and how many days it gets by
            default when it starts.
          </p>
        </div>
        <Button variant="secondary" size="sm" className="ml-auto" onClick={() => setAdding((v) => !v)}>
          <Plus size={15} /> New stage
        </Button>
      </CardHeader>

      {adding && (
        <CardBody className="border-b border-rule-soft bg-paper/60">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Stage name" htmlFor="st-name">
              <Input id="st-name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </Field>
            <Field label="Default days" htmlFor="st-days">
              <Input
                id="st-days"
                type="number"
                min={0}
                max={60}
                className="font-mono"
                value={newDays}
                onChange={(e) => setNewDays(Number(e.target.value))}
              />
            </Field>
            <Field label="Who can do it">
              <div className="flex flex-wrap gap-1.5">
                {skills.data
                  ?.filter((s) => s.active)
                  .map((s) => {
                    const on = newSkillIds.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          setNewSkillIds(
                            on ? newSkillIds.filter((x) => x !== s.id) : [...newSkillIds, s.id],
                          )
                        }
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-small font-medium transition-colors",
                          on
                            ? "border-ink-900 bg-ink-900 text-white"
                            : "border-rule bg-surface text-ink-500 hover:border-ink-300 hover:text-ink-900",
                        )}
                      >
                        {s.name}
                      </button>
                    );
                  })}
              </div>
            </Field>
          </div>
          <div className="mt-4">
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
          <ErrorBanner message="Stages didn't load." onRetry={() => stages.refetch()} />
        </CardBody>
      ) : stages.data.length === 0 ? (
        <EmptyState
          title="No stages yet"
          hint="A stage is one kind of work — “Shoot”, “Rough cut”, “Delivery”."
        />
      ) : (
        <ul className="divide-y divide-rule-soft">
          {stages.data.map((stage) => (
            <li
              key={stage.id}
              className={cn(
                "flex flex-wrap items-center justify-between gap-3 px-5 py-3.5",
                !stage.active && "opacity-60",
              )}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-base font-medium text-ink-900">{stage.name}</p>
                  {stage.reminderRule === "end_of_last_day" && (
                    <Badge tone="ink" title="Whoever holds it is reminded at 6pm on the deadline day">
                      <Bell size={9} strokeWidth={3} /> Last-day reminder
                    </Badge>
                  )}
                  {!stage.active && <Badge tone="neutral">Hidden</Badge>}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {stage.skills.length === 0 ? (
                    <span className="text-small text-ink-400">Anyone can do it</span>
                  ) : (
                    stage.skills.map((s) => <Badge key={s.id}>{s.name}</Badge>)
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  max={60}
                  aria-label={`Default days for ${stage.name}`}
                  className="w-16 text-center font-mono"
                  defaultValue={stage.defaultDurationDays}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (v !== stage.defaultDurationDays) {
                      updateStage.mutate({ id: stage.id, defaultDurationDays: v });
                    }
                  }}
                />
                <span className="text-small text-ink-400">days</span>
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
