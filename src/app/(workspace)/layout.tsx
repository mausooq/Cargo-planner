import type { ReactNode } from "react"
import { SiteHeader } from "@/components/site-header"
import { requireUser } from "@/lib/session"

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const user = await requireUser()
  return (
    <div className="flex min-h-full flex-col">
      <SiteHeader user={user} />
      <div className="flex-1">{children}</div>
    </div>
  )
}
