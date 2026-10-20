import { EquipmentCompare } from "@/components/equipment-compare"
import { listEquipmentForOrg } from "@/lib/equipment-catalog"
import { requireUser } from "@/lib/session"

export const dynamic = "force-dynamic"

export const metadata = { title: "Compare equipment" }

export default async function EquipmentComparePage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const user = await requireUser()
  const params = await searchParams
  const ids = [...new Set((params.ids ?? "").split(",").map((id) => id.trim()).filter(Boolean))].slice(0, 4)
  const library = await listEquipmentForOrg(user.orgId)
  const items = ids.flatMap((id) => {
    const item = library.find((entry) => entry.id === id)
    return item ? [item] : []
  })

  return (
    <main id="main" className="mx-auto w-full max-w-[1400px] px-4 py-6">
      <h1 className="text-xl font-semibold">Compare equipment</h1>
      <p className="mt-1 mb-4 text-sm text-muted-foreground">Up to four units, with specs and overlaid outlines.</p>
      <EquipmentCompare items={items} />
    </main>
  )
}
