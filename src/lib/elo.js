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

/** Banda de um clube/grupo (média do Elo dos membros) — mesmas bandas que
    ratingBand, mas com prefixo 'N' fixo em vez de M/F: não faz sentido
    atribuir um género a uma média de clube. */
export function groupRatingBand(rating) {
  if (rating == null) return null
  const band = BANDS.find((b) => rating >= b.min)
  if (!band) return { label: 'NINI', full: 'Nível Iniciante' }
  return { label: `N${band.num}`, full: `Nível N${band.num}` }
}

export const formatRating = (rating) => (rating == null ? '—' : String(Math.round(rating)))

// Níveis do ecrã de auto-classificação (primeiro registo). As keys são o
// contrato com o RPC complete_rating_onboarding — não mudar sem migração.
export const ONBOARDING_LEVELS = [
  {
    key: 'iniciado',
    titleKey: 'onboarding.level_iniciado_title',
    points: 700,
    descriptionKey: 'onboarding.level_iniciado_description',
  },
  {
    key: 'regular',
    titleKey: 'onboarding.level_regular_title',
    points: 900,
    descriptionKey: 'onboarding.level_regular_description',
  },
  {
    key: 'avancado',
    titleKey: 'onboarding.level_avancado_title',
    points: 1100,
    descriptionKey: 'onboarding.level_avancado_description',
  },
]
