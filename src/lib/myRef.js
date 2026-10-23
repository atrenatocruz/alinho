import { supabase } from './supabase'

// O código pessoal de quem partilha (origem da conta, 19 out; PO): vai como
// ?ref=<código> em todos os links do alinho que a pessoa partilha, para a
// conta nova saber quem a convidou (get_my_invite_code, do Dev 3; o código é
// sempre o mesmo). Carrega-se uma vez depois de entrar; sem código (sem
// sessão, ou a função ainda não existe), os links ficam como estão.
let myCode = null

export async function loadMyRef() {
  const { data, error } = await supabase.rpc('get_my_invite_code')
  if (!error && typeof data === 'string' && data) myCode = data
}

export function clearMyRef() { myCode = null }

const OUR_HOSTS = /^(?:www\.|dev\.)?alinho\.pt$/i
const isOurs = (u) => {
  try {
    const url = new URL(u, typeof window !== 'undefined' ? window.location.origin : 'https://www.alinho.pt')
    return OUR_HOSTS.test(url.hostname) || (typeof window !== 'undefined' && url.origin === window.location.origin)
  } catch { return false }
}

/** O link com o ?ref= de quem partilha (só os nossos; um ?ref= que já lá esteja fica). */
export function withMyRef(link, code = myCode) {
  if (!code || !link || !isOurs(link)) return link
  try {
    const url = new URL(link, typeof window !== 'undefined' ? window.location.origin : 'https://www.alinho.pt')
    if (url.searchParams.has('ref')) return link
    url.searchParams.set('ref', code)
    return url.toString()
  } catch { return link }
}

/** Um texto com links (a frase de partilha): cada link nosso leva o ?ref=. */
export function refInText(text, code = myCode) {
  if (!code || !text) return text
  return String(text).replace(/https?:\/\/[^\s<>"']+/g, (m) => withMyRef(m, code))
}
