// Os grupos, as duplas e os jogos de uma categoria, para os separadores da
// página do torneio (Grupos, Quadro, Horário, Os meus jogos).
//
// Resultados quase em tempo real (Renato, 29 set): com a página à frente
// relê-se de REFRESH_MS em REFRESH_MS, e logo ao voltar à app. As tabelas
// do torneio estão fechadas ao browser e a página lê de vistas públicas,
// que não mandam avisos de tempo real — por isso é releitura, não
// subscrição. Só a primeira leitura mostra «a carregar»; as outras trocam
// os dados sem piscar.
//
// UMA leitura por categoria, partilhada (SI/PO, 14 out): antes, cada peça
// da página (Grupos, Quadro, Horário, Os meus jogos, o próximo jogo) lia por
// conta própria e repetia de 30 em 30 s — três pedidos iguais no mesmo
// instante, com a página aberta. Agora as peças da mesma categoria partilham
// os dados, um pedido de cada vez, e só se repete enquanto o torneio está a
// decorrer (um jogo por acabar perto de agora). Com a página escondida, nada.
import { useEffect, useState } from 'react'
import { getCategoryBoard } from '../../lib/tournamentDraw'
import { errorKind } from '../../lib/errors'

export const REFRESH_MS = 30 * 1000
// «A decorrer»: um jogo por acabar marcado até 12 h antes ou depois de agora.
const LIVE_WINDOW_MS = 12 * 60 * 60 * 1000

/** Quem muda o quadro na própria página (passar ao quadro, desfazer, fechar
 *  a categoria) avisa, e o quadro relê logo — antes só se via na releitura
 *  seguinte, ~8 s depois (ensaio do QA, 30 set). */
export const BOARD_CHANGED = 'tournament:board-changed'
// Uma entrada por categoria: os dados, quem está a ouvir, o pedido em curso
// e o relógio da releitura.
const stores = new Map()
export const boardChanged = (categoryId) => {
  // O que estava guardado deixa de servir: a próxima leitura vai buscar o novo.
  if (categoryId && stores.has(categoryId)) stores.get(categoryId).at = 0
  else stores.forEach((st) => { st.at = 0 })
  window.dispatchEvent(new CustomEvent(BOARD_CHANGED, { detail: { categoryId } }))
}

const EMPTY = { groups: [], entries: {}, matches: [] }

/** Há jogo a decorrer (ou quase)? Só então vale a pena reler sozinho. */
export function boardIsLive(board, now = Date.now()) {
  const matches = board?.matches || []
  const open = matches.filter((m) => !['terminado', 'cancelado'].includes(m.status))
  if (!open.length) return false
  if (open.some((m) => m.scheduled_at && Math.abs(new Date(m.scheduled_at).getTime() - now) <= LIVE_WINDOW_MS)) return true
  // Sem horas marcadas: conta como a decorrer se o torneio já começou (há
  // jogos acabados).
  return open.some((m) => !m.scheduled_at) && matches.some((m) => m.status === 'terminado')
}


function storeOf(categoryId) {
  let st = stores.get(categoryId)
  if (!st) {
    st = { data: null, loaded: false, notReady: false, listeners: new Set(), inflight: null, again: false, timer: null }
    stores.set(categoryId, st)
  }
  return st
}

const emit = (st) => st.listeners.forEach((fn) => fn())

function load(categoryId) {
  const st = storeOf(categoryId)
  // Um pedido de cada vez: quem pedir a meio fica para logo a seguir.
  if (st.inflight) { st.again = true; return st.inflight }
  st.inflight = getCategoryBoard(categoryId)
    .then((data) => { st.data = data; st.at = Date.now(); st.notReady = false })
    .catch((error) => {
      // Enquanto a migração não correr, as vistas não existem: a página
      // mostra o estado vazio em vez de rebentar. Numa releitura sem rede
      // fica o que já se tinha.
      if (!st.data) st.notReady = errorKind(error) === 'not_ready'
    })
    .finally(() => {
      st.inflight = null
      st.loaded = true
      emit(st)
      if (st.again && st.listeners.size) { st.again = false; load(categoryId) }
    })
  return st.inflight
}

/** Para quem precisa do quadro fora do hook (CloseCategories): usa o pedido
 *  em curso, ou o que veio há menos de FRESH_MS, em vez de pedir outra vez
 *  (SI/PO, 14 out); mais velho, lê de novo (depois de «Passar ao quadro»
 *  tem de vir o quadro novo). */
const FRESH_MS = 5 * 1000
export async function readCategoryBoard(categoryId) {
  if (!categoryId) return EMPTY
  const st = storeOf(categoryId)
  if (st.inflight) await st.inflight
  else if (!st.data || !st.at || Date.now() - st.at > FRESH_MS) await load(categoryId)
  return st.data || EMPTY
}

function tick(categoryId) {
  const st = storeOf(categoryId)
  if (!st.listeners.size) return
  if (document.visibilityState !== 'visible' || navigator.onLine === false) return
  if (!boardIsLive(st.data)) return
  load(categoryId)
}

function subscribe(categoryId, fn) {
  const st = storeOf(categoryId)
  st.listeners.add(fn)
  if (st.listeners.size === 1) {
    st.timer = setInterval(() => tick(categoryId), REFRESH_MS)
    st.onVisible = () => {
      if (document.visibilityState === 'visible' && navigator.onLine !== false) load(categoryId)
    }
    st.onChanged = (e) => { if (!e.detail?.categoryId || e.detail.categoryId === categoryId) load(categoryId) }
    document.addEventListener('visibilitychange', st.onVisible)
    window.addEventListener(BOARD_CHANGED, st.onChanged)
  }
  return () => {
    st.listeners.delete(fn)
    if (!st.listeners.size) {
      clearInterval(st.timer)
      document.removeEventListener('visibilitychange', st.onVisible)
      window.removeEventListener(BOARD_CHANGED, st.onChanged)
      // Os dados ficam guardados: ao voltar à página aparecem logo, e uma
      // leitura nova troca-os sem piscar.
    }
  }
}

/** Várias categorias de uma vez (o «Todas» do Horário, 23 out): cada uma
 *  continua com a sua leitura partilhada (a mesma do Quadro), e aqui só se
 *  juntam. Os jogos levam o `category_id` de onde vieram. */
export function useCategoryBoards(categoryIds = []) {
  const [, setVersion] = useState(0)
  const key = categoryIds.join(',')
  useEffect(() => {
    const ids = key ? key.split(',') : []
    const offs = ids.map((id) => subscribe(id, () => setVersion((v) => v + 1)))
    for (const id of ids) {
      const st = storeOf(id)
      if (!st.inflight && (!st.loaded || st.listeners.size === 1)) load(id)
    }
    return () => offs.forEach((off) => off())
  }, [key])

  const parts = categoryIds.map((id) => [id, storeOf(id)])
  const merged = { groups: [], entries: {}, matches: [] }
  // Um jogo ou um grupo só entra uma vez, mesmo que venha em duas leituras.
  const seen = new Set()
  for (const [id, st] of parts) {
    const data = st.data || EMPTY
    for (const g of data.groups) if (!seen.has(`g${g.id}`)) { seen.add(`g${g.id}`); merged.groups.push(g) }
    Object.assign(merged.entries, data.entries)
    for (const m of data.matches) {
      if (seen.has(`m${m.id}`)) continue
      seen.add(`m${m.id}`)
      merged.matches.push(m.category_id ? m : { ...m, category_id: id })
    }
  }
  return {
    ...merged,
    loading: parts.some(([, st]) => !st.loaded && !st.data),
    notReady: parts.length > 0 && parts.every(([, st]) => st.notReady),
  }
}

export default function useCategoryBoard(categoryId) {
  const [, setVersion] = useState(0)

  useEffect(() => {
    if (!categoryId) return undefined
    const st = storeOf(categoryId)
    const unsubscribe = subscribe(categoryId, () => setVersion((v) => v + 1))
    // A primeira peça a montar lê; as outras usam o que já veio ou o pedido
    // que já está a caminho. Com dados velhos de outra visita, relê-se uma vez.
    if (!st.inflight && (!st.loaded || st.listeners.size === 1)) load(categoryId)
    return unsubscribe
  }, [categoryId])

  if (!categoryId) return { ...EMPTY, loading: false, notReady: false }
  const st = storeOf(categoryId)
  return { ...(st.data || EMPTY), loading: !st.loaded && !st.data, notReady: st.notReady }
}
