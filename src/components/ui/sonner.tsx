"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

function Toaster({ ...props }: ToasterProps) {
  const { resolvedTheme } = useTheme()
  const theme = resolvedTheme === "dark" ? "dark" : "light"
  // Top centre keeps toasts clear of the planner's sticky Back / Next bar at the bottom.
  return <Sonner theme={theme} className="toaster group" position="top-center" richColors closeButton {...props} />
}

export { Toaster }
