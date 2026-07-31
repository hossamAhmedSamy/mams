/** Date display helpers. All inputs are YYYY-MM-DD business dates. */

export function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

export function formatShort(dateISO: string): string {
  const [y, m, d] = dateISO.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** "Starts 3 Aug · due 7 Aug" — the task's window in one phrase, or null. */
export function spanLabel(
  startDate: string | null,
  deadline: string | null,
  today = todayISO(),
): string | null {
  const due = deadline ? `due ${formatShort(deadline)}` : null;
  if (!startDate) return due ? due.charAt(0).toUpperCase() + due.slice(1) : null;
  const starts =
    startDate > today
      ? `Starts ${formatShort(startDate)}`
      : `Started ${formatShort(startDate)}`;
  return due ? `${starts} · ${due}` : starts;
}

/** "3 days late" | "Today" | "Tomorrow" | "Mon 21 Jul"-ish relative deadline. */
export function deadlineLabel(deadline: string, today = todayISO()): {
  text: string;
  tone: "red" | "amber" | "gray";
} {
  const diff = daysBetween(today, deadline);
  if (diff < 0) return { text: `${-diff} day${diff === -1 ? "" : "s"} late`, tone: "red" };
  if (diff === 0) return { text: "Today", tone: "amber" };
  if (diff === 1) return { text: "Tomorrow", tone: "amber" };
  return { text: formatShort(deadline), tone: "gray" };
}
