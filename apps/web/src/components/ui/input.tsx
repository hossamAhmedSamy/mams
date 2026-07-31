import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const base =
  "w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 shadow-xs transition-colors placeholder:text-gray-400 focus:border-accent-500 focus:outline-2 focus:outline-accent-100 disabled:opacity-50";

/* Phones: h-10 keeps inputs thumb-sized and stops iOS zooming on focus. */
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(base, "h-10 sm:h-9", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(base, "min-h-20 py-2", className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(base, "h-10 sm:h-9", className)} {...props} />;
}

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
    <label htmlFor={htmlFor} className={cn("mb-1 block text-sm font-medium text-gray-700", className)}>
      {children}
    </label>
  );
}
