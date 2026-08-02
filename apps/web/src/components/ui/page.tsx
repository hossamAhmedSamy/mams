import { ChevronLeft } from "lucide-react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";

/**
 * The masthead of a call sheet: what production this is, what the sheet is
 * called, and the dates — in that order, with a rule under it.
 */
export function PageHeader({
  title,
  eyebrow,
  subtitle,
  backTo,
  backLabel,
  actions,
  className,
}: {
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  subtitle?: React.ReactNode;
  backTo?: string;
  backLabel?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-6 border-b border-rule pb-5", className)}>
      {backTo && (
        <Link
          to={backTo}
          className="eyebrow -ml-1 mb-3 inline-flex items-center gap-1 text-ink-400 transition-colors hover:text-ink-900"
        >
          <ChevronLeft size={14} strokeWidth={2.5} />
          {backLabel ?? "Back"}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          {eyebrow && <p className="eyebrow mb-1.5 text-ink-400">{eyebrow}</p>}
          <h1 className="display text-h2 text-ink-900 sm:text-h1">{title}</h1>
          {subtitle && <p className="mt-1.5 text-base text-ink-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/**
 * The band that opens a section of a call sheet: what this run of rows is, a
 * rule across the page, and how many. The count is the only figure that needs
 * to survive a glance, so it is mono and it sits at the end of the rule.
 */
export function SectionLabel({
  children,
  count,
  tone = "neutral",
  action,
  className,
}: {
  children: React.ReactNode;
  count?: number;
  tone?: "neutral" | "late" | "now" | "done";
  action?: React.ReactNode;
  className?: string;
}) {
  const color =
    tone === "late"
      ? "text-late"
      : tone === "now"
        ? "text-now-ink"
        : tone === "done"
          ? "text-done"
          : "text-ink-500";
  const dot =
    tone === "late" ? "bg-late" : tone === "now" ? "bg-now" : tone === "done" ? "bg-done" : null;

  return (
    <div className={cn("flex items-center gap-3", className)}>
      {dot && <span className={cn("size-1.5 shrink-0 rounded-full", dot)} />}
      <span className={cn("eyebrow shrink-0", color)}>{children}</span>
      <span className="h-px min-w-4 flex-1 bg-rule" />
      {count !== undefined && (
        <span className={cn("font-mono text-small font-medium", color)}>
          {String(count).padStart(2, "0")}
        </span>
      )}
      {action}
    </div>
  );
}

/** A headline number: the label above it, the figure set large in mono. */
export function Stat({
  label,
  value,
  note,
  tone = "neutral",
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  note?: React.ReactNode;
  tone?: "neutral" | "late" | "now" | "done";
  className?: string;
}) {
  const color =
    tone === "late"
      ? "text-late"
      : tone === "now"
        ? "text-now-ink"
        : tone === "done"
          ? "text-done"
          : "text-ink-900";
  return (
    <div className={className}>
      <p className="eyebrow text-ink-400">{label}</p>
      <p className={cn("mt-2 font-mono text-h2 font-medium tracking-tight tabular-nums", color)}>
        {value}
      </p>
      {note && <p className="mt-1 text-small text-ink-400">{note}</p>}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   People.

   Identity is the one thing besides time that earns colour, because on the
   calendar you have to tell eight people apart at a glance.

   Two rules make that safe. First, the palette never enters the warm arc —
   no red, orange or amber — so a person can never be mistaken for a deadline;
   the time signals keep that half of the wheel to themselves. Second, every
   hue is held at roughly one lightness, dark enough to carry white text at
   4.5:1, so no one person's colour shouts louder than another's.
   ------------------------------------------------------------------------- */

export const PERSON_TONES = [
  "#1c6e68", // teal
  "#2e6fa8", // blue
  "#4a55a8", // indigo
  "#6b4fa0", // violet
  "#8e4a8c", // plum
  "#4f7a35", // olive
  "#17708a", // cyan
  "#5e6478", // slate
] as const;

/** FNV-1a: a weak hash clusters short names onto the same few tones. */
export function toneForName(name: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return PERSON_TONES[(hash >>> 0) % PERSON_TONES.length]!;
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

const avatarSizes = {
  xs: "size-5 text-[9px]",
  sm: "size-6 text-[10px]",
  md: "size-8 text-[11px]",
  lg: "size-10 text-micro",
};

export function Avatar({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: keyof typeof avatarSizes;
  className?: string;
}) {
  return (
    <span
      title={name}
      style={{ backgroundColor: toneForName(name) }}
      className={cn(
        "display-tight inline-flex shrink-0 items-center justify-center rounded-full text-white",
        avatarSizes[size],
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}

export function AvatarStack({ names, size = "sm" }: { names: string[]; size?: "xs" | "sm" }) {
  if (names.length === 0) return null;
  return (
    <span className="flex -space-x-1.5">
      {names.slice(0, 4).map((n) => (
        <span key={n} className="rounded-full ring-2 ring-surface">
          <Avatar name={n} size={size} />
        </span>
      ))}
      {names.length > 4 && (
        <span
          className={cn(
            "display-tight z-10 inline-flex items-center justify-center rounded-full bg-ink-100 text-ink-500 ring-2 ring-surface",
            avatarSizes[size],
          )}
        >
          +{names.length - 4}
        </span>
      )}
    </span>
  );
}
