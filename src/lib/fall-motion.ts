/**
 * Motion for a piece dropping onto what is below it in the playground.
 *
 * Duration follows real free fall, t = sqrt(2h / g), slowed down so it reads clearly on screen and
 * kept between 220 ms (short hops still visible) and 650 ms (tall drops never feel sluggish).
 * The curve accelerates like gravity, then gives a small, quickly damped bounce on landing.
 */
const G_CM_PER_S2 = 981
const SLOW_MOTION = 1.6
const MIN_MS = 220
const MAX_MS = 650
/** Share of the duration spent falling; the rest is the landing settle. */
const FALL_SHARE = 0.78
/** Bounce height as a share of the drop, capped so tall drops don't jump around. */
const BOUNCE_SHARE = 0.06
const MAX_BOUNCE_CM = 4

export function fallDurationMs(dropCm: number): number {
  if (dropCm <= 0) return 0
  const freeFall = Math.sqrt((2 * dropCm) / G_CM_PER_S2) * 1000
  return Math.round(Math.min(MAX_MS, Math.max(MIN_MS, freeFall * SLOW_MOTION)) / FALL_SHARE)
}

/** Height (cm) at progress t in [0, 1] for a fall from `fromZ` to `toZ`. */
export function fallHeight(fromZ: number, toZ: number, t: number): number {
  const drop = fromZ - toZ
  if (drop <= 0 || t >= 1) return toZ
  if (t <= 0) return fromZ
  if (t < FALL_SHARE) {
    const p = t / FALL_SHARE
    return fromZ - drop * p * p // accelerating, like gravity
  }
  // Landing: one small bounce that dies away.
  const p = (t - FALL_SHARE) / (1 - FALL_SHARE)
  const bounce = Math.min(MAX_BOUNCE_CM, drop * BOUNCE_SHARE)
  return toZ + bounce * Math.sin(Math.PI * p) * (1 - p)
}

/** True when the user has asked the OS for less motion; falls then snap straight into place. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}
