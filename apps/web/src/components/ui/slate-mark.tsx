import { cn } from "@/lib/utils";

/**
 * Three strokes: the stripes on a clapperboard, and the stages of a chain.
 * The last one is saffron because in this app there is always exactly one
 * stage that is live — which is the whole idea the product is built on.
 */
export function SlateMark({ className, size = 24 }: { className?: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      className={cn("shrink-0", className)}
    >
      <path
        d="M4 18 8.4 6"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        opacity="0.45"
      />
      <path
        d="M10.2 18 14.6 6"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        opacity="0.75"
      />
      <path
        d="M16.4 18 20.8 6"
        stroke="var(--color-now-bright)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
