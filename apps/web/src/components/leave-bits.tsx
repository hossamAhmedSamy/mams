import {
  formatMoney,
  type LeaveBalance,
  type LeaveStatus,
  LEAVE_STATUS_LABELS,
  type LeaveType,
  LEAVE_TYPE_LABELS,
} from "@mams/shared";
import { Badge } from "@/components/ui/badge";
import { formatShort } from "@/lib/dates";
import { cn } from "@/lib/utils";

/**
 * Shared vocabulary for time off, so the member's screen and the owner's queue
 * describe the same request in the same words.
 */

export function LeaveStatusBadge({ status }: { status: LeaveStatus | string }) {
  const tone =
    status === "approved" ? "done" : status === "rejected" ? "late" : status === "pending" ? "now" : "neutral";
  return <Badge tone={tone}>{LEAVE_STATUS_LABELS[status as LeaveStatus] ?? status}</Badge>;
}

/** "3 days · 12–14 Aug" — the shape of a request before any of its detail. */
export function leaveSpan(startDate: string, endDate: string, days: number): string {
  const span =
    startDate === endDate
      ? formatShort(startDate)
      : `${formatShort(startDate)} – ${formatShort(endDate)}`;
  return `${days} day${days === 1 ? "" : "s"} · ${span}`;
}

export function LeaveTypeChip({ type }: { type: LeaveType }) {
  return (
    <span className="eyebrow inline-flex items-center rounded-[5px] bg-ink-50 px-1.5 py-1 text-ink-500">
      {LEAVE_TYPE_LABELS[type].replace(" leave", "")}
    </span>
  );
}

/** Money coming off someone's pay is always said out loud, never implied. */
export function DeductionNote({ amount }: { amount: string | number | null }) {
  if (amount === null || Number(amount) === 0) return null;
  return (
    <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-[6px] bg-ink-50 px-2 py-1 text-small text-ink-600">
      <span className="font-mono font-medium">−{formatMoney(amount)}</span> off that month's pay
    </p>
  );
}

/**
 * A balance is two numbers people actually care about — what's left and out of
 * how many — plus a bar so the year's shape is legible without reading either.
 */
export function BalanceMeter({
  label,
  left,
  allowed,
  hint,
  className,
}: {
  label: string;
  left: number;
  allowed: number;
  hint?: string;
  className?: string;
}) {
  const used = Math.max(0, allowed - left);
  const pct = allowed > 0 ? Math.min(100, Math.round((used / allowed) * 100)) : 0;
  const spent = left <= 0;

  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="eyebrow text-ink-400">{label}</p>
        <p className="font-mono text-small tabular-nums text-ink-400">
          {used}/{allowed}
        </p>
      </div>
      <p
        className={cn(
          "mt-1.5 font-mono text-h2 font-medium tracking-tight tabular-nums",
          spent ? "text-late" : "text-ink-900",
        )}
      >
        {left}
        <span className="ml-1.5 text-small font-normal text-ink-400">
          day{left === 1 ? "" : "s"} left
        </span>
      </p>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
        <div
          className={cn("h-full rounded-full", spent ? "bg-late" : "bg-ink-700")}
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
      {hint && <p className="mt-1.5 text-small text-ink-400">{hint}</p>}
    </div>
  );
}

/** The three pools, laid out the same way everywhere they appear. */
export function BalanceRow({ balance }: { balance: LeaveBalance }) {
  return (
    <div className="grid gap-5 sm:grid-cols-3">
      <BalanceMeter label="Annual" left={balance.annual.left} allowed={balance.annual.allowed} />
      <BalanceMeter
        label="Casual"
        left={balance.casual.left}
        allowed={balance.casual.allowed}
        hint="Comes out of the same annual days"
      />
      <BalanceMeter label="Sick" left={balance.sick.left} allowed={balance.sick.allowed} />
    </div>
  );
}
