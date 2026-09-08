// Locale-aware date/time formatting. 'en' maps to en-GB (not en-US) — same
// day/month ordering players are already used to from pt-PT, just in
// English words, rather than also flipping to month/day order.
const LOCALE_MAP = { pt: 'pt-PT', en: 'en-GB' }

export const formatDate = (date, lang, options) =>
  new Date(date).toLocaleDateString(LOCALE_MAP[lang] || 'pt-PT', options)

export const formatTime = (date, lang, options) =>
  new Date(date).toLocaleTimeString(LOCALE_MAP[lang] || 'pt-PT', options)

// Valores monetários. Intl trata do símbolo, da posição e do separador
// decimal por locale: pt-PT dá "7,50 €", en-GB dá "€7.50". Antes disto o
// preço era interpolado em cru na frase traduzida, o que mostrava "7.5€"
// em português — ponto decimal e sem cêntimos.
//
// (O ficheiro chama-se formatDate mas é, na prática, a formatação sensível
// ao locale toda; o LOCALE_MAP acima é partilhado.)
export const formatCurrency = (value, lang) =>
  new Intl.NumberFormat(LOCALE_MAP[lang] || 'pt-PT', {
    style: 'currency',
    currency: 'EUR',
  }).format(value ?? 0)
