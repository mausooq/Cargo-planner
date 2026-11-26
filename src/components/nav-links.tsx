"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

const LINKS = [
  { href: "/dashboard", label: "Projects", match: ["/dashboard", "/projects"] },
  { href: "/equipment", label: "Equipment", match: ["/equipment"] },
]

export function NavLinks() {
  const pathname = usePathname()
  return (
    <nav className="flex items-center gap-0.5 text-nav sm:gap-1" aria-label="Primary">
      {LINKS.map((link) => {
        const active = link.match.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-full px-2.5 py-1.5 outline-none sm:px-4 focus-visible:ring-[3px] focus-visible:ring-ring/40",
              active ? "bg-primary text-primary-foreground shadow-card" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}
