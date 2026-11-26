"use client"

import { useEffect, useId, useRef, useState, type ComponentType, type KeyboardEvent } from "react"
import { Check, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

export type SelectMenuOption<T extends string> = { value: T; label: string; icon?: ComponentType<{ className?: string }> }

/**
 * A styled single-choice menu (a button that opens a listbox), replacing a native <select> where the look matters.
 *
 * Keyboard: Enter, Space, Arrow Up/Down open it; Arrow keys, Home and End move; Enter or Space chooses; Escape or
 * Tab closes; typing a letter jumps to the next option starting with it. Focus returns to the button on close.
 * The open/close fade follows the global reduced-motion setting.
 */
export function SelectMenu<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T
  options: SelectMenuOption<T>[]
  onChange: (value: T) => void
  /** Accessible name of the control. */
  label: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const id = useId()
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value))
  const selected = options[selectedIndex]

  function show(at = selectedIndex) {
    setActive(at)
    setOpen(true)
  }

  function close(focusButton = true) {
    setOpen(false)
    if (focusButton) button.current?.focus()
  }

  function choose(index: number) {
    const option = options[index]
    if (option) onChange(option.value)
    close()
  }

  // Move focus into the list when it opens, and close it on a click outside.
  useEffect(() => {
    if (!open) return
    list.current?.focus()
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  function onButtonKey(event: KeyboardEvent) {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault()
      show(event.key === "ArrowUp" ? Math.max(0, selectedIndex - 1) : selectedIndex)
    }
  }

  function onListKey(event: KeyboardEvent) {
    const last = options.length - 1
    const keys: Record<string, () => void> = {
      ArrowDown: () => setActive((index) => Math.min(last, index + 1)),
      ArrowUp: () => setActive((index) => Math.max(0, index - 1)),
      Home: () => setActive(0),
      End: () => setActive(last),
      Enter: () => choose(active),
      " ": () => choose(active),
      Escape: () => close(),
      Tab: () => close(false),
    }
    const action = keys[event.key]
    if (action) {
      if (event.key !== "Tab") event.preventDefault()
      action()
      return
    }
    if (event.key.length === 1 && /\S/.test(event.key)) {
      const letter = event.key.toLowerCase()
      const order = [...options.keys()].map((step) => (active + 1 + step) % options.length)
      const next = order.find((index) => options[index]!.label.toLowerCase().startsWith(letter))
      if (next !== undefined) setActive(next)
    }
  }

  const SelectedIcon = selected?.icon
  return (
    <div ref={root} className={cn("relative", className)}>
      <button
        ref={button}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-label={`${label}: ${selected?.label ?? ""}`}
        onClick={() => (open ? close() : show())}
        onKeyDown={onButtonKey}
        className={cn(
          "press flex h-11 w-full items-center gap-2 rounded-xl border bg-card pr-3 pl-3.5 text-left text-option shadow-soft outline-none hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/40",
          open && "border-primary/60 ring-[3px] ring-ring/15",
        )}
      >
        {SelectedIcon ? <SelectedIcon className="size-4 shrink-0 text-tint-mint-foreground" aria-hidden="true" /> : null}
        <span className="min-w-0 flex-1 truncate">{selected?.label}</span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-180")} aria-hidden="true" />
      </button>
      <ul
        ref={list}
        id={`${id}-list`}
        role="listbox"
        aria-label={label}
        tabIndex={-1}
        aria-activedescendant={open ? `${id}-option-${active}` : undefined}
        onKeyDown={onListKey}
        // Visibility switches on at once when opening (a hidden list cannot take focus) and only after the fade when closing.
        style={{ transition: `opacity 200ms ease-out, transform 200ms ease-out, visibility 0s linear ${open ? "0s" : "200ms"}` }}
        className={cn(
          "absolute right-0 z-40 mt-2 min-w-full origin-top-right space-y-0.5 rounded-xl border bg-popover p-1.5 shadow-lift outline-none",
          open ? "visible translate-y-0 scale-100 opacity-100" : "pointer-events-none invisible -translate-y-1 scale-[0.98] opacity-0",
        )}
      >
        {options.map((option, index) => {
          const Icon = option.icon
          const isSelected = option.value === value
          return (
            <li
              key={option.value}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={isSelected}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
              className={cn(
                "flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 text-option whitespace-nowrap select-none",
                index === active && "bg-tint-mint/70",
                isSelected ? "text-tint-mint-foreground" : "text-foreground",
              )}
            >
              {Icon ? <Icon className={cn("size-4 shrink-0", isSelected ? "text-tint-mint-foreground" : "text-muted-foreground")} aria-hidden="true" /> : null}
              <span className="flex-1">{option.label}</span>
              <Check className={cn("size-4 shrink-0 text-primary", !isSelected && "invisible")} strokeWidth={2.5} aria-hidden="true" />
            </li>
          )
        })}
      </ul>
    </div>
  )
}
