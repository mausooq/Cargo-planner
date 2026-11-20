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
    <nav className="flex items-center gap-1 text-sm" aria-label="Primary">
      {LINKS.map((link) => {
        const active = link.match.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-full px-3.5 py-1.5",
              active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}
