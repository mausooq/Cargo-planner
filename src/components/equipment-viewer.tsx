"use client"

import { Edges, OrbitControls } from "@react-three/drei"
import { Canvas } from "@react-three/fiber"
import { Suspense, useMemo } from "react"
import { DimensionMarks } from "@/components/dimension-marks"
import { AirContourMesh, AirPalletMesh } from "@/components/equipment-hull"
import type { EquipmentListItem } from "@/lib/equipment-catalog"
import { visualKind, type VisualKind } from "@/lib/equipment-shape"
import { resolveEquipmentContour, uldContourVolumeM3, type UldContour } from "@/lib/uld-contour"

export const SCALE = 0.01
const WHEEL_R = 0.26

export type ViewerItem = Pick<
  EquipmentListItem,
  | "innerLengthCm"
  | "innerWidthCm"
  | "innerHeightCm"
  | "axleGroups"
  | "heightOpen"
  | "name"
  | "mode"
  | "oogClass"
  | "contour"
>

export function EquipmentViewer({
  item,
  className,
}: {
  item: ViewerItem
  className?: string
}) {
  const length = item.innerLengthCm * SCALE
  const width = item.innerWidthCm * SCALE
  const height = Math.max(item.innerHeightCm * SCALE, 0.16)
  const contour = resolveEquipmentContour(item.name, item.contour)
  const kind = visualKind({ ...item, contour })
  const volumeM3 = uldContourVolumeM3(item.innerLengthCm, item.innerWidthCm, item.innerHeightCm, contour)
  const axlePositions = useMemo(() => wheelPositions(item, length), [item, length])
  const deckY = axlePositions.length > 0 ? WHEEL_R * 2 : 0
  const midY = deckY + height / 2
  const reach = Math.max(length, width, height + deckY)
  const cameraPos = useMemo<[number, number, number]>(
    () => [reach * 0.95, Math.max(midY + reach * 0.28, 1.2), reach * 0.95],
    [midY, reach],
  )

  return (
    <div className={className ?? "h-72 w-full overflow-hidden rounded-md border bg-white"}>
      <Canvas key={item.name} camera={{ position: cameraPos, fov: 38 }} gl={{ antialias: true }}>
        <color attach="background" args={["#ffffff"]} />
        <hemisphereLight args={["#ffffff", "#dfe6ea", 1.35]} />
        <ambientLight intensity={1.5} />
        <directionalLight position={[10, 14, 8]} intensity={1.8} />
        <directionalLight position={[-8, 6, -6]} intensity={0.7} />
        <group position={[-length / 2, 0, -width / 2]}>
          <EquipmentMesh
            kind={kind}
            mode={item.mode}
            name={item.name}
            length={length}
            width={width}
            height={height}
            axlePositions={axlePositions}
            deckY={deckY}
            contour={contour}
          />
          <Suspense fallback={null}>
              <DimensionMarks
                length={length}
                width={width}
                height={height}
                lengthCm={item.innerLengthCm}
                widthCm={item.innerWidthCm}
                heightCm={item.innerHeightCm}
                baseY={deckY}
                volumeM3={volumeM3}
                contour={contour}
              />
          </Suspense>
        </group>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]}>
          <planeGeometry args={[reach * 3, reach * 3]} />
          <meshBasicMaterial color="#eef2f4" />
        </mesh>
        <OrbitControls makeDefault enablePan enableZoom target={[0, midY, 0]} />
      </Canvas>
    </div>
  )
}

function EquipmentMesh({
  kind,
  mode,
  name,
  length,
  width,
  height,
  axlePositions,
  deckY,
  contour,
}: {
  kind: VisualKind
  mode: ViewerItem["mode"]
  name: string
  length: number
  width: number
  height: number
  axlePositions: number[]
  deckY: number
  contour: UldContour | null
}) {
  if (kind === "PALLET") return <PalletMesh length={length} width={width} />
  if (kind === "BOLSTER") {
    return <DeckMesh length={length} width={width} thickness={0.16} color="#8f989f" />
  }
  if (kind === "AIR_PALLET") {
    return <AirPalletMesh name={name} length={length} width={width} height={height} />
  }
  if (kind === "AIR_CONTOUR") {
    return <AirContourMesh length={length} width={width} height={height} contour={contour} />
  }
  if (kind === "FLATBED") {
    return <Flatbed length={length} width={width} stations={axlePositions} deckY={deckY} />
  }
  if (kind === "STEPDECK") {
    return (
      <group>
        <DeckMesh length={length * 0.3} width={width} thickness={0.13} color="#aeb6bc" y={deckY + height * 0.2} />
        <DeckMesh length={length * 0.7} width={width} thickness={0.13} color="#aeb6bc" x={length * 0.3} y={deckY} />
        <Wheels stations={axlePositions} width={width} />
      </group>
    )
  }
  if (kind === "LOWBOY") {
    return (
      <group>
        <DeckMesh length={length * 0.2} width={width} thickness={0.13} color="#aeb6bc" y={deckY + height * 0.24} />
        <DeckMesh length={length * 0.56} width={width} thickness={0.13} color="#aeb6bc" x={length * 0.2} y={deckY} />
        <DeckMesh length={length * 0.24} width={width} thickness={0.13} color="#aeb6bc" x={length * 0.76} y={deckY + height * 0.16} />
        <Wheels stations={axlePositions} width={width} />
      </group>
    )
  }
  if (kind === "TRUCK") {
    return (
      <group>
        <mesh position={[length * 0.1, deckY + height * 0.38, width / 2]}>
          <boxGeometry args={[length * 0.2, height * 0.62, width * 0.9]} />
          <meshStandardMaterial color="#1f9d4a" roughness={0.55} />
        </mesh>
        <ClosedBox length={length * 0.76} width={width} height={height} x={length * 0.24} y={deckY} sea />
        <Wheels stations={axlePositions} width={width} />
      </group>
    )
  }
  if (kind === "OPEN_BOX") {
    return (
      <group>
        <OpenBox length={length} width={width} height={height} y={deckY} />
        {axlePositions.length > 0 ? <Wheels stations={axlePositions} width={width} /> : null}
      </group>
    )
  }
  return (
    <group>
      <ClosedBox length={length} width={width} height={height} y={deckY} sea={mode === "SEA"} />
      {axlePositions.length > 0 ? <Wheels stations={axlePositions} width={width} /> : null}
    </group>
  )
}

function Flatbed({
  length,
  width,
  stations,
  deckY,
}: {
  length: number
  width: number
  stations: number[]
  deckY: number
}) {
  return (
    <group>
      <DeckMesh length={length} width={width} thickness={0.12} color="#b4bbc1" y={deckY} />
      {[-0.32, 0, 0.32].map((offset) => (
        <mesh key={offset} position={[length / 2, deckY + 0.13, width / 2 + offset * width * 0.9]}>
          <boxGeometry args={[length, 0.02, 0.05]} />
          <meshStandardMaterial color="#9aa3aa" roughness={0.7} />
        </mesh>
      ))}
      <mesh position={[0.08, deckY + 0.42, width / 2]}>
        <boxGeometry args={[0.1, 0.72, width]} />
        <meshStandardMaterial color="#8b939a" roughness={0.65} />
      </mesh>
      <mesh position={[0.16, deckY + 0.02, width / 2]}>
        <boxGeometry args={[0.18, 0.05, width * 0.35]} />
        <meshStandardMaterial color="#6b7280" roughness={0.6} />
      </mesh>
      <mesh position={[length * 0.22, deckY * 0.45, width / 2]}>
        <boxGeometry args={[0.06, Math.max(deckY * 0.7, 0.12), 0.06]} />
        <meshStandardMaterial color="#4b5563" roughness={0.6} />
      </mesh>
      <Wheels stations={stations} width={width} />
    </group>
  )
}

function ClosedBox({
  length,
  width,
  height,
  x = 0,
  y = 0,
  sea = false,
}: {
  length: number
  width: number
  height: number
  x?: number
  y?: number
  sea?: boolean
}) {
  const ribs = sea ? 12 : 8
  const cast = 0.1
  return (
    <group position={[x, y, 0]}>
      <mesh position={[length / 2, 0.04, width / 2]}>
        <boxGeometry args={[length, 0.08, width]} />
        <meshStandardMaterial color="#8b949b" roughness={0.7} />
      </mesh>
      <mesh position={[length / 2, height / 2, width / 2]}>
        <boxGeometry args={[length, height, width]} />
        <meshStandardMaterial color={sea ? "#d5dce1" : "#cfd8dd"} roughness={0.45} />
        <Edges color="#4b5563" />
      </mesh>
      {Array.from({ length: ribs }, (_, index) => {
        const along = ((index + 0.5) / ribs) * length
        return (
          <mesh key={along} position={[along, height / 2, width / 2]}>
            <boxGeometry args={[0.04, height * 0.92, width + 0.02]} />
            <meshStandardMaterial color="#b7c0c6" roughness={0.5} />
          </mesh>
        )
      })}
      <mesh position={[length - 0.03, height / 2, width / 2]}>
        <boxGeometry args={[0.05, height * 0.94, width * 0.94]} />
        <meshStandardMaterial color="#3fad5c" roughness={0.45} />
      </mesh>
      {[-0.18, 0.18].map((offset) => (
        <mesh key={offset} position={[length - 0.02, height / 2, width / 2 + offset * width]}>
          <boxGeometry args={[0.03, height * 0.82, 0.03]} />
          <meshStandardMaterial color="#374151" roughness={0.5} />
        </mesh>
      ))}
      {sea
        ? [0, 1].flatMap((end) =>
            [0, 1].flatMap((side) =>
              [0, 1].map((top) => (
                <mesh key={`${end}-${side}-${top}`} position={[end * length, top * height, side * width]}>
                  <boxGeometry args={[cast, cast, cast]} />
                  <meshStandardMaterial color="#6b7280" roughness={0.5} />
                </mesh>
              )),
            ),
          )
        : null}
    </group>
  )
}

function OpenBox({ length, width, height, y = 0 }: { length: number; width: number; height: number; y?: number }) {
  const wall = 0.06
  return (
    <group position={[0, y, 0]}>
      <mesh position={[length / 2, 0.04, width / 2]}>
        <boxGeometry args={[length, 0.08, width]} />
        <meshStandardMaterial color="#8b949b" roughness={0.7} />
      </mesh>
      <mesh position={[wall / 2, height / 2, width / 2]}>
        <boxGeometry args={[wall, height, width]} />
        <meshStandardMaterial color="#d5dce1" roughness={0.5} />
      </mesh>
      <mesh position={[length / 2, height / 2, wall / 2]}>
        <boxGeometry args={[length, height, wall]} />
        <meshStandardMaterial color="#d5dce1" roughness={0.5} />
      </mesh>
      <mesh position={[length / 2, height / 2, width - wall / 2]}>
        <boxGeometry args={[length, height, wall]} />
        <meshStandardMaterial color="#d5dce1" roughness={0.5} />
      </mesh>
    </group>
  )
}

function DeckMesh({
  length,
  width,
  thickness,
  color,
  x = 0,
  y = 0,
}: {
  length: number
  width: number
  thickness: number
  color: string
  x?: number
  y?: number
}) {
  return (
    <mesh position={[x + length / 2, y + thickness / 2, width / 2]}>
      <boxGeometry args={[length, thickness, width]} />
      <meshStandardMaterial color={color} roughness={0.72} />
    </mesh>
  )
}

function PalletMesh({ length, width }: { length: number; width: number }) {
  const stringer = Math.max(0.05, width * 0.08)
  return (
    <group>
      {[-0.4, 0, 0.4].map((offset) => (
        <mesh key={offset} position={[length / 2, 0.04, width / 2 + offset * width * 0.38]}>
          <boxGeometry args={[length * 0.98, 0.08, stringer]} />
          <meshStandardMaterial color="#b0894f" roughness={0.8} />
        </mesh>
      ))}
      {[-0.4, -0.13, 0.13, 0.4].map((offset) => (
        <mesh key={`deck-${offset}`} position={[length / 2 + offset * length * 0.42, 0.1, width / 2]}>
          <boxGeometry args={[stringer * 0.9, 0.03, width * 0.98]} />
          <meshStandardMaterial color="#d2b07a" roughness={0.75} />
        </mesh>
      ))}
    </group>
  )
}

function Wheels({ stations, width }: { stations: number[]; width: number }) {
  return (
    <group>
      {stations.map((x) =>
        [-1, 1].flatMap((side) =>
          [-0.16, 0.16].map((pair) => (
            <group
              key={`${x}-${side}-${pair}`}
              position={[x, WHEEL_R, width / 2 + side * (width / 2 - 0.18) + pair * side * 0.08]}
              rotation={[Math.PI / 2, 0, 0]}
            >
              <mesh>
                <cylinderGeometry args={[WHEEL_R, WHEEL_R, 0.14, 24]} />
                <meshStandardMaterial color="#1c2126" roughness={0.6} />
              </mesh>
              <mesh>
                <cylinderGeometry args={[WHEEL_R * 0.45, WHEEL_R * 0.45, 0.15, 16]} />
                <meshStandardMaterial color="#9aa3aa" metalness={0.2} roughness={0.45} />
              </mesh>
            </group>
          )),
        ),
      )}
    </group>
  )
}

function wheelPositions(item: ViewerItem, length: number): number[] {
  const roadOrChassis =
    item.mode === "ROAD" || item.name.toLowerCase().includes("chassis") || item.name.toLowerCase().includes("roll")
  if (!roadOrChassis && item.axleGroups.length === 0) return []
  const axles = item.axleGroups.filter((axle) => !axle.name.toLowerCase().includes("kingpin"))
  if (axles.length > 0) return axles.map((axle) => axle.positionFromFrontCm * SCALE)
  return [length * 0.7, length * 0.84]
}
