import { canEditProjects, canManageEquipment, roleSchema, type Role } from "@compass/domain"
import { requireUser } from "@/lib/session"

type EditorUser = {
  id: string
  role: Role
  orgId: string
  orgName: string
  name?: string | null
  email?: string | null
}

export async function editorOrError(): Promise<{ ok: true; user: EditorUser } | { ok: false; error: string }> {
  const sessionUser = await requireUser()
  const role = roleSchema.safeParse(sessionUser.role)
  if (!role.success || !canEditProjects(role.data)) {
    return {
      ok: false,
      error: "Viewers can look, but only planners and admins can change a project.",
    }
  }
  return {
    ok: true,
    user: {
      id: sessionUser.id,
      role: role.data,
      orgId: sessionUser.orgId,
      orgName: sessionUser.orgName,
      name: sessionUser.name,
      email: sessionUser.email,
    },
  }
}

export async function adminOrError(): Promise<{ ok: true; user: EditorUser } | { ok: false; error: string }> {
  const access = await editorOrError()
  if (!access.ok) return access
  if (!canManageEquipment(access.user.role)) {
    return { ok: false, error: "Only an admin can add or change equipment." }
  }
  return access
}
