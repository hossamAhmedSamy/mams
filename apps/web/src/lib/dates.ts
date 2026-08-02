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

/** "THU 02 AUG" — the stamp at the top of a call sheet. */
export function dayStamp(dateISO: string): string {
  const [y, m, d] = dateISO.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d)
    .toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" })
    .replace(",", "");
}

/** "Thursday" / "2 August" — the two halves of a page-heading date. */
export function weekdayOf(dateISO: string): string {
  const [y, m, d] = dateISO.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: "long" });
}

export function formatLong(dateISO: string): string {
  const [y, m, d] = dateISO.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "long" });
}

/**
 * The one place time turns into colour. Every card edge, chip and section
 * marker in the app derives its tone from here, so "late" always looks the
 * same everywhere and nothing else is allowed to borrow the hue.
 */
export type TimeTone = "late" | "now" | "done" | "neutral";

export function timeTone(
  deadline: string | null,
  today = todayISO(),
  opts: { flagged?: boolean; done?: boolean } = {},
): TimeTone {
  if (opts.done) return "done";
  if (opts.flagged) return "late";
  if (!deadline) return "neutral";
  if (deadline < today) return "late";
  if (deadline === today) return "now";
  return "neutral";
}

/**
 * "−3d" | "TODAY" | "+1d" | "12 AUG" — a deadline compressed to something you
 * can read in a column. Mono figures mean the minus sign never shifts the row.
 */
export function deadlineLabel(
  deadline: string,
  today = todayISO(),
): { text: string; tone: TimeTone } {
  const diff = daysBetween(today, deadline);
  if (diff < 0) return { text: `−${-diff}d`, tone: "late" };
  if (diff === 0) return { text: "TODAY", tone: "now" };
  if (diff <= 6) return { text: `+${diff}d`, tone: "neutral" };
  return { text: formatShort(deadline).toUpperCase(), tone: "neutral" };
}

/** The same deadline said in words, for detail screens with room to breathe. */
export function deadlineSentence(deadline: string, today = todayISO()): string {
  const diff = daysBetween(today, deadline);
  if (diff < 0) return `${-diff} day${diff === -1 ? "" : "s"} late`;
  if (diff === 0) return "Due today";
  if (diff === 1) return "Due tomorrow";
  return `Due ${formatShort(deadline)}`;
}
