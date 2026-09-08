/* ════════════════════════════════════════════════════════════════════════
   XP / assiduidade — display puro (espelha src/lib/elo.js).

   O XP vive em profiles.xp e é escrito só no Postgres (finalize_mix /
   confirm_private_match / backfill). Aqui só existe a curva de níveis e o
   estado do escudo.

   Calibração (Ruben, 8 set 2026): World Class = jogar ≥1 jogo/dia,
   5 dias/semana, durante 3 anos (~130 XP/semana ≈ 20.000 XP). Os níveis
   baixos chegam em semanas para haver sentido de progressão; o topo é uma
   carreira. Valores por evento: mix 20 + 5/jogo + 30 vitória; amigável
   10 + 5 vitória.
   ════════════════════════════════════════════════════════════════════════ */

// Descendente, como BANDS em elo.js. ringClass são literais completos —
// o scanner do Tailwind não vê classes construídas dinamicamente.
export const XP_TIERS = [
  { key: 'world_class', min: 20000, level: 10, labelKey: 'xp.tier_world_class', ringClass: 'ring-2 ring-lime-400' },
  { key: 'lenda',       min: 12000, level: 9,  labelKey: 'xp.tier_lenda',       ringClass: 'ring-2 ring-violet-400' },
  { key: 'diamante',    min: 7500,  level: 8,  labelKey: 'xp.tier_diamante',    ringClass: 'ring-2 ring-sky-400' },
  { key: 'rubi',        min: 4500,  level: 7,  labelKey: 'xp.tier_rubi',        ringClass: 'ring-2 ring-rose-500' },
  { key: 'esmeralda',   min: 2500,  level: 6,  labelKey: 'xp.tier_esmeralda',   ringClass: 'ring-2 ring-emerald-400' },
  { key: 'platina',     min: 1300,  level: 5,  labelKey: 'xp.tier_platina',     ringClass: 'ring-2 ring-cyan-300' },
  { key: 'ouro',        min: 700,   level: 4,  labelKey: 'xp.tier_ouro',        ringClass: 'ring-2 ring-yellow-400' },
  { key: 'prata',       min: 350,   level: 3,  labelKey: 'xp.tier_prata',       ringClass: 'ring-2 ring-slate-300' },
  { key: 'bronze',      min: 150,   level: 2,  labelKey: 'xp.tier_bronze',      ringClass: 'ring-2 ring-amber-600' },
  { key: 'iniciado',    min: 50,    level: 1,  labelKey: 'xp.tier_iniciado',    ringClass: 'ring-2 ring-stone-400' },
]

/** Nível atual de um XP, ou null abaixo do primeiro escudo (<50).
    Devolve { key, level, labelKey, ringClass, min, nextMin, progressPct }. */
export function tierFromXp(xp) {
  const value = xp ?? 0
  const tier = XP_TIERS.find((t) => value >= t.min)
  if (!tier) return null
  const idx = XP_TIERS.indexOf(tier)
  const nextMin = idx > 0 ? XP_TIERS[idx - 1].min : null
  const progressPct = nextMin == null
    ? 100
    : Math.min(100, Math.round(((value - tier.min) / (nextMin - tier.min)) * 100))
  return { ...tier, nextMin, progressPct }
}

/** Progresso para quem ainda não tem escudo (rumo ao nível 1). */
export function preTierProgress(xp) {
  const value = xp ?? 0
  const firstMin = XP_TIERS[XP_TIERS.length - 1].min
  return { nextMin: firstMin, progressPct: Math.min(100, Math.round((value / firstMin) * 100)) }
}

// Brilho do escudo: jogou (mix ou amigável contabilizado) nos últimos 7
// dias. O brilho apaga-se; o material do escudo nunca desce.
export const GLOW_WINDOW_DAYS = 7
export const GLOW_CLASS = 'shadow-[0_0_10px_2px] shadow-lime-400/70'

export function isGlowing(lastPlayedAt) {
  if (!lastPlayedAt) return false
  const played = new Date(lastPlayedAt).getTime()
  if (Number.isNaN(played)) return false
  return Date.now() - played < GLOW_WINDOW_DAYS * 24 * 60 * 60 * 1000
}

export const formatXp = (xp) => (xp ?? 0).toLocaleString('pt-PT')
