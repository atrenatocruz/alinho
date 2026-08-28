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

/** Banda pública de um rating, e.g. { label: 'M6', fullKey: 'ui.level_band',
    fullVars: { label: 'M6' } } — this is a plain module with no `t()`
    access, so it hands back a translation key + interpolation vars instead
    of a pre-formatted string (same constraint ONBOARDING_LEVELS solves
    below); callers resolve it via t(band.fullKey, band.fullVars).
    Devolve null quando não há rating (conta ainda sem Elo). */
export function ratingBand(rating, gender) {
  if (rating == null) return null
  const prefix = gender === 'feminino' ? 'F' : 'M'
  const band = BANDS.find((b) => rating >= b.min)
  if (!band) return { label: 'INI', fullKey: 'ui.level_beginner' }
  const label = `${prefix}${band.num}`
  return { label, fullKey: 'ui.level_band', fullVars: { label } }
}

/** Banda de um clube/grupo (média do Elo dos membros) — mesmas bandas que
    ratingBand, mas com prefixo 'N' fixo em vez de M/F: não faz sentido
    atribuir um género a uma média de clube. Same fullKey/fullVars shape as
    ratingBand above. */
export function groupRatingBand(rating) {
  if (rating == null) return null
  const band = BANDS.find((b) => rating >= b.min)
  if (!band) return { label: 'NINI', fullKey: 'ui.group_level_beginner' }
  const label = `N${band.num}`
  return { label, fullKey: 'ui.level_band', fullVars: { label } }
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
