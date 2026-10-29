// Alguém copia a lista que o robô publica, acrescenta o nome e publica-a
// (A2N, M5 de segunda, 27 set): fica convencido de que está inscrito, mas a
// base de dados não sabe de nada. O robô passa a reconhecer a cópia da SUA
// lista e a comparar os nomes com os inscritos (Francisco, 27 set):
//   · um nome a mais, e é de quem enviou → «In» por ele;
//   · nome de outra pessoa, ou mais do que um → «copiar não inscreve»;
//   · nenhum a mais → ignora.
// Aqui só se lê o texto (sem base de dados), para se poder testar.

const stripAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

// «8. 🎾 Martim Baptista (M5) (1)» — uma linha de inscrito da lista do robô.
const SLOT_LINE = /^\s*\d{1,2}\.\s*🎾\s*(.+?)\s*$/u
// As marcas do modelo (roster.js, buildMixMessage). Uma só chega, mas tem de
// haver pelo menos duas linhas de inscrito: é uma lista, não uma conversa.
const MARKS = [
  /inscritos em dupla/i,
  /Escreve \*?In\*? ou \*?Alinho\*?/i,
  /Escreve \*?In [^*]+\*? para entrares/i,
  /\(vaga livre\)/i,
  /campos fechados/i,
]

/** O nome de uma linha, sem a banda («(M5)»), o «(convidado)» nem o número da dupla. */
export function cleanRosterName(raw) {
  let s = raw.replace(/[*_~]/g, '').trim()
  let prev
  do {
    prev = s
    s = s.replace(/\s*\((?:M|F|MX|N)\d\)\s*$/i, '')
      .replace(/\s*\((?:convidado|guest)\)\s*$/i, '')
      .replace(/\s*\(\d{1,2}\)\s*$/, '')
      .trim()
  } while (s !== prev)
  return s
}

export const normName = (s) => stripAccents(String(s || '').toLowerCase()).replace(/\s+/g, ' ').trim()

/**
 * Lê uma mensagem e, se for a cópia de uma lista do robô, devolve
 * { names, gameId, title }; senão null. `names` sem as vagas livres.
 */
export function parseCopiedRoster(text) {
  if (!text || !MARKS.some((re) => re.test(text))) return null
  const lines = text.split(/\r?\n/)
  const slots = lines.map((l) => l.match(SLOT_LINE)?.[1]).filter(Boolean)
  if (slots.length < 2) return null
  const names = slots
    .filter((s) => !/^\(?vaga livre\)?$/i.test(s.trim()))
    .map(cleanRosterName)
    .filter(Boolean)
  // O link do cartão: o curto «/m/<8>» (desde 9 out) ou o comprido de antes.
  const gameId = text.match(/\/(?:jogo|m)\/([0-9a-f-]{8,})/i)?.[1]?.toLowerCase() ?? null
  // Primeira linha do cartão: «🎾 *Mix de segunda M5*» (ou «🎾 *01 · …*»).
  const title = lines.map((l) => l.match(/^\s*🎾\s*\*(.+?)\*\s*$/u)?.[1]).find(Boolean) ?? null
  // «🔢 Nº: 01» — o número do mix, quando há vários abertos.
  const label = text.match(/Nº:\s*(\S+)/)?.[1] ?? null
  return { names, gameId, title, label }
}

// Palavras de conversa que, com maiúscula, pareciam um nome («Boa Sorte»).
const NOT_NAME_WORDS = new Set(['in', 'out', 'fora', 'alinho', 'sim', 'nao', 'ok', 'boa', 'bom', 'bons', 'boas', 'obrigado', 'obrigada',
  'top', 'vou', 'eu', 'nos', 'quem', 'jogo', 'mix', 'hoje', 'amanha', 'campo', 'vaga', 'vagas', 'sorte', 'bora', 'vamos', 'ja', 'mais', 'tambem'])
const PARTICLES = new Set(['de', 'da', 'do', 'dos', 'das', 'e'])

/**
 * Resposta ao cartão de um mix só com nomes (Renato, 28 out — A2N: «Bruno
 * Ribeiro e Nuno Miguel» a responder ao cartão): devolve os nomes, ou null
 * se o texto não for só nomes. Cada palavra com maiúscula (tirando «de»,
 * «da»…), até 4 palavras por nome e 8 nomes — para a conversa normal em
 * resposta ao cartão («boa sorte», «Quem falta?», «Fixe») não inscrever ninguém.
 * `strict: false` quando já há um «In» na mensagem (é um pedido, não
 * conversa): aceita minúsculas e um nome só de uma palavra.
 */
export function parseReplyNames(text, { strict = true } = {}) {
  const s = String(text || '').trim()
  if (!s || s.length > 200) return null
  const parts = s.split(/\s*[,;\n&+/]\s*|\s+(?:e|and)\s+/i)
    .map((p) => p.replace(/^\s*(?:\d{1,2}[.)]|[-•*])\s*/, '').trim())
    .filter(Boolean)
  if (parts.length === 0 || parts.length > 8) return null
  for (const p of parts) {
    const words = p.split(/\s+/)
    if (words.length > 4) return null
    for (const w of words) {
      if (!/^\p{L}[\p{L}'’.-]*$/u.test(w)) return null
      if (NOT_NAME_WORDS.has(normName(w))) return null
      if (strict && !PARTICLES.has(w.toLowerCase()) && w[0] === w[0].toLowerCase()) return null
    }
    if (PARTICLES.has(words[0].toLowerCase())) return null
  }
  // Uma palavra só («Fixe», «Brutal») não chega: um nome sozinho tem de ser
  // nome e apelido; vários («Bruno e Nuno») podem ser só o primeiro.
  if (strict && parts.length === 1 && parts[0].split(/\s+/).length < 2) return null
  return parts
}

/** Todas as palavras de `query` começam uma palavra de `fullName` (a regra do «In com …»). */
export function nameMatches(fullName, query) {
  const words = normName(fullName).split(' ').filter(Boolean)
  const q = normName(query).split(' ').filter(Boolean)
  return q.length > 0 && q.every((w) => words.some((x) => x.startsWith(w)))
}

/** O nome da linha a mais é de quem enviou? (nome na app ou o do WhatsApp, nos dois sentidos) */
export function isSenderName(extra, senderNames) {
  return senderNames.filter(Boolean).some((n) => nameMatches(n, extra) || nameMatches(extra, n))
}

/**
 * Compara a cópia com os inscritos do mix: devolve os nomes da cópia que não
 * estão inscritos (nem como suplentes).
 */
export function extraNames(copiedNames, enrolledNames) {
  const enrolled = new Set(enrolledNames.map(normName))
  return copiedNames.filter((n) => !enrolled.has(normName(n)))
}
