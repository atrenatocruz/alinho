/* Molduras do pódio do mês (design-handoff/2026-10-12-molduras-podio,
   aprovado pelo Francisco a 12 out). Quem fecha o mês no pódio usa, no mês
   seguinte inteiro, uma moldura à volta da foto: ouro (1.º), prata (2.º) ou
   bronze (3.º). Quem tem que moldura vem da get_user_frames do Dev 3 (#626);
   aqui só se lê, com uma memória por sessão para cada lista não repetir o
   pedido. */
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export const FRAME_KINDS = ['ouro', 'prata', 'bronze']

// O tamanho de cada imagem e o buraco do meio (centro e raio, em píxeis da
// imagem) — design-handoff/2026-10-12-molduras-podio/app/medidas.json.
export const FRAME_GEOMETRY = {
  ouro: { w: 431, h: 512, cx: 214.8, cy: 273.5, r: 143.3 },
  prata: { w: 483, h: 512, cx: 241.3, cy: 247.8, r: 162.4 },
  bronze: { w: 512, h: 509, cx: 255.5, cy: 262.4, r: 152.4 },
}

export const frameSrc = (frame) => `/molduras/moldura-${frame}.webp`

// Os títulos do pódio e a cor de cada um (SPEC, ponto 4).
export const FRAME_TITLE_KEY = { ouro: 'frames.title_ouro', prata: 'frames.title_prata', bronze: 'frames.title_bronze' }
export const FRAME_COLOR = { ouro: '#B07A00', prata: '#6B7280', bronze: '#A0582F' }

/**
 * Nas listas: a moldura ocupa a caixa toda da foto (contida, centrada) e a
 * foto encolhe para o buraco. Devolve as posições em percentagem da caixa,
 * para servir a qualquer tamanho.
 */
export function frameInsideBox(frame) {
  const g = FRAME_GEOMETRY[frame]
  if (!g) return null
  const m = Math.max(g.w, g.h)
  const offX = (m - g.w) / 2
  const offY = (m - g.h) / 2
  return {
    left: ((offX + g.cx - g.r) / m) * 100,
    top: ((offY + g.cy - g.r) / m) * 100,
    size: ((2 * g.r) / m) * 100,
  }
}

/**
 * No perfil: a foto fica do tamanho que tem e a moldura passa para fora.
 * `photo` é o diâmetro da foto em px; devolve a caixa da moldura (px),
 * relativa ao canto da foto.
 */
export function frameAroundPhoto(frame, photo, gap = 1.04) {
  const g = FRAME_GEOMETRY[frame]
  if (!g) return null
  const scale = (photo / 2) * gap / g.r
  return { width: g.w * scale, height: g.h * scale, left: photo / 2 - g.cx * scale, top: photo / 2 - g.cy * scale }
}

// Memória da sessão: user_id → moldura (ou null).
const cache = new Map()
let missing = false // a função ainda não existe neste ambiente

/** As molduras de uma lista de pessoas, num pedido só. */
export async function fetchFrames(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))]
  const todo = ids.filter((id) => !cache.has(id))
  if (todo.length && !missing) {
    const { data, error } = await supabase.rpc('get_user_frames', { p_user_ids: todo })
    if (error) {
      if (error.code === 'PGRST202') missing = true
      else console.error('Error loading frames:', error)
    } else {
      todo.forEach((id) => cache.set(id, null))
      for (const row of data || []) cache.set(row.user_id, row)
    }
  }
  return Object.fromEntries(ids.map((id) => [id, cache.get(id) || null]))
}

/** { user_id: { frame, place, scope_name, month } } de quem está na lista. */
export function useFrames(userIds) {
  const key = [...new Set((userIds || []).filter(Boolean))].sort().join(',')
  const [frames, setFrames] = useState({})
  useEffect(() => {
    if (!key) { setFrames({}); return undefined }
    let alive = true
    fetchFrames(key.split(',')).then((f) => { if (alive) setFrames(f) })
    return () => { alive = false }
  }, [key])
  return frames
}

/** Só para testes: esquece a memória. */
export function resetFramesCache() { cache.clear(); missing = false }
