import Link from "next/link"
import { Box, Plane, Ship, Truck } from "lucide-react"
import { modeLabel, type EquipmentMode } from "@compass/domain"
import { auth } from "@/auth"
import { SiteHeader } from "@/components/site-header"
import { Button } from "@/components/ui/button"
import { countEquipmentByMode } from "@/lib/equipment-catalog"

export const dynamic = "force-dynamic"

const MODES: { mode: EquipmentMode; icon: typeof Ship }[] = [
  { mode: "SEA", icon: Ship },
  { mode: "ROAD", icon: Truck },
  { mode: "AIR", icon: Plane },
  { mode: "PALLET", icon: Box },
]

export default async function HomePage() {
  const session = await auth()
  const counts = await countEquipmentByMode(session?.user.orgId ?? "")
  const total = counts.SEA + counts.AIR + counts.ROAD + counts.PALLET
  const start = session?.user ? "/dashboard" : "/login"

  return (
    <>
      <SiteHeader user={session?.user ?? null} />
      <main id="main" className="mx-auto w-full max-w-[1400px] px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b pb-5">
          <div>
            <h1 className="text-xl font-semibold">Cargo load planning</h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Pack cargo into sea containers, road trailers, air ULDs, and pallets. Dimensions are centimetres. Weight
              is kilograms.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href={start}>{session?.user ? "Open plans" : "Sign in"}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={session?.user ? "/equipment" : "/login"}>Equipment library</Link>
            </Button>
          </div>
        </div>

        <section className="mt-6 overflow-hidden rounded-md border bg-card" aria-label="Library counts">
          <table className="sheet-table w-full text-left text-sm">
            <thead className="bg-muted/70">
              <tr>
                <th className="px-3 py-2">Mode</th>
                <th className="px-3 py-2">Types</th>
              </tr>
            </thead>
            <tbody>
              {MODES.map((entry) => {
                const Icon = entry.icon
                return (
                  <tr key={entry.mode}>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-2">
                        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                        {modeLabel(entry.mode)}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-medium">{counts[entry.mode]}</td>
                  </tr>
                )
              })}
              <tr>
                <td className="px-3 py-2 text-muted-foreground">Total</td>
                <td className="px-3 py-2 font-medium">{total}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </main>
    </>
  )
}
