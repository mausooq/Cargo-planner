"use server"

import { AuthError } from "next-auth"
import { loginSchema } from "@compass/domain"
import { signIn } from "@/auth"
import { safeNextPath } from "@/lib/session"

export async function loginAction(input: {
  email: string
  password: string
  callbackUrl?: string
}): Promise<{ error: string } | void> {
  const parsed = loginSchema.safeParse({
    email: input.email,
    password: input.password,
  })
  if (!parsed.success) return { error: "Enter a valid email and password." }

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: safeNextPath(input.callbackUrl),
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Those credentials were not recognized." }
    }
    throw error
  }
}
