import Link from "next/link"
import { roleLabel, type Role } from "@compass/domain"
import { signOutAction } from "@/app/actions/logout"
import { CompassMark } from "@/components/compass-mark"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"

export type HeaderUser = {
  name?: string | null
  email?: string | null
  role: Role
  orgName: string
}

export function SiteHeader({ user }: { user: HeaderUser | null }) {
  return (
    <header className="sticky top-0 z-30 border-b bg-card">
      <div className="mx-auto flex h-12 w-full max-w-[1800px] items-center gap-4 px-4">
        <Link href={user ? "/dashboard" : "/"} className="flex items-center gap-2 text-sm font-semibold">
          <CompassMark className="size-5 text-primary" />
          Compass
        </Link>
        {user ? (
          <nav className="flex items-center gap-1 text-sm" aria-label="Primary">
            <Link href="/dashboard" className="rounded-md px-2.5 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
              Projects
            </Link>
            <Link href="/equipment" className="rounded-md px-2.5 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
              Equipment
            </Link>
          </nav>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          {user ? (
            <>
              <div className="hidden text-right sm:block">
                <p className="text-xs leading-tight font-medium">{user.name}</p>
                <p className="text-xs text-muted-foreground">
                  {roleLabel(user.role)} · {user.orgName}
                </p>
              </div>
              <form action={signOutAction}>
                <Button type="submit" variant="outline" size="sm">
                  Sign out
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
