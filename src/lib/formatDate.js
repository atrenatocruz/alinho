// Locale-aware date/time formatting. 'en' maps to en-GB (not en-US) — same
// day/month ordering players are already used to from pt-PT, just in
// English words, rather than also flipping to month/day order.
const LOCALE_MAP = { pt: 'pt-PT', en: 'en-GB' }

export const formatDate = (date, lang, options) =>
  new Date(date).toLocaleDateString(LOCALE_MAP[lang] || 'pt-PT', options)

export const formatTime = (date, lang, options) =>
  new Date(date).toLocaleTimeString(LOCALE_MAP[lang] || 'pt-PT', options)
