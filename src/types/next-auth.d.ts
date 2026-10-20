import type { DefaultSession } from "next-auth"
import type { Role } from "@compass/domain"

declare module "next-auth" {
  interface User {
    role: Role
    orgId: string
    orgName: string
  }

  interface Session {
    user: {
      id: string
      role: Role
      orgId: string
      orgName: string
    } & DefaultSession["user"]
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: Role
    orgId?: string
    orgName?: string
  }
}

export {}
