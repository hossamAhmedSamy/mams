import { Check, Flag } from "lucide-react";
import { Avatar } from "@/components/ui/page";
import { cn } from "@/lib/utils";

export type StageState = "done" | "live" | "ahead";

/**
 * The handoff rail — the one thing this app is built around.
 *
 * A project is a relay: work passes from hand to hand down a chain of stages.
 * So the rail down the left of a project is made of *people*, not step numbers.
 * A number tells you where you are in a list. A face tells you who to call.
 *
 * Reading down the rail: solid faces behind you are hands the work has already
 * passed through, the saffron ring is whoever is holding it right now, and the
 * faded rings ahead are who gets it next. An empty dashed ring is a stage
 * nobody is staffed on — which is exactly the thing that stalls a shoot, so it
 * is drawn as a hole in the chain rather than hidden in a status field.
 */
export function RailNode({
  state,
  names,
  flagged,
  last,
}: {
  state: StageState;
  names: string[];
  flagged?: boolean;
  last?: boolean;
}) {
  const unstaffed = names.length === 0;

  return (
    <div className="flex w-9 shrink-0 flex-col items-center">
      <span className="relative z-10 flex size-9 items-center justify-center">
        {state === "live" && (
          // the halo is the only glow in the app: exactly one stage is live
          <span className="absolute inset-0 rounded-full bg-now/15" />
        )}
        {unstaffed ? (
          state === "done" ? (
            // a finished stage with no name on it is history, not a gap
            <span className="flex size-7 items-center justify-center rounded-full bg-done-tint text-done ring-2 ring-done/25">
              <Check size={13} strokeWidth={3} />
            </span>
          ) : (
            <span
              className={cn(
                "size-7 rounded-full border-2 border-dashed bg-surface",
                state === "live" ? "border-now" : "border-ink-200",
              )}
            />
          )
        ) : (
          <span
            className={cn(
              "relative rounded-full",
              state === "live"
                ? "ring-[2.5px] ring-now"
                : state === "done"
                  ? "ring-2 ring-done/45"
                  : "opacity-45 ring-2 ring-ink-200",
            )}
          >
            <Avatar name={names[0]!} size={state === "live" ? "md" : "sm"} />
            {state === "done" && (
              <span className="absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-done text-white ring-2 ring-surface">
                <Check size={8} strokeWidth={4} />
              </span>
            )}
            {flagged && state !== "done" && (
              <span className="absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-late text-white ring-2 ring-surface">
                <Flag size={7} strokeWidth={3} />
              </span>
            )}
          </span>
        )}
      </span>

      {/* the line carries the same story: solid where work has flowed */}
      {!last && (
        <span
          className={cn("-mt-0.5 w-[2px] flex-1", state === "done" ? "bg-done/35" : "bg-ink-100")}
        />
      )}
    </div>
  );
}

/**
 * The same relay compressed to one line, for a task that is not showing its
 * whole project: who had it, who has it, who is next.
 */
export function HandoffTrail({
  from,
  current,
  next,
  className,
}: {
  from?: string[];
  current: string[];
  next?: string[];
  className?: string;
}) {
  const hop = (names: string[] | undefined, state: StageState) => {
    if (!names) return null;
    return names.length === 0 ? (
      <span
        className={cn(
          "size-5 rounded-full border-2 border-dashed",
          state === "live" ? "border-now" : "border-ink-200",
        )}
      />
    ) : (
      <span
        className={cn(
          "rounded-full",
          state === "live" ? "ring-2 ring-now" : "opacity-50 ring-2 ring-ink-200",
        )}
      >
        <Avatar name={names[0]!} size="xs" />
      </span>
    );
  };

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      {hop(from, "done")}
      {from && <span className="h-px w-3 bg-ink-200" />}
      {hop(current, "live")}
      {next && <span className="h-px w-3 bg-ink-200" />}
      {hop(next, "ahead")}
    </span>
  );
}
