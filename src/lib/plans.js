/* ─── Planos ──────────────────────────────────────────────────────────────
   Uma só fonte para os nomes dos planos, os limites e as mensagens que se
   mostram a quem bate num limite (Trello #264, #265).

   Nomes fechados a 15 set 2026: Free / Squad / Community / Club. As chaves
   internas (free/plus/pro/club) são as de `organizations.plan_tier` e não
   mudam. Os nomes são nomes de produto e não se traduzem.

   Os limites vivem em PLAN_LIMITS e são os mesmos que a base de dados
   aplica em supabase/migration_plan_limits.sql (plan_limits()) — se um
   mudar, o outro tem de mudar com ele. null = sem limite.

   ENFORCED_LIMITS fica como registo do que era aplicado antes dos limites
   por plano (caps fixos dos grupos criados na Comunidade: 30 membros, 3
   mixes, 4 campos) e serve de recurso enquanto a migração não estiver
   corrida — sem plan_tier na base de dados, `plan_tier` chega vazio e
   limitsFor() devolve o Free.                                            */

export const PLAN_TIERS = ['free', 'plus', 'pro', 'club']
export const PLAN_NAMES = { free: 'Free', plus: 'Squad', pro: 'Community', club: 'Club' }
export const planName = (tier) => PLAN_NAMES[tier] || PLAN_NAMES.free

/** O plano seguinte na escada, ou null se já é o topo. */
export const nextPlanTier = (tier) => {
  const i = PLAN_TIERS.indexOf(tier || 'free')
  return i >= 0 && i < PLAN_TIERS.length - 1 ? PLAN_TIERS[i + 1] : null
}

/** Espelho de plan_limits() (migration_plan_limits_free_40.sql). null = sem limite.
    Free passou de 30 para 40 membros a 23 set (Trello #424). */
export const PLAN_LIMITS = {
  free: { members: 40, activeMixes: 1, courts: 2 },
  plus: { members: 300, activeMixes: 2, courts: 4 },
  pro: { members: null, activeMixes: null, courts: null },
  club: { members: null, activeMixes: null, courts: null },
}

/** O que se aplicava antes dos limites por plano (registo histórico). */
export const ENFORCED_LIMITS = { members: 30, activeMixes: 3, courts: 4 }

export const limitsFor = (planTier) => PLAN_LIMITS[planTier] || PLAN_LIMITS.free

/** Mensagem para quem gere o grupo: onde bateu, em que plano está e o que o
    plano seguinte dá. `kind` é 'mix' ou 'members'. */
export function planLimitMessage(t, kind, planTier) {
  const limits = limitsFor(planTier)
  const next = nextPlanTier(planTier)
  // Plano sem limites: o erro veio de outra coisa qualquer — quem chama
  // mostra a mensagem de erro normal em vez de inventar um limite.
  if (kind === 'members' ? limits.members == null : limits.activeMixes == null) return null
  const main = kind === 'members'
    ? t('plans.limit_members', { plan: planName(planTier), members: limits.members })
    // count pluraliza "mix/mixes" (convenção _other do resto dos locales).
    : t('plans.limit_mix', { count: limits.activeMixes, plan: planName(planTier), courts: limits.courts })
  if (!next) return main
  const hint = kind === 'members'
    ? t('plans.next_plan_members', { next: planName(next) })
    : t('plans.next_plan_mix', { next: planName(next) })
  return `${main} ${hint}`
}

/** O erro do Postgres não diz qual das regras falhou; estas duas assinaturas
    são o que se vê quando um limite bate. */
export const isMixLimitError = (message = '') =>
  message.toLowerCase().includes('row-level security policy')

export const isMemberLimitError = (message = '') =>
  message.toLowerCase().includes('limite de') && message.toLowerCase().includes('membros')
