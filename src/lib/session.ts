import { redirect } from "next/navigation"
import { auth } from "@/auth"

export async function requireUser() {
  const session = await auth()
  if (!session?.user) redirect("/login")
  return session.user
}

export function safeNextPath(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/equipment"
  return value
}
