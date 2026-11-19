import Link from "next/link"
import { redirect } from "next/navigation"
import { Box, Plane, Ship, Truck } from "lucide-react"
import { auth } from "@/auth"
import { SiteHeader } from "@/components/site-header"
import { Button } from "@/components/ui/button"

export const dynamic = "force-dynamic"

const MODES = [
  { icon: Ship, label: "Sea containers" },
  { icon: Truck, label: "Road trailers" },
  { icon: Plane, label: "Air ULDs" },
  { icon: Box, label: "Pallets" },
]

export default async function HomePage() {
  const session = await auth()
  // Signed-in users come here to work, not to read about the product.
  if (session?.user) redirect("/dashboard")

  return (
    <>
      <SiteHeader user={null} />
      <main id="main" className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-4 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">Load planning without the guesswork</h1>
        <p className="mt-3 max-w-xl text-muted-foreground">
          Enter or import your cargo, pick the equipment, and Compass packs it in 3D. Check weights and axle loads, adjust by
          hand, then print the plan for the warehouse.
        </p>
        <ul className="mt-6 flex flex-wrap gap-2 text-sm">
          {MODES.map(({ icon: Icon, label }) => (
            <li key={label} className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5">
              <Icon className="size-4 text-primary" aria-hidden="true" />
              {label}
            </li>
          ))}
        </ul>
        <div className="mt-8">
          <Button asChild size="lg">
            <Link href="/login">Sign in to start planning</Link>
          </Button>
        </div>
      </main>
    </>
  )
}
