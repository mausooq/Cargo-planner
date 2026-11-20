import Link from "next/link"
import { LogOut } from "lucide-react"
import { roleLabel, type Role } from "@compass/domain"
import { signOutAction } from "@/app/actions/logout"
import { CompassMark } from "@/components/compass-mark"
import { NavLinks } from "@/components/nav-links"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"

export type HeaderUser = {
  name?: string | null
  email?: string | null
  role: Role
  orgName: string
}

function initials(user: HeaderUser): string {
  const source = (user.name ?? user.email ?? "?").trim()
  const parts = source.split(/[\s@._-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase()
}

export function SiteHeader({ user }: { user: HeaderUser | null }) {
  return (
    <header className="sticky top-0 z-30 border-b bg-card/90 backdrop-blur print:hidden">
      <div className="mx-auto flex h-14 w-full max-w-[1800px] items-center gap-5 px-4">
        <Link href={user ? "/dashboard" : "/"} className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-card">
            <CompassMark className="size-5" />
          </span>
          Compass
        </Link>
        {user ? <NavLinks /> : null}
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          {user ? (
            <>
              <div className="flex items-center gap-2.5 rounded-full border bg-background py-1 pr-3 pl-1" title={user.email ?? undefined}>
                <span
                  className="flex size-7 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary"
                  aria-hidden="true"
                >
                  {initials(user)}
                </span>
                <div className="hidden leading-tight sm:block">
                  <p className="text-xs font-medium">{user.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {roleLabel(user.role)} · {user.orgName}
                  </p>
                </div>
              </div>
              <form action={signOutAction}>
                <Button type="submit" variant="ghost" size="icon" aria-label="Sign out" title="Sign out">
                  <LogOut className="size-4" />
                </Button>
              </form>
            </>
          ) : (
            <Button asChild size="sm">
              <Link href="/login">Sign in</Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  )
}
