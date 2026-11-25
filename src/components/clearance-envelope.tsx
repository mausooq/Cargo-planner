"use client"

import { useEffect, useMemo } from "react"
import { BoxGeometry, EdgesGeometry } from "three"
import { itemSides } from "@/lib/clearance"
import type { PlanItemView } from "@/lib/plan-view"

const SCALE = 0.01

/**
 * The free space a piece keeps around it (its handling clearance), drawn as a translucent frame
 * that is wider than the piece by that piece's own clearance on each side. Directional values show
 * as an uneven frame and turn with the piece. Display only: it never takes part in picking or
 * dragging. Pieces with no clearance draw nothing.
 *
 * Amber is the reserved space. Red marks a piece whose reserved space is broken (a neighbour or a
 * wall is inside it); overlapping amber frames of two neighbours are normal, because they share the gap.
 */
export function ClearanceEnvelope({
  item,
  violation = false,
  emphasis = false,
}: {
  item: PlanItemView
  violation?: boolean
  /** Draw it stronger, for the selected piece. */
  emphasis?: boolean
}) {
  const s = itemSides(item)
  const length = (item.lengthCm + s.x0 + s.x1) * SCALE
  const width = (item.widthCm + s.y0 + s.y1) * SCALE
  const height = item.heightCm * SCALE
  const edges = useMemo(() => {
    const box = new BoxGeometry(length, height, width)
    const geometry = new EdgesGeometry(box)
    box.dispose()
    return geometry
  }, [height, length, width])
  useEffect(() => () => edges.dispose(), [edges])
  if (s.x0 <= 0 && s.x1 <= 0 && s.y0 <= 0 && s.y1 <= 0) return null
  const fill = violation ? "#ef4444" : "#f59e0b"
  const line = violation ? "#dc2626" : emphasis ? "#b45309" : "#d97706"
  return (
    <group
      position={[
        (item.x - s.x0 + (item.lengthCm + s.x0 + s.x1) / 2) * SCALE,
        (item.z + item.heightCm / 2) * SCALE,
        (item.y - s.y0 + (item.widthCm + s.y0 + s.y1) / 2) * SCALE,
      ]}
      raycast={() => null}
    >
      <mesh raycast={() => null}>
        <boxGeometry args={[length, height, width]} />
        <meshBasicMaterial color={fill} transparent opacity={violation ? 0.28 : emphasis ? 0.22 : 0.14} depthWrite={false} toneMapped={false} />
      </mesh>
      <lineSegments geometry={edges} raycast={() => null}>
        <lineBasicMaterial color={line} toneMapped={false} />
      </lineSegments>
    </group>
  )
}
