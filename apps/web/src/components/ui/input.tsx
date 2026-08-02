import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/*
 * 16px on phones is not a style choice — below it, iOS Safari zooms the page
 * on focus and the person loses their place in the form. Desktop drops to 15.
 */
const base =
  "w-full rounded-field border border-rule bg-surface px-3 text-[16px] text-ink-900 transition-[border-color,box-shadow] placeholder:text-ink-300 focus:border-ink-900 focus:outline-none focus:ring-2 focus:ring-ink-900/10 disabled:bg-ink-50 disabled:text-ink-400 sm:text-base";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(base, "h-11 sm:h-9", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(base, "min-h-24 py-2.5 leading-relaxed", className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(base, "h-11 pr-8 sm:h-9", className)} {...props} />;
}

/** Form labels are call-sheet labels: wide, small, uppercase, quiet. */
export function Label({
  className,
  children,
  htmlFor,
}: {
  className?: string;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <label htmlFor={htmlFor} className={cn("eyebrow mb-1.5 block text-ink-400", className)}>
      {children}
    </label>
  );
}

/** Label + control + optional hint, spaced once so no form has to re-decide. */
export function Field({
  label,
  hint,
  htmlFor,
  className,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="mt-1.5 text-small text-ink-400">{hint}</p>}
    </div>
  );
}

/** A checkbox that stays legible at arm's length and hits 42px on a phone. */
export function Checkbox({
  label,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode }) {
  return (
    <label
      className={cn(
        "inline-flex cursor-pointer select-none items-center gap-2.5 text-base text-ink-600",
        className,
      )}
    >
      <input
        type="checkbox"
        className="size-4.5 shrink-0 rounded-[5px] border-rule accent-ink-900"
        {...props}
      />
      {label}
    </label>
  );
}
