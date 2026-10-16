// A capa do clube/grupo (Gerir › Clube, proposta A — Renato, 16 out).
// organizations.cover_url é NULL (a imagem do Alino de sempre), uma capa do
// alinho (/topo/*.webp) ou uma foto no balde club-logos, na pasta do clube:
//   <organization_id>/cover-<n>.jpg
// A base de dados só aceita estas três (migration_organization_cover.sql).
import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { CLUB_HERO, GROUP_HERO } from './kindColors'

const BUCKET = 'club-logos'

/** As capas do alinho para escolher: os renders 3D do Alino que a app já
 *  tem (os topos dos eventos), com nomes do que se vê — não do tipo de
 *  evento. As capas desenhadas/compostas à mão ficavam sem qualidade (Renato,
 *  16 out); capas próprias de clube, quando o designer as fizer, entram aqui.
 *  Sem escolha, fica a imagem do Alino do tipo. */
export const COVER_PRESETS = [
  { key: 'azul', url: '/topo/topo-mix.webp', labelKey: 'cover.preset_blue' },
  { key: 'trofeu', url: '/topo/topo-torneio.webp', labelKey: 'cover.preset_trophy' },
  { key: 'podio', url: '/topo/topo-liga.webp', labelKey: 'cover.preset_podium' },
  { key: 'terra', url: '/topo/topo-aberto.webp', labelKey: 'cover.preset_clay' },
  { key: 'treino', url: '/topo/topo-aula.webp', labelKey: 'cover.preset_practice' },
  { key: 'dupla', url: '/topo/topo-amigos.webp', labelKey: 'cover.preset_pair' },
]

/** A capa a mostrar: a escolhida, ou a do Alino do tipo. */
export const coverOf = (org, cover = org?.cover_url) =>
  cover || (org?.kind === 'group' ? GROUP_HERO : CLUB_HERO)

export const isPresetCover = (url) => !!url && url.startsWith('/topo/')

/**
 * Recorta a foto em panorâmico 3:1 (a posição vertical `y`, 0 = topo,
 * 1 = fundo, é a do ajuste na folha), comprime e carrega. Devolve o
 * endereço público, para gravar em organizations.cover_url.
 */
export async function uploadOrgCover(orgId, file, y = 0.5) {
  if (file.size > 15 * 1024 * 1024) throw new Error('Imagem demasiado grande (máx. 15MB)')
  const bmp = await createImageBitmap(file)
  let sw = bmp.width
  let sh = Math.round(bmp.width / 3)
  if (sh > bmp.height) { sh = bmp.height; sw = Math.round(bmp.height * 3) }
  const sx = Math.round((bmp.width - sw) / 2)
  const sy = Math.round((bmp.height - sh) * Math.min(1, Math.max(0, y)))
  const w = Math.min(1500, sw)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = Math.round(w / 3)
  canvas.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao comprimir a imagem'))), 'image/jpeg', 0.82))

  const path = `${orgId}/cover-${Date.now()}.jpg`
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (error) throw error
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

/** Apaga a foto antiga do balde (as capas do alinho não são ficheiros nossos). */
export async function removeOldCover(url) {
  const m = url && url.match(/\/club-logos\/(.+)$/)
  if (!m) return
  await supabase.storage.from(BUCKET).remove([decodeURIComponent(m[1])])
}

// As capas de vários clubes de uma vez (Comunidade, página do clube). Sem a
// migração, a função não existe e fica tudo com a imagem do Alino.
const cache = new Map()
export function useOrgCovers(ids) {
  const key = (ids || []).filter(Boolean).sort().join(',')
  const [covers, setCovers] = useState(() => Object.fromEntries((ids || []).filter((id) => cache.has(id)).map((id) => [id, cache.get(id)])))
  useEffect(() => {
    if (!key) return undefined
    const missing = key.split(',').filter((id) => !cache.has(id))
    if (!missing.length) {
      setCovers(Object.fromEntries(key.split(',').map((id) => [id, cache.get(id)])))
      return undefined
    }
    let alive = true
    supabase.rpc('get_org_covers', { p_ids: missing }).then(({ data, error }) => {
      if (error) return
      missing.forEach((id) => cache.set(id, null))
      ;(data || []).forEach((r) => cache.set(r.id, r.cover_url))
      if (alive) setCovers(Object.fromEntries(key.split(',').map((id) => [id, cache.get(id)])))
    })
    return () => { alive = false }
  }, [key])
  return covers
}

/** Depois de mudar a capa: o que está guardado em memória fica certo. */
export const rememberCover = (orgId, url) => cache.set(orgId, url || null)
