import { redirect } from "next/navigation"
import { auth } from "@/auth"

export async function requireUser() {
  const session = await auth()
  if (!session?.user) redirect("/login")
  return session.user
}

export function safeNextPath(value: string | undefined): string {
  // After sign-in people land on their projects unless they were sent to a specific page.
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/dashboard"
  return value
}
