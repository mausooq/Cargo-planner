"use client"

import { ThemeProvider } from "next-themes"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    // Light is the default for everyone, whatever the computer's own setting. The sun/moon button
    // in the header still switches to dark, and that choice is remembered on that browser.
    // The storage key is new on purpose: choices saved while the app followed the computer's
    // setting are ignored once, so everyone starts in light.
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      storageKey="compass-theme"
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  )
}
