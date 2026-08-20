import { supabase } from './supabase'
import { compressImage } from './compressImage'

const BUCKET = 'club-logos'

function logoPath(orgId) {
  return `${orgId}/logo.jpg`
}

/**
 * Compresses, uploads (overwriting any previous logo at the same fixed
 * path), and returns a cache-busted public URL to save onto
 * organizations.group_logo_url. Without the ?v= query param, a browser
 * could keep showing a stale cached image after the logo changes, since
 * the underlying path never changes.
 */
export async function uploadClubLogo(orgId, file) {
  const blob = await compressImage(file)
  const path = logoPath(orgId)

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: true })
  if (error) throw error

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return `${data.publicUrl}?v=${Date.now()}`
}

export async function removeClubLogo(orgId) {
  const { error } = await supabase.storage.from(BUCKET).remove([logoPath(orgId)])
  if (error) throw error
}
