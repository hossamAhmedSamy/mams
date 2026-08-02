import type { Permission } from "@mams/shared";
import {
  CalendarDays,
  ClipboardList,
  Home,
  LayoutGrid,
  LogOut,
  Palmtree,
  Receipt,
  Settings,
  UsersRound,
  Wallet,
} from "lucide-react";
import { Navigate, NavLink, Outlet, useNavigate } from "react-router";
import { Skeleton } from "@/components/ui/feedback";
import { Avatar } from "@/components/ui/page";
import { SlateMark } from "@/components/ui/slate-mark";
import { authClient } from "@/lib/auth-client";
import { dayStamp, todayISO } from "@/lib/dates";
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
  { to: "/time-off", label: "Time off", short: "Time off", icon: Palmtree },
  { to: "/money", label: "Money", short: "Money", icon: Wallet, needs: "money.view" },
  { to: "/people", label: "People", short: "People", icon: UsersRound, needs: "hr.manage" },
  {
    to: "/settings/users",
    label: "Settings",
    short: "Settings",
    icon: Settings,
    needs: "settings.team",
  },
];

export function useNav(): NavItem[] {
  const can = useCan();
  return NAV.filter((item) => !item.needs || can(item.needs));
}

/**
 * The desk and the document: navigation is ink and never moves, the work is
 * paper and always scrolls. On a phone the ink wraps the paper top and bottom,
 * which keeps the thumb on the dark chrome and the eyes on the white sheet.
 */
export function AppLayout() {
  const me = useMe();
  const nav = useNav();
  const navigate = useNavigate();

  if (me.isPending) {
    return (
      <div className="flex min-h-screen">
        <div className="hidden w-60 shrink-0 bg-ink-900 lg:block" />
        <div className="mx-auto w-full max-w-[1140px] space-y-4 p-8">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-72 w-full" />
        </div>
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
    <div className="min-h-screen">
      {/* ---- desk: the ink rail ------------------------------------------ */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col bg-ink-900 lg:flex">
        <div className="px-5 pb-6 pt-6">
          <div className="flex items-center gap-2.5 text-white">
            <SlateMark size={22} />
            <span className="display text-lead tracking-tight">MAMS</span>
          </div>
          <p className="mt-3 font-mono text-micro uppercase tracking-widest text-ink-500">
            {dayStamp(todayISO())}
          </p>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 px-3">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "relative flex items-center gap-3 rounded-field px-3 py-2.5 text-base transition-colors",
                  isActive
                    ? "bg-white/8 font-medium text-white"
                    : "text-ink-400 hover:bg-white/5 hover:text-ink-100",
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-now-bright" />
                  )}
                  <item.icon size={17} strokeWidth={isActive ? 2.2 : 1.9} />
                  {item.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-white/8 p-3">
          <div className="flex items-center gap-2.5 px-2 py-1.5">
            <Avatar name={viewer.name} />
            <div className="min-w-0">
              <p className="truncate text-small font-medium text-white">{viewer.name}</p>
              <p className="truncate text-micro text-ink-500">{viewer.email}</p>
            </div>
          </div>
          <button
            onClick={signOut}
            className="mt-1 flex w-full items-center gap-3 rounded-field px-3 py-2 text-small text-ink-400 transition-colors hover:bg-white/5 hover:text-ink-100"
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>

      {/* ---- document: the paper ------------------------------------------
          min-w-0 so wide content (day strips, tables) scrolls inside its own
          container instead of pushing the whole page sideways. */}
      <div className="min-w-0 lg:pl-60">
        <header className="sticky top-0 z-30 flex items-center gap-3 bg-ink-900 px-4 py-3 text-white lg:hidden">
          <SlateMark size={20} />
          <span className="display text-base tracking-tight">MAMS</span>
          <span className="ml-auto font-mono text-micro uppercase tracking-widest text-ink-500">
            {dayStamp(todayISO())}
          </span>
          <button
            onClick={signOut}
            aria-label="Sign out"
            className="-mr-1.5 flex size-9 items-center justify-center rounded-field text-ink-400 transition-colors hover:bg-white/8 hover:text-white"
          >
            <LogOut size={17} />
          </button>
        </header>

        <main className="mx-auto min-h-[60vh] w-full max-w-[1140px] px-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] pt-6 sm:px-7 sm:pt-8 lg:px-10 lg:pb-14 lg:pt-10">
          <Outlet />
        </main>

        {/* phone tab bar — five slots; the rest live on Home */}
        <nav className="fixed inset-x-0 bottom-0 z-40 flex bg-ink-900 pb-[env(safe-area-inset-bottom)] lg:hidden">
          {nav.slice(0, 5).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "relative flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-medium transition-colors",
                  isActive ? "text-white" : "text-ink-500",
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute inset-x-5 top-0 h-[2.5px] rounded-b-full bg-now-bright" />
                  )}
                  <item.icon size={19} strokeWidth={isActive ? 2.3 : 1.9} />
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

export { firstName };
