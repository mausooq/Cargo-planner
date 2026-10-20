"use client"

import dynamic from "next/dynamic"
import type { ViewerItem } from "@/components/equipment-viewer-canvas"

const EquipmentScene = dynamic(
  () => import("@/components/equipment-viewer-canvas").then((mod) => mod.EquipmentScene),
  {
    ssr: false,
    loading: () => <EquipmentViewerSkeleton />,
  },
)

export const SCALE = 0.01

export function EquipmentViewer({ item, className }: { item: ViewerItem; className?: string }) {
  return (
    <div className={className ?? "h-72 w-full overflow-hidden rounded-md border bg-white"}>
      <EquipmentScene item={item} />
    </div>
  )
}

export function EquipmentViewerSkeleton() {
  return (
    <div className="h-full min-h-48 w-full animate-pulse bg-muted" role="status">
      <span className="sr-only">Loading 3D view</span>
    </div>
  )
}
