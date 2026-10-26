// Peças comuns dos separadores de «Os meus números».

export const card = 'rounded-card bg-white p-3.5 shadow-[0_1px_2px_rgba(17,17,17,0.06)]'
export const kicker = 'mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted'

export const monthName = (year, month, lang) =>
  new Date(year, month, 1).toLocaleDateString(lang, { month: 'long' })

export const monthShort = (year, month, lang) =>
  new Date(year, month, 1).toLocaleDateString(lang, { month: 'short' }).replace('.', '')

// 1-3 Fácil, 4-6 Moderado, 7-8 Difícil, 9-10 No limite (como no relógio).
export const effortKey = (v) => (v <= 3 ? 'easy' : v <= 6 ? 'moderate' : v <= 8 ? 'hard' : 'max')

export const resultKey = (g) => (g.winner === 'us' ? 'won' : g.winner === 'them' ? 'lost' : 'draw')
