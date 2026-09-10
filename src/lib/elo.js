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
  const band = BANDS.find((b) => rating >= b.min)
  if (!band) return { label: 'INI', fullKey: 'ui.level_beginner' }

  // Regra do Francisco (9 set 2026): M = masculino, F = feminino,
  // N = nivel, para quem nao preencheu o genero.
  //
  // A versao anterior fazia `gender === 'feminino' ? 'F' : 'M'`, o que
  // rotulava de M toda a gente sem genero preenchido — incluindo mulheres.
  // `profiles.gender` e opcional e fica a null por omissao, portanto isto
  // acontecia a serio (Trello #202).
  const prefix = gender === 'feminino' ? 'F' : gender === 'masculino' ? 'M' : 'N'
  const label = `${prefix}${band.num}`
  return {
    label,
    fullKey: prefix === 'N' ? 'ui.level_band_no_gender' : 'ui.level_band',
    fullVars: { label, num: band.num },
  }
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

// Provisório: menos de 8 jogos contados (2 mixes) — o rating ainda é uma
// aproximação. Espelha o limiar único de "novo" no Postgres
// (migration_elo_provisional_8.sql): rótulo NOVO, escudo de parceiro e
// K=40 estão todos alinhados nos 8 jogos; mudar lá → mudar aqui.
export const PROVISIONAL_GAMES = 8
export const isProvisional = (ratingGames) => ratingGames != null && ratingGames < PROVISIONAL_GAMES

/** "~902" para provisórios, "902" para estabelecidos. */
export const formatRatingMaybeProvisional = (rating, ratingGames) =>
  `${isProvisional(ratingGames) ? '~' : ''}${formatRating(rating)}`

/** Progresso dentro da banda atual, para a barra do cartão de perfil.
    Devolve { nextMin, pct } — nextMin null no topo (M1/F1, barra cheia);
    abaixo de 700 (Iniciante) o alvo é a entrada na banda 6. */
export function bandProgress(rating) {
  if (rating == null) return null
  const idx = BANDS.findIndex((b) => rating >= b.min)
  if (idx === 0) return { nextMin: null, pct: 100 }
  if (idx === -1) {
    const first = BANDS[BANDS.length - 1].min
    return { nextMin: first, pct: Math.min(100, Math.round((rating / first) * 100)) }
  }
  const cur = BANDS[idx]
  const next = BANDS[idx - 1]
  return {
    nextMin: next.min,
    pct: Math.min(100, Math.round(((rating - cur.min) / (next.min - cur.min)) * 100)),
  }
}

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
