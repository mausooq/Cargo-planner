"use client"

import dynamic from "next/dynamic"
import Link from "next/link"
import { modeLabel } from "@compass/domain"
import type { EquipmentListItem } from "@/lib/equipment-catalog"
import { equipmentVolumeM3 } from "@/lib/equipment-metrics"
import { formatCm, formatEnvelope, formatKg, formatM3 } from "@/lib/format"

const COMPARE_COLORS = ["#9a3412", "#1e3a8a", "#3f6212", "#581c87"]

const EquipmentCompareCanvas = dynamic(
  () => import("@/components/equipment-compare-canvas").then((mod) => mod.EquipmentCompareCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="h-full min-h-80 animate-pulse bg-muted" role="status">
        <span className="sr-only">Loading comparison</span>
      </div>
    ),
  },
)

export function EquipmentCompare({ items }: { items: EquipmentListItem[] }) {
  return (
    <div className="space-y-4">
      <p className="text-sm">
        <Link href="/equipment" className="text-primary">
          Back to the library
        </Link>
      </p>
      {items.length === 0 ? (
        <div className="rounded-md border border-dashed bg-card px-4 py-8 text-center">
          <p className="text-sm font-medium">Choose units to compare</p>
          <p className="mt-1 text-sm text-muted-foreground">Select up to 4 types in the library, then open compare.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border bg-card">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-3 py-2 font-medium">Spec</th>
                  {items.map((item, index) => (
                    <th key={item.id} className="px-3 py-2 font-medium">
                      <span className="mr-2 inline-flex size-5 items-center justify-center rounded bg-neutral-950 text-[11px] text-white">
                        {index + 1}
                      </span>
                      <span className="inline-block size-2 rounded-full align-middle" style={{ backgroundColor: COMPARE_COLORS[index] }} />{" "}
                      {item.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <SpecRow label="Type" values={items.map((item) => modeLabel(item.mode))} />
                <SpecRow label="L × W × H" values={items.map((item) => formatEnvelope(item.innerLengthCm, item.innerWidthCm, item.innerHeightCm))} />
                <SpecRow label="Volume" values={items.map((item) => formatM3(equipmentVolumeM3(item)))} />
                <SpecRow label="Payload" values={items.map((item) => formatKg(item.maxPayloadKg))} />
                <SpecRow label="Tare" values={items.map((item) => formatKg(item.tareKg))} />
                <SpecRow
                  label="Door"
                  values={items.map((item) =>
                    item.doorWidthCm && item.doorHeightCm ? `${formatCm(item.doorWidthCm)} × ${formatCm(item.doorHeightCm)}` : "—",
                  )}
                />
              </tbody>
            </table>
          </div>
          <section className="overflow-hidden rounded-md border bg-white" aria-label="Overlaid outlines">
            <div className="border-b px-3 py-2 text-sm text-muted-foreground">Outlines share the same front-left corner. 1 is the first unit.</div>
            <div className="h-[28rem]">
              <EquipmentCompareCanvas items={items} />
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function SpecRow({ label, values }: { label: string; values: string[] }) {
  return (
    <tr className="border-b last:border-0">
      <th className="px-3 py-2 font-medium">{label}</th>
      {values.map((value, index) => (
        <td key={`${label}-${index}`} className="px-3 py-2">
          {value}
        </td>
      ))}
    </tr>
  )
}
