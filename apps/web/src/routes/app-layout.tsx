import { useQuery } from "@tanstack/react-query";
import { ClipboardList, LayoutGrid, LogOut, Settings } from "lucide-react";
import { Navigate, NavLink, Outlet, useNavigate } from "react-router";
import { Skeleton } from "@/components/ui/feedback";
import { authClient } from "@/lib/auth-client";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export function useMe() {
  const trpc = useTRPC();
  return useQuery({ ...trpc.users.me.queryOptions(), retry: false });
}

const navItemClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
    isActive ? "bg-accent-50 text-accent-700" : "text-gray-600 hover:bg-gray-100",
  );

export function AppLayout() {
  const me = useMe();
  const navigate = useNavigate();

  if (me.isPending) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 p-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (me.isError) return <Navigate to="/login" replace />;
  if (me.data.mustChangePassword) return <Navigate to="/change-password" replace />;

  const isAdmin = me.data.role === "admin";

  async function signOut() {
    await authClient.signOut();
    navigate("/login");
  }

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-gray-200 bg-white p-4 sm:flex">
        <div className="mb-6 px-3">
          <span className="text-lg font-bold tracking-tight text-gray-900">MAMS</span>
          <p className="text-xs text-gray-500">Agency operations</p>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          <NavLink to="/my-work" className={navItemClass}>
            <ClipboardList size={17} /> My Work
          </NavLink>
          <NavLink to="/board" className={navItemClass}>
            <LayoutGrid size={17} /> Board
          </NavLink>
          {isAdmin && (
            <NavLink to="/settings/users" className={navItemClass}>
              <Settings size={17} /> Settings
            </NavLink>
          )}
        </nav>
        <div className="border-t border-gray-100 pt-3">
          <p className="truncate px-3 text-sm font-medium text-gray-900">{me.data.name}</p>
          <p className="truncate px-3 text-xs text-gray-500">{me.data.email}</p>
          <button
            onClick={signOut}
            className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
          >
            <LogOut size={17} /> Sign out
          </button>
        </div>
      </aside>

      <div className="flex-1">
        {/* mobile top bar */}
        <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 sm:hidden">
          <span className="font-bold">MAMS</span>
          <nav className="flex gap-4 text-sm">
            <NavLink to="/my-work" className="text-gray-700">
              My Work
            </NavLink>
            <NavLink to="/board" className="text-gray-700">
              Board
            </NavLink>
            {isAdmin && (
              <NavLink to="/settings/users" className="text-gray-700">
                Settings
              </NavLink>
            )}
          </nav>
        </div>
        <main className="mx-auto max-w-6xl p-4 sm:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
