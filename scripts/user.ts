/**
 * Create a user or change a password, for servers where the shared demo password must not be used.
 *
 *   pnpm user:set <email> <password> [--name "Full Name"] [--role ADMIN|PLANNER|VIEWER]
 *
 * New users join the organization created by the seed. Existing users keep their name and role
 * unless --name or --role is given. Passwords must be at least 10 characters.
 */
import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"
import { DEMO_ORG_ID } from "../src/lib/demo-accounts"

const ROLES = ["ADMIN", "PLANNER", "VIEWER"] as const
type Role = (typeof ROLES)[number]

function usage(message?: string): never {
  if (message) console.error(`Error: ${message}\n`)
  console.error('Usage: pnpm user:set <email> <password> [--name "Full Name"] [--role ADMIN|PLANNER|VIEWER]')
  process.exit(1)
}

function parseArgs(argv: string[]) {
  const positional: string[] = []
  let name: string | undefined
  let role: Role | undefined
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string
    if (arg === "--name") name = argv[(index += 1)]
    else if (arg === "--role") {
      const value = argv[(index += 1)]?.toUpperCase()
      if (!ROLES.includes(value as Role)) usage(`--role must be one of ${ROLES.join(", ")}`)
      role = value as Role
    } else positional.push(arg)
  }
  const [email, password] = positional
  if (!email || !password) usage()
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) usage("that does not look like an email address")
  if (password.length < 10) usage("use a password of at least 10 characters")
  return { email: email.toLowerCase(), password, name, role }
}

async function main() {
  const { email, password, name, role } = parseArgs(process.argv.slice(2))
  const prisma = new PrismaClient()
  try {
    const org = await prisma.organization.findUnique({ where: { id: DEMO_ORG_ID } })
    if (!org) usage("no organization found. Run `pnpm db:seed` once first.")
    const passwordHash = bcrypt.hashSync(password, 10)
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      await prisma.user.update({
        where: { email },
        data: { passwordHash, ...(name ? { name } : {}), ...(role ? { role } : {}) },
      })
      console.log(`Updated ${email}${role ? ` (role ${role})` : ""}. The new password works on the next sign-in.`)
    } else {
      await prisma.user.create({
        data: { email, passwordHash, name: name ?? email.split("@")[0] ?? email, role: role ?? "PLANNER", orgId: org.id },
      })
      console.log(`Created ${email} with role ${role ?? "PLANNER"}.`)
    }
  } finally {
    await prisma.$disconnect()
  }
}

void main()
