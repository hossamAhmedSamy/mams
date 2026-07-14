import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ClipboardList, LayoutGrid, LogOut, Receipt, Settings, Wallet } from "lucide-react";
import { Navigate, NavLink, Outlet, useNavigate } from "react-router";
import { Skeleton } from "@/components/ui/feedback";
import { Avatar } from "@/components/ui/page";
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

  const nav = [
    { to: "/my-work", label: "My Work", icon: ClipboardList },
    { to: "/board", label: "Board", icon: LayoutGrid },
    { to: "/calendar", label: "Calendar", icon: CalendarDays },
    ...(isAdmin
      ? [
          { to: "/money", label: "Money", icon: Wallet },
          { to: "/settings/users", label: "Settings", icon: Settings },
        ]
      : [{ to: "/expenses", label: "Expenses", icon: Receipt }]),
  ];

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-gray-200 bg-white p-4 sm:flex">
        <div className="mb-6 flex items-center gap-2.5 px-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-accent-600 text-sm font-black tracking-tight text-white">
            M
          </span>
          <div>
            <span className="block text-[15px] font-bold leading-tight tracking-tight text-gray-900">
              MAMS
            </span>
            <span className="block text-xs leading-tight text-gray-400">Agency operations</span>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} className={navItemClass}>
              <item.icon size={18} /> {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-gray-100 pt-3">
          <div className="flex items-center gap-2.5 px-2">
            <Avatar name={me.data.name} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-900">{me.data.name}</p>
              <p className="truncate text-xs text-gray-400">{me.data.email}</p>
            </div>
          </div>
          <button
            onClick={signOut}
            className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-800"
          >
            <LogOut size={17} /> Sign out
          </button>
        </div>
      </aside>

      <div className="flex-1 pb-16 sm:pb-0">
        {/* mobile top bar */}
        <div className="flex items-center gap-2.5 border-b border-gray-200 bg-white px-4 py-3 sm:hidden">
          <span className="flex size-7 items-center justify-center rounded-lg bg-accent-600 text-xs font-black text-white">
            M
          </span>
          <span className="font-bold tracking-tight">MAMS</span>
          <button onClick={signOut} className="ml-auto text-gray-400">
            <LogOut size={18} />
          </button>
        </div>
        <main className="mx-auto max-w-6xl p-4 sm:p-8">
          <Outlet />
        </main>
        {/* mobile bottom tab bar */}
        <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-gray-200 bg-white sm:hidden">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium",
                  isActive ? "text-accent-700" : "text-gray-400",
                )
              }
            >
              <item.icon size={20} />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
