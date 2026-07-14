import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { useState } from "react";
import { NavLink } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorBanner, SkeletonRows } from "@/components/ui/feedback";
import { Input, Label, Select } from "@/components/ui/input";
import { Avatar, PageHeader } from "@/components/ui/page";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useMe } from "./app-layout";

export function SettingsTabs({ current }: { current: "team" | "workflows" }) {
  const tabs = [
    { key: "team", label: "Team", to: "/settings/users" },
    { key: "workflows", label: "Workflows", to: "/settings/workflows" },
  ] as const;
  return (
    <div className="flex gap-1 border-b border-gray-200">
      {tabs.map((t) => (
        <NavLink
          key={t.key}
          to={t.to}
          className={cn(
            "border-b-2 px-4 py-2.5 text-sm font-medium",
            current === t.key
              ? "border-accent-600 text-accent-700"
              : "border-transparent text-gray-500 hover:text-gray-700",
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
    <div>
      <PageHeader
        title="Settings"
        subtitle="Team accounts, roles, and skills"
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
            <ErrorBanner message="Couldn't load the team." onRetry={() => users.refetch()} />
          </CardBody>
        ) : users.data.length === 0 ? (
          <EmptyState title="No members yet" hint="Add your first team member above." />
        ) : (
          <ul className="divide-y divide-gray-100">
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
};

function UserRow({ user, isSelf }: { user: UserItem; isSelf: boolean }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [editingSkills, setEditingSkills] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: trpc.users.list.queryKey() });
  const setActive = useMutation(trpc.users.setActive.mutationOptions({ onSuccess: invalidate }));

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={user.name} />
          <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate font-medium text-gray-900">{user.name}</p>
            {user.role === "admin" && <Badge tone="accent">Admin</Badge>}
            {!user.active && <Badge tone="red">Inactive</Badge>}
            {user.mustChangePassword && user.active && <Badge tone="amber">Temp password</Badge>}
          </div>
          <p className="truncate text-sm text-gray-500">{user.email}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {user.skills.length === 0 ? (
              <span className="text-xs text-gray-400">No skills set</span>
            ) : (
              user.skills.map((s) => <Badge key={s.id}>{s.name}</Badge>)
            )}
          </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setEditingSkills((v) => !v)}>
            Skills
          </Button>
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
      {editingSkills && (
        <SkillsEditor
          userId={user.id}
          current={user.skills.map((s) => s.id)}
          onDone={() => {
            setEditingSkills(false);
            invalidate();
          }}
        />
      )}
    </li>
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
  if (skills.isError) return <ErrorBanner message="Couldn't load skills." />;

  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="flex flex-wrap gap-2">
        {skills.data
          .filter((s) => s.active)
          .map((s) => {
            const on = selected.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() =>
                  setSelected((prev) => (on ? prev.filter((x) => x !== s.id) : [...prev, s.id]))
                }
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  on
                    ? "border-accent-600 bg-accent-50 text-accent-700"
                    : "border-gray-300 bg-white text-gray-600 hover:bg-gray-100"
                }`}
              >
                {s.name}
              </button>
            );
          })}
      </div>
      <div className="mt-3 flex gap-2">
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
    create.mutate({ name, email, tempPassword, role, skillIds: [] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New member</CardTitle>
      </CardHeader>
      <CardBody>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="new-name">Name</Label>
            <Input id="new-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="new-email">Email</Label>
            <Input
              id="new-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="new-temp">Temp password (they'll change it)</Label>
            <Input
              id="new-temp"
              required
              minLength={10}
              value={tempPassword}
              onChange={(e) => setTempPassword(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="new-role">Role</Label>
            <Select
              id="new-role"
              value={role}
              onChange={(e) => setRole(e.target.value as "admin" | "member")}
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </Select>
          </div>
          {error && (
            <p className="text-sm text-red-600 sm:col-span-2">{error}</p>
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
