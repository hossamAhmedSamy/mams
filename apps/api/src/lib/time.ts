/**
 * Timezone helpers (no dependencies). All instants are stored UTC; business
 * rules ("end of day", digest hour) are evaluated in TZ_BUSINESS (Cairo).
 */

/** Wall-clock parts of a UTC instant in a target timezone. */
function tzParts(date: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour === "24" ? "0" : parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/**
 * UTC instant for `dateISO` (YYYY-MM-DD) at `hour`:00 local time in `tz`.
 * Two-pass fixpoint over the tz offset — handles DST (Egypt observes it).
 */
export function zonedTimeToUtc(dateISO: string, hour: number, tz: string): Date {
  const [y, m, d] = dateISO.split("-").map(Number) as [number, number, number];
  let guess = new Date(Date.UTC(y, m - 1, d, hour, 0, 0));
  for (let i = 0; i < 2; i++) {
    const p = tzParts(guess, tz);
    const wantMs = Date.UTC(y, m - 1, d, hour, 0, 0);
    const gotMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess = new Date(guess.getTime() + (wantMs - gotMs));
  }
  return guess;
}

/** Today's date (YYYY-MM-DD) in the business timezone. */
export function todayISO(tz: string, now = new Date()): string {
  const p = tzParts(now, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** dateISO + n days (calendar arithmetic, no tz involvement). */
export function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}
