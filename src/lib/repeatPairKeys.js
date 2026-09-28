// Os pares a não repetir quando se formam duplas: os dos últimos QUATRO mixes
// da MESMA SÉRIE (recurrence_id) — Francisco, 28 set: «é no mesmo mix, não no
// mesmo grupo. Uma coisa é segunda, outra é quinta». Num mix que não se
// repete, os últimos 4 mixes do grupo, como antes. A mesma regra do robô
// (whatsapp-bot/src/autostart.js, loadRepeatPairKeys).
//
// `db` é o cliente Supabase (passado de fora, para os testes).
export async function loadRepeatPairKeys(db, game) {
  if (!game?.date) return new Set()
  let query = db.from('games').select('id')
  query = game.recurrence_id
    ? query.eq('recurrence_id', game.recurrence_id)
    : query.eq('organization_id', game.organization_id)
  const { data: previousGames } = await query
    .lt('date', game.date)
    .order('date', { ascending: false })
    .limit(4)
  if (!previousGames?.length) return new Set()
  const { data: previousTeams } = await db
    .from('teams')
    .select('player1_id, player2_id')
    .in('game_id', previousGames.map((g) => g.id))
  return new Set(
    (previousTeams || []).map((team) => [team.player1_id, team.player2_id].sort().join('|'))
  )
}
