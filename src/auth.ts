import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { loginSchema, roleSchema } from "@compass/domain"
import { authConfig } from "@/auth.config"
import { prisma } from "@/lib/prisma"

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const parsed = loginSchema.safeParse(credentials)
        if (!parsed.success) return null

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email.toLowerCase() },
          include: { org: true },
        })
        if (!user) return null

        const passwordOk = await bcrypt.compare(parsed.data.password, user.passwordHash)
        if (!passwordOk) return null

        const role = roleSchema.safeParse(user.role)
        if (!role.success) return null

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: role.data,
          orgId: user.orgId,
          orgName: user.org.name,
        }
      },
    }),
  ],
})
