// O superadmin com o modo ligado entra em todos os grupos como antes de 18 out,
// e para os outros continua invisível (Francisco, 29 out). A base dá os grupos
// onde só tem o acesso de superadmin (get_my_superadmin_groups, Dev 3: [] com o
// modo desligado); aqui juntam-se às inscrições, marcados, para a app os tratar
// como grupos onde organiza sem nunca escrever numa linha que não existe.

/** As inscrições com os grupos do superadmin juntos no fim. `hidden` vem da
 *  get_my_superadmin_groups (ou null, se a função falhou). */
export function withSuperadminGroups(memberships, hidden) {
  const mine = memberships || []
  if (!Array.isArray(hidden) || hidden.length === 0) return mine
  const have = new Set(mine.map((m) => m.organization_id))
  const extra = hidden
    .filter((m) => m?.organization && m.organization_id && !have.has(m.organization_id))
    .map((m) => ({ ...m, is_admin: true, superadmin_hidden: true }))
  return [...mine, ...extra]
}

/** É uma inscrição que só existe pelo acesso de superadmin? */
export const isSuperadminHiddenIn = (memberships, organizationId) =>
  (memberships || []).some((m) => m.organization_id === organizationId && m.superadmin_hidden === true)
