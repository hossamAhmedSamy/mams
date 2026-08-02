import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/*
 * tailwind-merge only knows Tailwind's stock font-size scale. Ours is named
 * (`text-small`, `text-lead`, `text-hero`…), so without this it filed those
 * under "text colour" and dropped the real colour sitting beside them — which
 * silently rendered white button labels as ink on ink. Teach it the scale.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["eyebrow", "micro", "small", "lead", "title", "h1", "h2", "hero", "mega"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
