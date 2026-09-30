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

/** O texto é só o nome de quem escreveu? («In Miguel Oliveira com Marco Silva» → «Miguel Oliveira»). */
export function isOnlySenderName(typed, senderNames) {
  return partnerFromTypedNames(typed, senderNames) === null
}
