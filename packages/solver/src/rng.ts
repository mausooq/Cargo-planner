/** Small seedable generator (mulberry32). Same seed, same sequence. */
export function createRng(seed: number) {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (maxExclusive: number) => Math.floor(next() * maxExclusive),
    shuffle<T>(items: T[]): T[] {
      const copy = items.slice()
      for (let index = copy.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(next() * (index + 1))
        const held = copy[index] as T
        copy[index] = copy[swap] as T
        copy[swap] = held
      }
      return copy
    },
  }
}

export type Rng = ReturnType<typeof createRng>
