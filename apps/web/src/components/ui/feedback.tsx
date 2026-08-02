import { cn } from "@/lib/utils";
import { Button } from "./button";

/** Lists never show spinners — they show the shape of what is coming. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-[6px] bg-ink-100", className)} />;
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2.5 p-5">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/2 opacity-60" />
          </div>
          <Skeleton className="h-6 w-14 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/**
 * An empty screen is an invitation, not an apology. It names what will appear
 * here and how it gets here — never "no data".
 */
export function EmptyState({
  title,
  hint,
  action,
  className,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("px-6 py-12 text-center", className)}>
      <p className="display text-lead text-ink-700">{title}</p>
      {hint && <p className="mx-auto mt-1.5 max-w-sm text-base text-ink-400">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/** Errors say what happened and what to do. They do not say sorry. */
export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-late/25 border-l-[3px] border-l-late bg-late-tint px-4 py-3.5">
      <p className="text-base text-late-ink">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
