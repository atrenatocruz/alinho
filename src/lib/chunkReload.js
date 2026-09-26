/* Falta um pedaço da app depois de uma publicação nova (Trello #569).

   Cada publicação muda o nome dos ficheiros das páginas e dos painéis que só
   se carregam quando são precisos. Quem tinha a app aberta continua a pedir o
   nome antigo, que já não existe — e o servidor responde com a página inicial
   em vez do ficheiro, por isso o import falha. Recarregar vai buscar os nomes
   novos. Acontecia nas páginas (App.jsx já recarregava) mas também nos
   painéis do torneio (SignupSlot…), que caíam no «Alguma coisa correu mal».

   Recarrega-se UMA vez: guarda-se a hora do recarregamento e, se voltar a
   falhar logo a seguir, a falha é outra e o erro mostra-se, em vez de a
   página ficar a recarregar em ciclo. (Antes guardava-se só «já recarreguei»
   para a sessão inteira: uma segunda publicação no mesmo dia, com a app
   aberta, já não recarregava.) */

const KEY = 'reloadedForChunk'
export const RELOAD_WINDOW_MS = 30000

/** O erro é «falta um pedaço da app»? (Chrome, Firefox, Safari e o Vite.) */
export function isChunkLoadError(error) {
  const text = `${error?.name || ''} ${error?.message || (typeof error === 'string' ? error : '')}`
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError|Loading (CSS )?chunk \S+ failed|Unable to preload CSS|is not a valid JavaScript MIME type/i.test(text)
}

/** Recarrega a página se não se recarregou há menos de 30 s. Devolve se
 *  recarregou. Sem sessionStorage não há como saber: não recarrega. */
export function reloadOnceForChunk({
  storage = typeof window !== 'undefined' ? window.sessionStorage : null,
  now = Date.now(),
  reload = () => window.location.reload(),
} = {}) {
  try {
    const last = Number(storage.getItem(KEY) || 0)
    if (last && now - last < RELOAD_WINDOW_MS) return false
    storage.setItem(KEY, String(now))
  } catch {
    return false
  }
  reload()
  return true
}

/** O pedaço carregou: esquece o recarregamento. */
export function clearChunkReload(storage = typeof window !== 'undefined' ? window.sessionStorage : null) {
  try { storage.removeItem(KEY) } catch { /* sem sessionStorage: segue */ }
}
