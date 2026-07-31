import type { Permission } from "@mams/shared";
import {
  CalendarDays,
  ClipboardList,
  Home,
  LayoutGrid,
  LogOut,
  Receipt,
  Settings,
  Wallet,
} from "lucide-react";
import { Navigate, NavLink, Outlet, useNavigate } from "react-router";
import { Skeleton } from "@/components/ui/feedback";
import { Avatar } from "@/components/ui/page";
import { authClient } from "@/lib/auth-client";
import { firstName, useCan, useMe, type Viewer } from "@/lib/session";
import { cn } from "@/lib/utils";

export { useMe } from "@/lib/session";

type NavItem = {
  to: string;
  label: string;
  short: string;
  icon: typeof Home;
  needs?: Permission;
};

/** One nav list, filtered by what this person may actually open. */
const NAV: NavItem[] = [
  { to: "/home", label: "Home", short: "Home", icon: Home },
  { to: "/my-work", label: "My Work", short: "Work", icon: ClipboardList },
  { to: "/board", label: "Projects", short: "Projects", icon: LayoutGrid },
  { to: "/calendar", label: "Calendar", short: "Calendar", icon: CalendarDays },
  { to: "/expenses", label: "Expenses", short: "Expenses", icon: Receipt },
  { to: "/money", label: "Money", short: "Money", icon: Wallet, needs: "money.view" },
  { to: "/settings/users", label: "Settings", short: "Settings", icon: Settings, needs: "settings.team" },
];

export function useNav(): NavItem[] {
  const can = useCan();
  return NAV.filter((item) => !item.needs || can(item.needs));
}

export function AppLayout() {
  const me = useMe();
  const nav = useNav();
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

  const viewer = me.data as Viewer;

  async function signOut() {
    await authClient.signOut();
    navigate("/login");
  }

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-hairline bg-white p-4 lg:flex">
        <Wordmark />
        <nav className="mt-6 flex flex-1 flex-col gap-0.5">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-accent-50 text-accent-700"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900",
                )
              }
            >
              <item.icon size={18} /> {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-hairline pt-3">
          <div className="flex items-center gap-2.5 px-2">
            <Avatar name={viewer.name} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-900">{viewer.name}</p>
              <p className="truncate text-xs text-gray-400">{viewer.email}</p>
            </div>
          </div>
          <button
            onClick={signOut}
            className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-800"
          >
            <LogOut size={17} /> Sign out
          </button>
        </div>
      </aside>

      {/* min-w-0: a flex item defaults to min-width:auto, which would let wide
          content (the day strip, tables) push the whole page sideways instead
          of scrolling inside its own container */}
      <div className="min-w-0 flex-1 pb-[calc(env(safe-area-inset-bottom)+4.5rem)] lg:pb-0">
        {/* phone + tablet top bar */}
        <div className="sticky top-0 z-30 flex items-center gap-2.5 border-b border-hairline bg-white/90 px-4 py-2.5 backdrop-blur lg:hidden">
          <Wordmark compact />
          <div className="ml-auto flex items-center gap-2">
            <Avatar name={viewer.name} size="sm" />
            <button
              onClick={signOut}
              aria-label="Sign out"
              className="flex size-9 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-50"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>

        <main className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>

        {/* phone bottom tab bar — five slots max, the rest live on Home */}
        <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-hairline bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
          {nav.slice(0, 5).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
                  isActive ? "text-accent-700" : "text-gray-400",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon size={20} strokeWidth={isActive ? 2.4 : 2} />
                  {item.short}
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}

function Wordmark({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 px-1">
      <span
        className={cn(
          "flex items-center justify-center rounded-xl bg-accent-600 font-black tracking-tight text-white",
          compact ? "size-8 text-xs" : "size-9 text-sm",
        )}
      >
        M
      </span>
      <div>
        <span className="block text-[15px] font-bold leading-tight tracking-tight text-gray-900">
          MAMS
        </span>
        {!compact && (
          <span className="block text-xs leading-tight text-gray-400">Agency operations</span>
        )}
      </div>
    </div>
  );
}

export { firstName };
