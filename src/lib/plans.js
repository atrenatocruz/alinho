/* ─── Planos ──────────────────────────────────────────────────────────────
   Uma só fonte para os nomes dos planos, os limites e as mensagens que se
   mostram a quem bate num limite (Trello #264, #265).

   Nomes fechados a 15 set 2026: Free / Squad / Community / Club. As chaves
   internas (free/plus/pro/club) são as de `organizations.plan_tier` e não
   mudam. Os nomes são nomes de produto e não se traduzem.

   IMPORTANTE — dois conjuntos de limites, de propósito:
   • PLAN_LIMITS é o que ficou DECIDIDO (Trello #264) e ainda NÃO está
     aplicado na base de dados.
   • ENFORCED_LIMITS é o que a base de dados aplica hoje a qualquer grupo
     criado na Comunidade, seja qual for o plano: caps fixos das políticas
     RLS (migration_self_serve_groups.sql + migration_fix_games_policy_
     recursion.sql).
   As mensagens usam ENFORCED_LIMITS, para nunca dizerem um número
   diferente daquele que a app está mesmo a aplicar. Quando os limites por
   plano entrarem, passa-se `limitsFor()` a ler PLAN_LIMITS e as mensagens
   acompanham sem se lhes tocar.                                          */

export const PLAN_TIERS = ['free', 'plus', 'pro', 'club']
export const PLAN_NAMES = { free: 'Free', plus: 'Squad', pro: 'Community', club: 'Club' }
export const planName = (tier) => PLAN_NAMES[tier] || PLAN_NAMES.free

/** O plano seguinte na escada, ou null se já é o topo. */
export const nextPlanTier = (tier) => {
  const i = PLAN_TIERS.indexOf(tier || 'free')
  return i >= 0 && i < PLAN_TIERS.length - 1 ? PLAN_TIERS[i + 1] : null
}

/** Decidido (Trello #264) — ainda não aplicado. null = sem limite. */
export const PLAN_LIMITS = {
  free: { members: 30, activeMixes: 1, courts: 2 },
  plus: { members: 300, activeMixes: 2, courts: 4 },
  pro: { members: null, activeMixes: null, courts: null },
  club: { members: null, activeMixes: null, courts: null },
}

/** O que as políticas RLS aplicam hoje aos grupos criados na Comunidade. */
export const ENFORCED_LIMITS = { members: 30, activeMixes: 3, courts: 4 }

export const limitsFor = () => ENFORCED_LIMITS

/** Mensagem para quem gere o grupo: onde bateu, em que plano está e o que o
    plano seguinte dá. `kind` é 'mix' ou 'members'. */
export function planLimitMessage(t, kind, planTier) {
  const limits = limitsFor(planTier)
  const next = nextPlanTier(planTier)
  const main = kind === 'members'
    ? t('plans.limit_members', { plan: planName(planTier), members: limits.members })
    : t('plans.limit_mix', { plan: planName(planTier), mixes: limits.activeMixes, courts: limits.courts })
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
