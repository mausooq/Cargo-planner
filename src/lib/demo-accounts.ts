import type { Role } from "@compass/domain"

export const DEMO_ORG_ID = "org_compass_demo"
export const DEMO_ORG_NAME = "Compass Demo"
export const DEMO_PASSWORD = "compass-demo"

export const DEMO_ACCOUNTS: { email: string; name: string; role: Role }[] = [
  { email: "admin@compass.local", name: "Compass Admin", role: "ADMIN" },
  { email: "planner@compass.local", name: "Compass Planner", role: "PLANNER" },
  { email: "viewer@compass.local", name: "Compass Viewer", role: "VIEWER" },
]
