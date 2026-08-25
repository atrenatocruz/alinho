/* ════════════════════════════════════════════════════════════════════════
   Elo ranking v1 (RANKING.md) — bandas de nível e onboarding.

   O cálculo do rating vive TODO no Postgres (apply_mix_elo, chamado por
   finalize_mix) — aqui só existe display: converter um rating na banda
   pública (M1–M6 / F1–F6 / Iniciante) e os níveis do ecrã de
   auto-classificação do primeiro registo.
   ════════════════════════════════════════════════════════════════════════ */

// Thresholds partilhados por todas as escalas; o prefixo vem do género
// (escala F para 'feminino', M caso contrário). Ninguém ENTRA em
// Iniciante — as âncoras mais baixas começam nos 700 — só se cai lá.
const BANDS = [
  { min: 1800, num: 1 },
  { min: 1600, num: 2 },
  { min: 1400, num: 3 },
  { min: 1200, num: 4 },
  { min: 1000, num: 5 },
  { min: 700, num: 6 },
]

/** Banda pública de um rating, e.g. { label: 'M6', full: 'Nível M6' }.
    Devolve null quando não há rating (conta ainda sem Elo). */
export function ratingBand(rating, gender) {
  if (rating == null) return null
  const prefix = gender === 'feminino' ? 'F' : 'M'
  const band = BANDS.find((b) => rating >= b.min)
  if (!band) return { label: 'INI', full: 'Iniciante' }
  return { label: `${prefix}${band.num}`, full: `Nível ${prefix}${band.num}` }
}

export const formatRating = (rating) => (rating == null ? '—' : String(Math.round(rating)))

// Níveis do ecrã de auto-classificação (primeiro registo). As keys são o
// contrato com o RPC complete_rating_onboarding — não mudar sem migração.
export const ONBOARDING_LEVELS = [
  {
    key: 'iniciado',
    title: 'Iniciado',
    points: 700,
    description: 'Estou a começar — jogo há pouco tempo ou ainda estou a aprender.',
  },
  {
    key: 'regular',
    title: 'Regular',
    points: 900,
    description: 'Jogo com alguma regularidade — domino o básico do jogo.',
  },
  {
    key: 'avancado',
    title: 'Avançado',
    points: 1100,
    description: 'Jogo há anos e a um nível competitivo.',
  },
]
