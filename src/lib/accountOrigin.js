// A origem da conta (PO e Dev 3, 19 out): de onde veio quem cria conta —
// ?origem=<nome> (anúncio, influencer) e ?ref=<código de quem convidou>.
// Guarda-se ao abrir qualquer página e entrega-se uma vez, depois da primeira
// sessão (set_my_account_origin). Fica a PRIMEIRA (Marketing): uma origem com
// menos de 30 dias não é substituída. Os links de convite sem ?origem= contam
// como origem própria (BA): convite-grupo, -mix, -torneio, -amigos.

const KEY = 'alinho.accountOrigin'
const TTL = 30 * 86400000
const ORIGIN_RE = /^[a-z0-9_-]{1,60}$/
const REF_RE = /^[A-Za-z0-9_-]{1,40}$/

function read(storage) {
  try { return JSON.parse(storage?.getItem(KEY) || 'null') || {} } catch { return {} }
}

/** A origem que um endereço traz, ou null. */
export function originFromUrl(pathname = '', search = '') {
  const params = new URLSearchParams(search)
  const explicit = (params.get('origem') || '').toLowerCase()
  if (ORIGIN_RE.test(explicit)) return explicit
  if (pathname.startsWith('/login') && params.get('org')) return 'convite-grupo'
  if (/^\/convite-torneio\//.test(pathname)) return 'convite-torneio'
  if (/^\/convite-amigos\//.test(pathname)) return 'convite-amigos'
  if (/^\/convite\//.test(pathname)) return 'convite-mix'
  return null
}

/** Guarda a origem e o ?ref= de um endereço, se ainda não houver (ou a guardada já passou dos 30 dias). */
export function captureAccountOrigin(pathname, search, now = Date.now(), storage = globalThis.localStorage) {
  const saved = read(storage)
  const fresh = (entry) => entry && now - entry.at < TTL
  const next = { ...saved }
  const origin = originFromUrl(pathname, search)
  if (origin && !fresh(saved.origin)) next.origin = { value: origin, at: now }
  const ref = new URLSearchParams(search).get('ref')
  if (ref && REF_RE.test(ref) && !fresh(saved.ref)) next.ref = { value: ref, at: now }
  if (next.origin === saved.origin && next.ref === saved.ref) return
  try { storage?.setItem(KEY, JSON.stringify(next)) } catch { /* sem armazenamento */ }
}

/** O que há para entregar (só o que ainda está dentro dos 30 dias), ou null. */
export function pendingAccountOrigin(now = Date.now(), storage = globalThis.localStorage) {
  const saved = read(storage)
  const ok = (e) => (e && now - e.at < TTL ? e.value : null)
  const origin = ok(saved.origin)
  const ref = ok(saved.ref)
  return origin || ref ? { origin, ref } : null
}

export function clearAccountOrigin(storage = globalThis.localStorage) {
  try { storage?.removeItem(KEY) } catch { /* sem armazenamento */ }
}
