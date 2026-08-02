import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Status is set in the display face, wide and small, like the stamps on a call
 * sheet. Only the three time signals carry colour; every other state is ink,
 * so a screen full of tasks has at most three coloured marks on it.
 */
export type Tone = "neutral" | "ink" | "late" | "now" | "done";

const tones: Record<Tone, string> = {
  neutral: "bg-ink-50 text-ink-500",
  ink: "bg-ink-100 text-ink-700",
  late: "bg-late-tint text-late-ink",
  now: "bg-now-tint text-now-ink",
  done: "bg-done-tint text-done-ink",
};

const solid: Record<Tone, string> = {
  neutral: "bg-ink-300 text-white",
  ink: "bg-ink-800 text-white",
  late: "bg-late text-white",
  now: "bg-now text-white",
  done: "bg-done text-white",
};

export function Badge({
  tone = "neutral",
  filled,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone; filled?: boolean }) {
  return (
    <span
      className={cn(
        "eyebrow inline-flex items-center gap-1 rounded-[5px] px-1.5 py-1",
        filled ? solid[tone] : tones[tone],
        className,
      )}
      {...props}
    />
  );
}

/**
 * A number that means something — days late, items left, tasks due. Mono keeps
 * figures aligned down a list, which is the whole point of a call sheet.
 */
export function Figure({
  tone = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  const color =
    tone === "late"
      ? "text-late"
      : tone === "now"
        ? "text-now-ink"
        : tone === "done"
          ? "text-done"
          : "text-ink-400";
  return (
    <span
      className={cn("font-mono text-small font-medium tracking-tight", color, className)}
      {...props}
    />
  );
}
