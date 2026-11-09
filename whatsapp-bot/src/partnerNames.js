// «In Miguel Oliveira Marco Silva», «In Miguel Oliveira e Marco Silva»,
// «In Marco Silva» (grupo de teste, 30 set): quem escreve põe nomes depois do
// «In» sem o «com», e o robô lia-os como o nome de um mix («não encontrei
// nenhum mix») ou, a responder ao cartão, ignorava-os e inscrevia-o sozinho.
// Aqui só se lê o texto (sem base de dados), para se poder testar: o que
// sobra depois de tirar o nome de quem escreveu é o parceiro.

import { normName } from './copiedRoster.js'

// Separadores entre dois nomes: «e», «com», «+», «&», «/», vírgula.
const SEPARATORS = /\s*[,+&/]\s*|\s+(?:e|com|and|with)\s+/i
// Um nome: só letras (com acentos), espaços, apóstrofo, ponto e hífen.
const NAME_TEXT = /^[\p{L}\p{M}'.\- ]+$/u
const MAX_WORDS = 5

/** As palavras de um nome, sem acentos nem o que não é letra («Paulo Duarte#12» → paulo, duarte). */
const nameWords = (s) => normName(s).replace(/[^\p{L}\s'-]/gu, ' ').split(/\s+/).filter(Boolean)

/** A palavra escrita é o início de uma palavra do nome de quem escreveu? */
const isSenderWord = (word, senderWordLists) => senderWordLists.some((ws) => ws.some((w) => w.startsWith(word)))

function isSelf(part, senderWordLists) {
  const words = nameWords(part)
  return words.length > 0 && words.every((w) => isSenderWord(w, senderWordLists))
}

/**
 * O parceiro escrito depois do «In», quando não há «com» nem @.
 * `typed` é o texto depois da palavra «In», como a pessoa o escreveu.
 * Devolve:
 *   · undefined — não parece uma lista de nomes (números, @, demasiadas palavras, ou
 *     vários nomes que não são de quem escreveu): o robô segue como antes;
 *   · null — só o nome de quem escreveu («In Miguel Oliveira»): entra sozinho;
 *   · o nome do parceiro, como foi escrito.
 */
export function partnerFromTypedNames(typed, senderNames) {
  const text = String(typed || '').replace(/\s+/g, ' ').trim()
  if (!text || !NAME_TEXT.test(text.replace(/[,+&/]/g, ' '))) return undefined
  const senderWordLists = senderNames.filter(Boolean).map(nameWords).filter((ws) => ws.length > 0)
  const parts = text.split(SEPARATORS).map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0 || parts.some((p) => nameWords(p).length > MAX_WORDS)) return undefined

  if (parts.length > 1) {
    const others = parts.filter((p) => !isSelf(p, senderWordLists))
    if (others.length === 0) return null
    // Dois nomes, nenhum de quem escreveu: não se adivinha qual é o dele.
    return others.length === 1 && others.length < parts.length ? others[0] : undefined
  }

  // Um só bloco: «Miguel Oliveira Marco Silva» → tira-se o nome de quem
  // escreveu do início. Uma palavra só (o primeiro nome) sai se ficarem pelo
  // menos duas: «In Miguel Almeida», dito pelo Miguel Oliveira, é o Miguel
  // Almeida, não o «Almeida».
  const typedWords = text.split(' ')
  const words = nameWords(text)
  if (words.length !== typedWords.length) return undefined
  let prefix = 0
  while (prefix < words.length && isSenderWord(words[prefix], senderWordLists)) prefix += 1
  if (prefix === words.length) return null
  const leftover = words.length - prefix
  if (prefix >= 2 || (prefix === 1 && leftover >= 2)) return typedWords.slice(prefix).join(' ')
  return text
}

// O que fica no fim de um nome e não é dele: pontuação, emojis, «(M4)»,
// smileys de texto («:)», «;-P», «<3») e um «e» de frase cortada («Afonso e»).
const TRAILING = /(?:\s*\([^()]*\)|[\s.,;:!?…]+|[\p{Extended_Pictographic}\p{Emoji_Modifier}\u200d\ufe0f\u20e3]+|\s*[:;=][-'^]?[()[\]DdPpOo3/\\|*]+|\s*<3+|\s+(?:e|com|and|with))$/u

/** «Afonso.», «Afonso!», «Afonso 👍», «Afonso Dias (M4)» → o nome sozinho (QA, 6 nov). */
export function trimPartnerText(text) {
  let s = String(text || '').trim()
  for (let prev = null; prev !== s;) { prev = s; s = s.replace(TRAILING, '') }
  return s.trim()
}

// Palavras que, logo a seguir a um nome, já não são do nome: «Afonso mas chego
// tarde», «Afonso hoje», «Afonso obg» (QA, 6 nov). Sem acentos.
const NOT_NAME_WORDS = new Set(['mas', 'hoje', 'amanha', 'logo', 'ja', 'depois', 'se', 'que', 'porque', 'pq', 'ou',
  'chego', 'vou', 'as', 'obrigado', 'obrigada', 'obg', 'obgd', 'tb', 'tbm', 'tambem', 'pf', 'pfv', 'por', 'sff',
  'talvez', 'but', 'today', 'tomorrow', 'if', 'thanks', 'thx', 'pls', 'please', 'late'])

// Destas, as que se escrevem com acento («amanhã», «já», «às», «também»). As
// outras, com acento, são nomes: «Rui Sé» não é o «se» de «se houver vaga» (QA, 6 nov).
const ACCENTED_WORDS = new Set(['amanha', 'ja', 'as', 'tambem'])
const hasAccent = (word) => /[\u0300-\u036f]/.test(String(word || '').normalize('NFD'))

/** Esta palavra, depois de um nome, já não é do nome? */
export function isNotNameWord(word) {
  const w = normName(word)
  return NOT_NAME_WORDS.has(w) && (ACCENTED_WORDS.has(w) || !hasAccent(word))
}

/**
 * O texto até à conversa: «Afonso, chego às 10» → «Afonso». Um segundo nome
 * fica («Afonso e Rui»): são dois nomes, não um nome e conversa (QA, 6 nov).
 */
export function beforeChat(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  const parts = s.split(SEPARATORS)
  const next = (parts[1] || '').trim().split(' ')[0]
  return parts.length > 1 && next && isNotNameWord(next) ? parts[0].trim() : s
}

/**
 * O nome sem o que vem depois dele: «Rodrigo tb», «Rodrigo, obg», «Bernardo
 * Ramos hoje» → «Rodrigo», «Bernardo Ramos» (QA, 6 nov). O «ou» fica: «Rodrigo
 * ou o Rui» não é o Rodrigo.
 */
export function withoutExtraWords(text) {
  const first = beforeChat(text)
  const words = first.split(' ')
  const cut = words.findIndex((w, i) => i > 0 && normName(w) !== 'ou' && isNotNameWord(w))
  return cut > 0 ? words.slice(0, cut).join(' ') : first
}

/** Só letras, espaços, apóstrofo, ponto e hífen («5 min de atraso» não é um nome). */
export const isPlainName = (text) => NAME_TEXT.test(String(text || ''))

/** Mais do que um nome («João e Maria», «João, Maria»). */
export const hasSeveralNames = (text) => String(text || '').split(SEPARATORS).filter((p) => p.trim()).length > 1

/** O texto é só o nome de quem escreveu? («In Miguel Oliveira com Marco Silva» → «Miguel Oliveira»). */
export function isOnlySenderName(typed, senderNames) {
  return partnerFromTypedNames(typed, senderNames) === null
}
