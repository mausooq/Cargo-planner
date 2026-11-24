/** Longest side, in pixels, kept when a photo is shrunk before upload. Plenty to read a printed table. */
export const MAX_IMAGE_SIDE = 2400
/** Images already this small are sent as they are. */
const SMALL_ENOUGH_BYTES = 1.5 * 1024 * 1024

/** New width and height that fit inside maxSide while keeping the shape. Never enlarges. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxSide || longest === 0) return { width, height }
  const scale = maxSide / longest
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/**
 * Browser only. Shrinks a large photo to a JPEG that is quick to upload. Returns the original file
 * when it is already small, or when the browser cannot decode it.
 */
export async function shrinkImage(file: File): Promise<File> {
  if (file.size <= SMALL_ENOUGH_BYTES && file.type !== "image/bmp") return file
  try {
    const bitmap = await createImageBitmap(file)
    const size = fitWithin(bitmap.width, bitmap.height, MAX_IMAGE_SIDE)
    const canvas = document.createElement("canvas")
    canvas.width = size.width
    canvas.height = size.height
    const context = canvas.getContext("2d")
    if (!context) return file
    // White behind transparent screenshots so text stays readable once saved as JPEG.
    context.fillStyle = "#ffffff"
    context.fillRect(0, 0, size.width, size.height)
    context.drawImage(bitmap, 0, 0, size.width, size.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9))
    if (!blob || blob.size >= file.size) return file
    const name = file.name.replace(/\.[^.]+$/, "") || "packing-list"
    return new File([blob], `${name}.jpg`, { type: "image/jpeg" })
  } catch {
    return file
  }
}
