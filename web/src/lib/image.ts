/** Client-side image preparation: profile photos and stories are resized and re-encoded
 * as small JPEG data URLs, so no separate file storage is needed and uploads stay tiny. */
interface Options {
  maxSide: number
  quality?: number
  square?: boolean
  maxChars: number
}

export async function imageFileToDataUrl(file: File, { maxSide, quality = 0.82, square = false, maxChars }: Options): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file.')
  if (file.size > 25 * 1024 * 1024) throw new Error('That image is too large. Choose one under 25 MB.')
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => {
    throw new Error('This image format is not supported. Try a JPEG or PNG.')
  })
  try {
    const side = square ? Math.min(bitmap.width, bitmap.height) : 0
    const sx = square ? (bitmap.width - side) / 2 : 0
    const sy = square ? (bitmap.height - side) / 2 : 0
    const sw = square ? side : bitmap.width
    const sh = square ? side : bitmap.height
    const scale = Math.min(1, maxSide / Math.max(sw, sh))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(sw * scale))
    canvas.height = Math.max(1, Math.round(sh * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not process this image.')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
    for (let q = quality; q >= 0.4; q -= 0.1) {
      const dataUrl = canvas.toDataURL('image/jpeg', q)
      if (dataUrl.length <= maxChars) return dataUrl
    }
    throw new Error('That image is still too large after compression. Try a simpler photo.')
  } finally {
    bitmap.close()
  }
}

export const AVATAR_OPTIONS: Options = { maxSide: 256, quality: 0.8, square: true, maxChars: 58_000 }
export const STORY_OPTIONS: Options = { maxSide: 900, quality: 0.78, maxChars: 440_000 }
