import { useQuery } from "@tanstack/react-query";
import { can, type Permission, type Role } from "@mams/shared";
import { useTRPC } from "@/lib/trpc";

export type Viewer = {
  id: string;
  name: string;
  email: string;
  role: Role;
  permissions: Permission[];
  mustChangePassword: boolean;
};

/** The signed-in user, including what they're allowed to do. */
export function useMe() {
  const trpc = useTRPC();
  return useQuery({ ...trpc.users.me.queryOptions(), retry: false });
}

/**
 * `can("tasks.assign")` for the current viewer. Returns false while the
 * session is still loading, so nothing privileged flashes into view first.
 */
export function useCan(): (permission: Permission) => boolean {
  const me = useMe();
  return (permission) => can(me.data as Viewer | undefined, permission);
}

/** First name only — the app talks to people, not to accounts. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
