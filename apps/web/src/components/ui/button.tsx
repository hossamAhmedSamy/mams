import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Buttons are ink, never saffron. Saffron means "due now" and is spent only on
 * time — the moment a button borrows it, the colour stops carrying meaning.
 * Emphasis comes from contrast instead: solid ink for the real action, a ruled
 * outline for everything standing next to it.
 */
const buttonVariants = cva(
  // A disabled button must stay readable — fading a white label into a dark
  // fill turns it into an unlabelled blob, so disabled swaps the fill instead.
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-field font-medium transition-[background-color,border-color,color,transform] duration-150 active:translate-y-px disabled:pointer-events-none disabled:border-transparent disabled:bg-ink-100 disabled:text-ink-400",
  {
    variants: {
      variant: {
        primary: "bg-ink-900 text-white hover:bg-ink-700",
        secondary:
          "border border-rule bg-surface text-ink-700 hover:border-ink-300 hover:text-ink-900",
        ghost: "text-ink-500 hover:bg-ink-50 hover:text-ink-900",
        danger: "bg-late text-white hover:bg-late-ink",
        /** For the ink rail and other dark surfaces. */
        onInk: "bg-white/10 text-white hover:bg-white/20",
      },
      size: {
        sm: "h-9 px-3 text-small sm:h-8",
        md: "h-11 px-4 text-base sm:h-9",
        lg: "h-12 px-6 text-base",
        icon: "size-9 p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export function Button({
  className,
  variant,
  size,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
