import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * The type scale defined in globals.css (`--text-page-title` and the rest). tailwind-merge has to know these
 * are font sizes; otherwise it reads `text-button` as a text colour and drops a real colour such as
 * `text-primary-foreground` that comes before it.
 */
export const TYPE_SCALE = ["page-title", "page-desc", "stat", "stat-label", "card-title", "nav", "label", "detail", "meta", "step", "button", "option"] as const

const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: [...TYPE_SCALE] }], "font-family": [{ font: ["brand"] }] } },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
