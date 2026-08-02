import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** A card's left edge is its urgency. Nothing else on the card is coloured. */
export type Edge = "late" | "now" | "done" | "none";

const edges: Record<Edge, string> = {
  late: "border-l-[3px] border-l-late",
  now: "border-l-[3px] border-l-now",
  done: "border-l-[3px] border-l-done",
  none: "",
};

/**
 * A sheet of paper on the desk. Depth comes from warm paper sitting under a
 * plain white surface, not from a drop shadow — shadows are reserved for
 * things that genuinely float (modals, sheets).
 */
export function Card({
  className,
  edge = "none",
  interactive,
  ...props
}: HTMLAttributes<HTMLDivElement> & { edge?: Edge; interactive?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-card border border-rule bg-surface",
        edges[edge],
        interactive &&
          "transition-[border-color,box-shadow] duration-150 hover:border-ink-200 hover:shadow-lift",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 border-b border-rule-soft px-5 py-4",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("display text-lead text-ink-900", className)} {...props} />;
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

/** Action strip — sits on paper so it reads as a base, not as content. */
export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-b-card border-t border-rule-soft bg-paper/70 px-5 py-3",
        className,
      )}
      {...props}
    />
  );
}
