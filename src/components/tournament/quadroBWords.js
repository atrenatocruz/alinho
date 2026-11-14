// As palavras de «quem vai ao Quadro B» (#800, SPEC ponto 3 e 4, 12 nov).
// Só texto: quem vai e as contas vêm do Dev 3 (format.secondary_upto e
// secondaryOptions). Aqui montam-se as listas de lugares em cada língua:
// «3.ºs e 4.ºs», «o 3.º e o 4.º» (en «3rd and 4th», es «3.º y 4.º»).

const LOCALES = { pt: 'pt-PT', en: 'en-GB', es: 'es-ES' }

/** «3.ºs e 4.ºs» (form 'pl', sem artigo) ou «o 3.º e o 4.º» (form 'sg'). */
export function placeList(t, lang, places, form = 'pl') {
  const words = places.map((p) => t(`tournament.draw.place_${form}_${p}`))
  try {
    return new Intl.ListFormat(LOCALES[lang] || lang || 'pt-PT', { type: 'conjunction' }).format(words)
  } catch {
    return words.join(', ')
  }
}

/** Até que lugar do grupo vai ao Quadro B. null = ninguém. Uma categoria
    antiga só com secondary_bracket ligado leva «todos os outros». */
export function secondaryUpTo(category) {
  const f = category?.format || {}
  if (f.secondary_upto != null) return Number(f.secondary_upto)
  const on = f.secondary_bracket ?? category?.secondary_bracket
  return on ? Infinity : null
}

/** Os lugares de um grupo de `size` duplas que vão ao Quadro B. */
export function bPlaces(perGroup, upTo, size) {
  if (upTo == null || !perGroup) return []
  const out = []
  for (let p = perGroup + 1; p <= Math.min(upTo, size); p++) out.push(p)
  return out
}

/** A frase por baixo da tabela do grupo: «Os 2 primeiros vão ao Quadro A,
    o 3.º ao Quadro B.»; quando vão todos os outros, «…os outros ao Quadro B.»
    Devolve null quando não há Quadro B (fica a frase de sempre). */
export function groupNoteAB(t, lang, perGroup, upTo, size) {
  const places = bPlaces(perGroup, upTo, size)
  if (!places.length) return null
  if (places[places.length - 1] >= size) return t('tournament.draw.qualify_note_ab', { count: perGroup })
  return t('tournament.draw.qualify_note_ab_list', { count: perGroup, list: placeList(t, lang, places, 'sg') })
}
