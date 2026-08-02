import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { Skeleton } from "@/components/ui/feedback";
import { Avatar } from "@/components/ui/page";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

/**
 * Pick the people on something. Multi-select by design — assignment is a set,
 * not an owner, so there is no "primary" slot to single out. Selected chips go
 * solid ink: at a glance the row reads as a filled-in cast list.
 */
export function PeoplePicker({
  selected,
  onChange,
  emptyHint = "Nobody on this yet.",
  disabled,
}: {
  selected: string[];
  onChange: (userIds: string[]) => void;
  emptyHint?: string;
  disabled?: boolean;
}) {
  const trpc = useTRPC();
  const users = useQuery(trpc.users.list.queryOptions());

  if (users.isPending) return <Skeleton className="h-9 w-full" />;
  if (users.isError) return <p className="text-small text-late">Couldn't load the team.</p>;

  const active = users.data.filter((u) => u.active);

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {active.map((u) => {
          const on = selected.includes(u.id);
          return (
            <button
              key={u.id}
              type="button"
              disabled={disabled}
              aria-pressed={on}
              onClick={() => toggle(u.id)}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-small font-medium transition-colors disabled:opacity-45",
                on
                  ? "border-ink-900 bg-ink-900 text-white"
                  : "border-rule bg-surface text-ink-600 hover:border-ink-300 hover:text-ink-900",
              )}
            >
              {on ? (
                <span className="flex size-6 items-center justify-center rounded-full bg-white/15 text-white">
                  <Check size={13} strokeWidth={3} />
                </span>
              ) : (
                <Avatar name={u.name} size="sm" />
              )}
              {u.name}
            </button>
          );
        })}
      </div>
      {selected.length === 0 && <p className="mt-2 text-small text-ink-400">{emptyHint}</p>}
    </div>
  );
}
