import type { NextAuthConfig } from "next-auth"
import type { Role } from "@compass/domain"

export const authConfig = {
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const path = request.nextUrl.pathname
      const isProtected =
        path.startsWith("/equipment") || path.startsWith("/dashboard") || path.startsWith("/projects")
      if (!isProtected) return true
      return Boolean(auth?.user)
    },
    jwt({ token, user }) {
      if (user) {
        token.role = user.role
        token.orgId = user.orgId
        token.orgName = user.orgName
      }
      return token
    },
    session({ session, token }) {
      session.user.id = token.sub ?? ""
      session.user.role = isRole(token.role) ? token.role : "VIEWER"
      session.user.orgId = typeof token.orgId === "string" ? token.orgId : ""
      session.user.orgName = typeof token.orgName === "string" ? token.orgName : ""
      return session
    },
  },
} satisfies NextAuthConfig

function isRole(value: unknown): value is Role {
  return value === "ADMIN" || value === "PLANNER" || value === "VIEWER"
}
