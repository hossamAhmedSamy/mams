import { X } from "lucide-react";
import { useEffect } from "react";
import { cn } from "@/lib/utils";

/**
 * A bottom sheet on a phone, a centred dialog on a desk — the same component,
 * because the team switches between the two several times a day and the
 * controls must stay in the same order.
 */
export function Modal({
  title,
  eyebrow,
  onClose,
  children,
  footer,
  wide,
}: {
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/45 backdrop-blur-[3px] sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "max-h-[92vh] w-full overflow-y-auto rounded-t-sheet bg-surface shadow-pop animate-[sheet_.3s_cubic-bezier(.22,.61,.36,1)] sm:rounded-sheet sm:animate-[pop_.22s_cubic-bezier(.22,.61,.36,1)]",
          wide ? "sm:max-w-2xl" : "sm:max-w-md",
        )}
      >
        {/* grab handle — reads as "drag me" on a phone, invisible on a desk */}
        <div className="flex justify-center pt-2.5 sm:hidden">
          <span className="h-1 w-9 rounded-full bg-ink-200" />
        </div>

        <div className="flex items-start justify-between gap-4 px-5 pb-4 pt-4">
          <div className="min-w-0">
            {eyebrow && <p className="eyebrow mb-1 text-ink-400">{eyebrow}</p>}
            <h2 className="display text-title text-ink-900">{title}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 flex size-8 shrink-0 items-center justify-center rounded-field text-ink-400 transition-colors hover:bg-ink-50 hover:text-ink-900"
          >
            <X size={17} />
          </button>
        </div>

        <div className="border-t border-rule-soft px-5 py-4">{children}</div>

        {footer && (
          <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-rule-soft bg-surface px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
