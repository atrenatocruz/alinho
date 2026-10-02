/* Levar alguém sem conta ao /login e trazê-la de volta ao sítio certo.

   Duas peças pequenas que andavam espalhadas: construir o endereço de ida
   (Trello #454) e limpar o endereço de volta (Trello #378). Vivem juntas
   porque são os dois lados da mesma viagem, e aqui testam-se sem browser. */

/* O endereço de volta, saído do ?redirect= — que vem do URL e pode ter sido
   escrito por qualquer pessoa. Só se aceita um caminho DENTRO da app: sem
   isto bastava um link para levar alguém da página de entrada para fora,
   já com sessão iniciada. `//` e `/\` são endereços de outro site escritos
   como caminho; o navegador segue-os. */
export function safeInternalPath(pedido, fallback = '/') {
  if (typeof pedido !== 'string' || pedido === '') return fallback
  if (!pedido.startsWith('/')) return fallback
  if (pedido.startsWith('//')) return fallback
  if (pedido.startsWith('/' + String.fromCharCode(92))) return fallback
  return pedido
}

/* «Criar conta para me inscrever» e afins (Trello #454).

   Quem chega do WhatsApp a uma página aberta — o torneio, um convite de
   parceiro — e não tem conta tem de aterrar no separador de CRIAR CONTA
   (?mode=signup) e voltar ao sítio de onde veio (?redirect=). Sem os dois,
   via o formulário de quem já tem conta e, feita a conta, aterrava na Home,
   com aquilo que ia fazer desaparecido. */
export function signUpBackLink({ pathname, search = '', categoryCode = null } = {}) {
  const qs = new URLSearchParams(search)
  // A categoria que se está a ver pode não estar no endereço (é a primeira
  // por omissão); fixa-se aqui para o regresso cair na mesma.
  if (categoryCode) qs.set('cat', categoryCode)
  const back = `${pathname}${qs.toString() ? `?${qs}` : ''}`
  return `/login?mode=signup&redirect=${encodeURIComponent(back)}`
}

/* O link de convite de um grupo (Gerir › Convidar, /login?org=<endereço>).
   O grupo guarda-se em localStorage, com validade de 24 h: sobrevive à ida
   ao Google e ao separador do email de «Confirmar email», onde o
   sessionStorage se perdia (QA, 1 out — o Jota Padeleiros sem pedidos desde
   23 set). A Home lê-o, pede para entrar e diz o que aconteceu. */
export const PENDING_ORG_KEY = 'pendingOrgSlug'
export const PENDING_ORG_TTL_MS = 24 * 60 * 60 * 1000

export function savePendingOrgSlug(slug, now = Date.now(), storage = globalThis.localStorage) {
  if (!slug) return
  try { storage?.setItem(PENDING_ORG_KEY, JSON.stringify({ slug, at: now })) } catch { /* sem armazenamento */ }
}

/* Lê e apaga. Devolve o endereço do grupo, ou null se não houver ou já
   tiver passado a validade. */
export function takePendingOrgSlug(now = Date.now(), storage = globalThis.localStorage) {
  let raw = null
  try {
    raw = storage?.getItem(PENDING_ORG_KEY)
    if (raw) storage.removeItem(PENDING_ORG_KEY)
  } catch { return null }
  if (!raw) return null
  try {
    const { slug, at } = JSON.parse(raw)
    return typeof slug === 'string' && slug && now - Number(at) <= PENDING_ORG_TTL_MS ? slug : null
  } catch { return null }
}

/* Para onde vai quem abre o /login já com sessão (AfterLogin). O ?redirect=
   manda (os links de jogo, #378); sem ele, um ?org= vai para a Home, que pede
   para entrar no grupo — antes o <Navigate to="/"> deitava-o fora. */
export function afterLoginPath(searchParams) {
  const redirect = searchParams.get('redirect')
  if (redirect) return safeInternalPath(redirect)
  const org = searchParams.get('org')
  return org ? `/?org=${encodeURIComponent(org)}` : '/'
}
