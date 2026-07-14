import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const tones: Record<string, string> = {
  gray: "bg-gray-100 text-gray-700",
  accent: "bg-accent-50 text-accent-700",
  red: "bg-red-50 text-red-700",
  amber: "bg-amber-50 text-amber-700",
  blue: "bg-blue-50 text-blue-700",
  green: "bg-green-50 text-green-700",
  orange: "bg-orange-50 text-orange-700",
};

export function Badge({
  tone = "gray",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof tones }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
