// O tom de cada cor de categoria no Horário com «Todas» (UX, 22 out:
// design-handoff/2026-10-22-torneio-referencia-racketsplayer). A cor vem do
// categoryColors (tournamentTimetable.js, pela ordem das categorias) e só se
// usa na bolinha e na etiqueta, nunca no fundo do cartão.
export const CATEGORY_TONES = {
  azul: '#2563EB',
  rosa: '#DB2777',
  roxo: '#7C3AED',
  verde_agua: '#0D9488',
  laranja: '#EA580C',
  castanho: '#92400E',
}

export const toneOf = (colors, categoryId) => CATEGORY_TONES[colors?.[categoryId]] || '#5B6068'
