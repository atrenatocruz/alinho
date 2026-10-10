// Os pares a não repetir quando se formam duplas: os dos últimos QUATRO mixes
// da MESMA SÉRIE (recurrence_id) — Francisco, 28 set: «é no mesmo mix, não no
// mesmo grupo. Uma coisa é segunda, outra é quinta». Num mix que não se
// repete, os últimos 4 mixes do grupo, como antes. A mesma regra do robô
// (whatsapp-bot/src/autostart.js, loadRepeatPairKeys).
//
// Só contam os mixes que se jogaram mesmo (Francisco, 10 out): cancelados,
// rascunhos e por jogar ficam de fora. Na série do Jota, 2 dos 4 eram
// cancelados, e só se evitavam as duplas de 2 mixes.
//
// `db` é o cliente Supabase (passado de fora, para os testes).
export const PLAYED_STATUSES = ['in_progress', 'finished']

export async function loadRepeatPairKeys(db, game) {
  if (!game?.date) return new Set()
  let query = db.from('games').select('id')
  query = game.recurrence_id
    ? query.eq('recurrence_id', game.recurrence_id)
    : query.eq('organization_id', game.organization_id)
  const { data: previousGames } = await query
    .in('status', PLAYED_STATUSES)
    .lt('date', game.date)
    .order('date', { ascending: false })
    .limit(4)
  if (!previousGames?.length) return new Set()
  const { data: previousTeams } = await db
    .from('teams')
    .select('player1_id, player2_id, player1_guest_id, player2_guest_id')
    .in('game_id', previousGames.map((g) => g.id))
  // Convidados sem conta: o id efetivo do lugar é o guest_id — sem o
  // COALESCE, dois lugares-convidado davam a chave «null|null» e qualquer
  // dupla com convidado contava como repetição de outra.
  return new Set(
    (previousTeams || []).map((team) =>
      [team.player1_id ?? team.player1_guest_id, team.player2_id ?? team.player2_guest_id].sort().join('|')
    )
  )
}
