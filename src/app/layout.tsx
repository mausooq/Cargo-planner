import type { Metadata } from "next"
import type { ReactNode } from "react"
import { Providers } from "@/components/providers"
import { Toaster } from "@/components/ui/sonner"
// Figtree, served from this app (no font CDN at runtime). Used through the --font-brand token.
import "@fontsource-variable/figtree/wght.css"
import "./globals.css"

export const metadata: Metadata = {
  title: {
    default: "Compass",
    template: "%s · Compass",
  },
  description: "Cargo load planning for sea containers, road trailers, air ULDs, and pallets.",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full">
      <body className="flex min-h-full flex-col font-sans" suppressHydrationWarning>
        <Providers>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:border focus:bg-card focus:px-3 focus:py-2"
          >
            Skip to content
          </a>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  )
}
