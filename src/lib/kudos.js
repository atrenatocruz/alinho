/* Kudos — quem deu o kudo (Trello #340).

   A RPC get_unseen_celebrations devolve, no ramo dos kudos, a coluna
   `voters`: quem deu, só a quem recebeu (ver
   supabase/migration_kudos_voter_names.sql). Aqui fica só a parte pura:
   limpar a lista e escrever os nomes numa frase.

   Se quem deu apagou a conta, o nome vem vazio e mostra-se "Jogador
   removido" (mesma palavra do ecrã de apagar conta, Trello #306). */

// Quantas caras se mostram antes de passar a "e mais N".
export const MAX_KUDOS_VOTERS = 3

export function kudosVoters(row, removedLabel = '') {
  const list = Array.isArray(row?.voters) ? row.voters : []
  return list
    .filter((v) => v && v.id)
    .map((v) => ({
      id: v.id,
      name: v.name || removedLabel,
      avatarUrl: v.avatar_url || null,
      removed: !v.name,
    }))
}

/* "Rui" · "Rui e Ana" · "Rui, Ana e Tó" · "Rui, Ana, Tó e mais 2".
   O "e" e o "mais N" vêm traduzidos de fora — a função não conhece
   idiomas. */
export function joinNames(names, { and = 'e', more = (n) => `+${n}`, max = MAX_KUDOS_VOTERS } = {}) {
  const clean = (names || []).filter((n) => n && n.trim())
  if (clean.length === 0) return ''
  if (clean.length === 1) return clean[0]
  if (clean.length <= max) return `${clean.slice(0, -1).join(', ')} ${and} ${clean[clean.length - 1]}`
  return `${clean.slice(0, max).join(', ')} ${and} ${more(clean.length - max)}`
}
