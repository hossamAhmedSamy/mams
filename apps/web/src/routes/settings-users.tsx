import { PERMISSION_GROUPS, type Permission } from "@mams/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, ShieldCheck, UserPlus } from "lucide-react";
import { useState } from "react";
import { NavLink } from "react-router";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorBanner, SkeletonRows } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/input";
import { Avatar, PageHeader } from "@/components/ui/page";
import { useMe } from "@/lib/session";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export function SettingsTabs({ current }: { current: "team" | "workflows" }) {
  const tabs = [
    { key: "team", label: "Team", to: "/settings/users" },
    { key: "workflows", label: "Workflows", to: "/settings/workflows" },
  ] as const;
  return (
    <div className="flex gap-1 border-b border-rule">
      {tabs.map((t) => (
        <NavLink
          key={t.key}
          to={t.to}
          className={cn(
            "-mb-px border-b-2 px-4 py-2.5 text-base transition-colors",
            current === t.key
              ? "border-ink-900 font-medium text-ink-900"
              : "border-transparent text-ink-400 hover:text-ink-700",
          )}
        >
          {t.label}
        </NavLink>
      ))}
    </div>
  );
}

export function UsersSettingsPage() {
  const trpc = useTRPC();
  const me = useMe();
  const users = useQuery(trpc.users.list.queryOptions());
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="settle">
      <PageHeader
        eyebrow="Who's on the team"
        title="Settings"
        subtitle="Accounts, skills, and what each person is allowed to do"
        actions={
          <Button onClick={() => setShowCreate(true)}>
            <UserPlus size={16} /> Add member
          </Button>
        }
      />
      <SettingsTabs current="team" />
      <div className="mt-6 space-y-6">
        {showCreate && <CreateUserCard onDone={() => setShowCreate(false)} />}

        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
          </CardHeader>
          {users.isPending ? (
            <SkeletonRows rows={4} />
          ) : users.isError ? (
            <CardBody>
              <ErrorBanner message="The team didn't load." onRetry={() => users.refetch()} />
            </CardBody>
          ) : users.data.length === 0 ? (
            <EmptyState
              title="No members yet"
              hint="Add someone and they'll get a temporary password to change on first sign-in."
            />
          ) : (
            <ul className="divide-y divide-rule-soft">
              {users.data.map((u) => (
                <UserRow key={u.id} user={u} isSelf={u.id === me.data?.id} />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

type UserItem = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "member";
  active: boolean;
  mustChangePassword: boolean;
  skills: { id: string; name: string }[];
  permissions: Permission[];
};

function UserRow({ user, isSelf }: { user: UserItem; isSelf: boolean }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [panel, setPanel] = useState<"skills" | "permissions" | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: trpc.users.list.queryKey() });
  const setActive = useMutation(
    trpc.users.setActive.mutationOptions({
      onSuccess: invalidate,
      onError: (err) => toast.error(err.message),
    }),
  );

  function toggle(next: "skills" | "permissions") {
    setPanel((p) => (p === next ? null : next));
  }

  return (
    <li className={cn("px-5 py-4", !user.active && "opacity-60")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Avatar name={user.name} size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="display truncate text-lead text-ink-900">{user.name}</p>
              {user.role === "admin" && <Badge tone="ink">Admin · full access</Badge>}
              {!user.active && <Badge tone="neutral">Inactive</Badge>}
              {user.mustChangePassword && user.active && <Badge tone="now">Temp password</Badge>}
            </div>
            <p className="truncate text-small text-ink-400">{user.email}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {user.skills.length === 0 ? (
                <span className="text-small text-ink-400">No skills set</span>
              ) : (
                user.skills.map((s) => <Badge key={s.id}>{s.name}</Badge>)
              )}
              {user.role !== "admin" && (
                <span className="ml-1 inline-flex items-center gap-1 text-small text-ink-400">
                  <ShieldCheck size={12} />
                  {user.permissions.length === 0
                    ? "Own work only"
                    : `${user.permissions.length} permission${user.permissions.length === 1 ? "" : "s"}`}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => toggle("skills")}>
            Skills
          </Button>
          {user.role !== "admin" && (
            <Button variant="secondary" size="sm" onClick={() => toggle("permissions")}>
              Permissions
            </Button>
          )}
          {!isSelf && (
            <Button
              variant="secondary"
              size="sm"
              disabled={setActive.isPending}
              onClick={() => setActive.mutate({ id: user.id, active: !user.active })}
            >
              {user.active ? "Deactivate" : "Activate"}
            </Button>
          )}
        </div>
      </div>
      {panel === "skills" && (
        <SkillsEditor
          userId={user.id}
          current={user.skills.map((s) => s.id)}
          onDone={() => {
            setPanel(null);
            invalidate();
          }}
        />
      )}
      {panel === "permissions" && (
        <PermissionsEditor
          userId={user.id}
          current={user.permissions}
          onDone={() => {
            setPanel(null);
            invalidate();
          }}
        />
      )}
    </li>
  );
}

/**
 * Authorization is per person (owner request): tick exactly what this member
 * may do. Everything untouched stays "their own work only".
 */
function PermissionsEditor({
  userId,
  current,
  onDone,
}: {
  userId: string;
  current: Permission[];
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const [selected, setSelected] = useState<Permission[]>(current);
  const save = useMutation(
    trpc.users.setPermissions.mutationOptions({
      onSuccess: () => {
        toast.success("Permissions updated");
        onDone();
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  function toggle(key: Permission) {
    setSelected((prev) => (prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]));
  }

  return (
    <div className="mt-4 rounded-card border border-rule bg-paper/70 p-4">
      <div className="grid gap-6 sm:grid-cols-3">
        {PERMISSION_GROUPS.map((group) => (
          <div key={group.title}>
            <p className="eyebrow mb-2.5 text-ink-400">{group.title}</p>
            <div className="space-y-2.5">
              {group.items.map((item) => (
                <label key={item.key} className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={selected.includes(item.key)}
                    onChange={() => toggle(item.key)}
                    className="mt-0.5 size-4.5 shrink-0 rounded-[5px] border-rule accent-ink-900"
                  />
                  <span>
                    <span className="block text-base font-medium text-ink-800">{item.label}</span>
                    <span className="block text-small leading-snug text-ink-400">{item.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 flex gap-2">
        <Button
          size="sm"
          disabled={save.isPending}
          onClick={() => save.mutate({ id: userId, permissions: selected })}
        >
          {save.isPending ? "Saving…" : "Save permissions"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function SkillsEditor({
  userId,
  current,
  onDone,
}: {
  userId: string;
  current: string[];
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const skills = useQuery(trpc.skills.list.queryOptions());
  const [selected, setSelected] = useState<string[]>(current);
  const save = useMutation(trpc.users.setSkills.mutationOptions({ onSuccess: onDone }));

  if (skills.isPending) return <SkeletonRows rows={1} />;
  if (skills.isError) return <ErrorBanner message="Skills didn't load." />;

  return (
    <div className="mt-4 rounded-card border border-rule bg-paper/70 p-4">
      <p className="mb-3 text-small text-ink-500">
        Skills decide who a stage can be handed to automatically.
      </p>
      <div className="flex flex-wrap gap-2">
        {skills.data
          .filter((s) => s.active)
          .map((s) => {
            const on = selected.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setSelected((prev) => (on ? prev.filter((x) => x !== s.id) : [...prev, s.id]))
                }
                className={cn(
                  "rounded-full border px-3 py-1.5 text-small font-medium transition-colors",
                  on
                    ? "border-ink-900 bg-ink-900 text-white"
                    : "border-rule bg-surface text-ink-600 hover:border-ink-300 hover:text-ink-900",
                )}
              >
                {s.name}
              </button>
            );
          })}
      </div>
      <div className="mt-4 flex gap-2">
        <Button
          size="sm"
          disabled={save.isPending}
          onClick={() => save.mutate({ id: userId, skillIds: selected })}
        >
          Save skills
        </Button>
        <Button variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function CreateUserCard({ onDone }: { onDone: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [tempPassword, setTempPassword] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation(
    trpc.users.create.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: trpc.users.list.queryKey() });
        onDone();
      },
      onError: (err) => setError(err.message),
    }),
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    create.mutate({ name, email, tempPassword, role, skillIds: [], permissions });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New member</CardTitle>
      </CardHeader>
      <CardBody>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="new-name">
            <Input id="new-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Email" htmlFor="new-email">
            <Input
              id="new-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field
            label="Temp password"
            htmlFor="new-temp"
            hint="They're asked to change it the first time they sign in."
          >
            <Input
              id="new-temp"
              required
              minLength={10}
              value={tempPassword}
              onChange={(e) => setTempPassword(e.target.value)}
            />
          </Field>
          <Field label="Role" htmlFor="new-role">
            <Select
              id="new-role"
              value={role}
              onChange={(e) => setRole(e.target.value as "admin" | "member")}
            >
              <option value="member">Member</option>
              <option value="admin">Admin (everything)</option>
            </Select>
          </Field>
          {role === "member" && (
            <fieldset className="sm:col-span-2">
              <legend className="eyebrow mb-2.5 flex items-center gap-1.5 text-ink-400">
                <KeyRound size={13} /> What they can do
              </legend>
              <div className="grid gap-5 rounded-card border border-rule bg-paper/70 p-4 sm:grid-cols-3">
                {PERMISSION_GROUPS.map((group) => (
                  <div key={group.title}>
                    <p className="eyebrow mb-2 text-ink-400">{group.title}</p>
                    <div className="space-y-2">
                      {group.items.map((item) => (
                        <label key={item.key} className="flex cursor-pointer items-center gap-2.5">
                          <input
                            type="checkbox"
                            checked={permissions.includes(item.key)}
                            onChange={() =>
                              setPermissions((prev) =>
                                prev.includes(item.key)
                                  ? prev.filter((p) => p !== item.key)
                                  : [...prev, item.key],
                              )
                            }
                            className="size-4.5 shrink-0 rounded-[5px] border-rule accent-ink-900"
                          />
                          <span className="text-base text-ink-700">{item.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </fieldset>
          )}
          {error && (
            <p className="rounded-field border-l-2 border-late bg-late-tint px-3 py-2 text-small text-late-ink sm:col-span-2">
              {error}
            </p>
          )}
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create member"}
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
