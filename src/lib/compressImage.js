/**
 * Resizes+compresses an image file client-side before upload — phone
 * camera photos are routinely 3-10MB for what renders as a ~40px circle.
 * Uses only native browser APIs (createImageBitmap + canvas), no new
 * dependency. Returns a JPEG Blob.
 */
import i18n from './i18n'

export async function compressImage(file, { maxSize = 480, quality = 0.85 } = {}) {
  if (file.size > 15 * 1024 * 1024) {
    throw new Error(i18n.t('image.too_big'))
  }

  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(i18n.t('image.compress_failed')))),
      'image/jpeg',
      quality
    )
  })
}
