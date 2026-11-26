import type { ComponentType, ReactNode } from "react"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

/*
 * Compass design system: small presentational building blocks shared by the redesigned pages.
 * Colours, type sizes, radii, shadows and motion come from the theme tokens and utilities in globals.css
 * (text-page-title, text-stat, text-card-title, text-meta, text-detail, text-step, text-button; surface-card,
 * lift, press), so light and dark mode and reduced motion are handled in one place.
 */

export type Tint = "mint" | "blue" | "lavender" | "amber" | "neutral"

const TINT_CLASS: Record<Tint, string> = {
  mint: "bg-tint-mint text-tint-mint-foreground",
  blue: "bg-tint-blue text-tint-blue-foreground",
  lavender: "bg-tint-lavender text-tint-lavender-foreground",
  amber: "bg-tint-amber text-tint-amber-foreground",
  neutral: "bg-muted text-muted-foreground",
}

const TILE_SIZE = {
  sm: "size-10 rounded-xl [&_svg]:size-5",
  md: "size-12 rounded-[14px] [&_svg]:size-6",
  lg: "size-14 rounded-2xl [&_svg]:size-7",
} as const

/** A pastel square holding an icon. Inside a `lift` card it grows a little on hover. */
export function IconTile({ icon: Icon, tint = "mint", size = "md", className, title }: { icon: ComponentType<{ className?: string }>; tint?: Tint; size?: keyof typeof TILE_SIZE; className?: string; title?: string }) {
  return (
    <span data-tile="" className={cn("flex shrink-0 items-center justify-center", TILE_SIZE[size], TINT_CLASS[tint], className)} title={title}>
      <Icon aria-hidden="true" />
    </span>
  )
}

export type PillTone = "neutral" | "success" | "info" | "warning"

const PILL_CLASS: Record<PillTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  success: "bg-tint-mint text-tint-mint-foreground",
  info: "bg-tint-blue text-tint-blue-foreground",
  warning: "bg-tint-amber text-tint-amber-foreground",
}

/** Class names for a status pill, for elements that must be a link or a button. A small dot leads the label. */
export function pillClass(tone: PillTone, className?: string): string {
  return cn(
    "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold whitespace-nowrap before:size-1.5 before:rounded-full before:bg-current before:opacity-70 before:content-['']",
    PILL_CLASS[tone],
    className,
  )
}

export function StatusPill({ tone, children, className, title }: { tone: PillTone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span className={pillClass(tone, className)} title={title}>
      {children}
    </span>
  )
}

/** Page title, one line of description and the page's main actions. */
export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-page-title">{title}</h1>
        {description ? <p className="mt-1.5 text-page-desc text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

/** Focus ring shared by the redesigned controls. */
export const FOCUS_RING = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"

/** A summary figure that can also act as a filter (pressed while selected: mint tint and green border). */
export function StatCard({
  icon,
  tint,
  value,
  label,
  hint,
  selected,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>
  tint: Tint
  value: ReactNode
  label: string
  hint?: string
  selected?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn("surface-card lift flex w-full items-center gap-4 p-5 text-left sm:p-6", FOCUS_RING, selected && "border-primary bg-tint-mint/45 hover:bg-tint-mint/55")}
    >
      <IconTile icon={icon} tint={tint} size="lg" />
      <span className="min-w-0">
        <span className="block text-stat tabular-nums" suppressHydrationWarning>
          {value}
        </span>
        <span className="mt-1 block truncate text-stat-label">{label}</span>
        {hint ? <span className="block truncate text-meta text-muted-foreground">{hint}</span> : null}
      </span>
    </button>
  )
}

/** Pill-shaped filter chip. */
export function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "press h-9 rounded-full border px-4 text-button",
        FOCUS_RING,
        active ? "border-primary bg-primary text-primary-foreground shadow-soft hover:bg-primary/90" : "bg-card text-foreground hover:border-primary/50 hover:bg-tint-mint/40",
      )}
    >
      {children}
    </button>
  )
}

/** Two or more exclusive options shown side by side (for example Cards / List). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string; icon?: ComponentType<{ className?: string }> }[]
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div className="flex rounded-xl border bg-card p-1 shadow-soft" role="group" aria-label={label}>
      {options.map((option) => {
        const active = option.value === value
        const Icon = option.icon
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "press flex h-8 items-center gap-2 rounded-lg px-3 text-button",
              FOCUS_RING,
              active ? "bg-tint-mint text-tint-mint-foreground ring-1 ring-primary/40" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {Icon ? <Icon className="size-4" aria-hidden="true" /> : null}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/** Class names for a small round icon action (edit, duplicate, delete) in the redesigned cards. */
export const ICON_ACTION = cn("press size-9 rounded-lg text-muted-foreground hover:bg-tint-mint hover:text-tint-mint-foreground", FOCUS_RING)

export type StepState = "done" | "current" | "attention" | "pending"

/**
 * Connected workflow steps: done (green check), current (green ring), attention (amber ring, for example
 * out of date) and pending (grey). `compact` hides the labels (they stay in each step's tooltip).
 */
export function StepProgress({ steps, compact = false, label }: { steps: { name: string; state: StepState; hint?: string }[]; compact?: boolean; label: string }) {
  return (
    <ol className="flex w-full items-start" aria-label={label}>
      {steps.map((step, index) => {
        const reached = step.state !== "pending"
        return (
          <li key={step.name} className="relative flex min-w-0 flex-1 flex-col items-center" title={step.hint ? `${step.name}: ${step.hint}` : step.name}>
            {index > 0 ? (
              <span
                aria-hidden="true"
                className={cn("absolute top-[11px] right-1/2 left-[-50%] h-0.5 rounded-full", reached ? "bg-primary" : "bg-border", compact && "top-[7px]")}
              />
            ) : null}
            <span
              className={cn(
                "relative z-10 flex items-center justify-center rounded-full",
                compact ? "size-4" : "size-6",
                step.state === "done" && "bg-primary text-primary-foreground shadow-soft",
                step.state === "current" && "border-2 border-primary bg-card ring-4 ring-tint-mint",
                step.state === "attention" && "border-2 border-amber-500 bg-card ring-4 ring-tint-amber",
                step.state === "pending" && "border-2 border-border bg-card",
                compact && "ring-0",
              )}
            >
              {step.state === "done" ? <Check className={compact ? "size-2.5" : "size-3.5"} strokeWidth={3} aria-hidden="true" /> : null}
              {step.state === "current" ? <span className={cn("rounded-full bg-primary", compact ? "size-1.5" : "size-2.5")} /> : null}
              {step.state === "attention" ? <span className={cn("rounded-full bg-amber-500", compact ? "size-1.5" : "size-2.5")} /> : null}
            </span>
            <span
              className={cn(
                "mt-2 truncate text-step",
                compact && "sr-only",
                step.state === "pending" ? "text-muted-foreground" : "font-medium text-foreground",
                step.state === "attention" && "text-amber-700 dark:text-amber-400",
              )}
            >
              {step.name}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
