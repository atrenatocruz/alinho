import { supabase } from './supabase'
import { eventFromTournament, eventFromTournamentMatch } from './agenda'

/* O torneio na Home (Trello #363, fronteira combinada com o Dev 1 a 22 set).

   Antes do sorteio a pessoa vê UM cartão do torneio; depois do sorteio esse
   cartão sai e entram os JOGOS dela, cada um no seu dia (SPEC §3, print 04).
   É a Home que a malta abre nos dias do torneio para saber a que horas joga.

   Lê-se tudo das vistas públicas que o Dev 3 criou — nenhuma função nova:
     tournament_public            o torneio
     tournament_public_categories as categorias
     tournament_public_matches    os jogos (só os `entry_*_id`, sem nomes)
     tournament_public_entries    os nomes das duplas
   Sem a base de dados dos torneios, tudo isto devolve vazio e a Home fica
   exatamente como estava. */

// Nome de uma dupla como aparece no cartão: o nome de equipa se houver,
// senão os dois apelidos (regra do desenho, §2).
export function pairLabel(entry) {
  if (!entry) return null
  if (entry.team_name) return entry.team_name
  const names = [entry.player1_name, entry.player2_name].filter(Boolean)
  return names.length ? names.join(' / ') : null
}

const quiet = (error, what) => {
  // 42P01 = a tabela/vista ainda não existe (migração por correr).
  if (error?.code !== '42P01') console.error(`Error loading ${what} for the agenda:`, error)
  return []
}

export async function loadTournamentEvents({ userId, orgIds = [], today }) {
  if (!userId || orgIds.length === 0) return []

  const { data: tournaments, error: tError } = await supabase
    .from('tournament_public')
    .select('id, slug, name, organization_id, club_name, club_logo_url, starts_on, ends_on, status, entries_deadline, entry_fee_cents, category_count')
    .in('organization_id', orgIds)
    .gte('ends_on', today)
  if (tError) return quiet(tError, 'tournaments')
  if (!tournaments?.length) return []

  const ids = tournaments.map((t) => t.id)

  // As minhas inscrições nestes torneios (a RLS já só deixa ver as dos
  // torneios públicos; o filtro por mim é para não trazer o clube inteiro).
  const { data: myEntries, error: eError } = await supabase
    .from('tournament_entries')
    .select('id, category_id, status')
    .or(`player1_id.eq.${userId},player2_id.eq.${userId}`)
    .neq('status', 'desistiu')
  if (eError) quiet(eError, 'my tournament entries')

  const { data: categories } = await supabase
    .from('tournament_public_categories')
    .select('id, tournament_id, code, name')
    .in('tournament_id', ids)

  const catById = new Map((categories || []).map((c) => [c.id, c]))
  const mine = (myEntries || []).filter((e) => catById.has(e.category_id))
  const myEntryIds = new Set(mine.map((e) => e.id))
  const myByTournament = new Map()
  for (const entry of mine) {
    const cat = catById.get(entry.category_id)
    if (cat) myByTournament.set(cat.tournament_id, { state: entry.status, entry_id: entry.id, category_id: entry.category_id })
  }

  // Os meus jogos, se já houve sorteio.
  let matches = []
  if (mine.length) {
    const { data, error } = await supabase
      .from('tournament_public_matches')
      .select('id, category_id, stage, round, entry_a_id, entry_b_id, scheduled_at, previous_scheduled_at, court_name, status')
      .in('category_id', mine.map((e) => e.category_id))
    if (error) quiet(error, 'tournament matches')
    matches = (data || []).filter((m) => myEntryIds.has(m.entry_a_id) || myEntryIds.has(m.entry_b_id))
  }

  // Os nomes das duplas vêm à parte: a vista dos jogos só tem os ids.
  let entryById = new Map()
  if (matches.length) {
    const needed = [...new Set(matches.flatMap((m) => [m.entry_a_id, m.entry_b_id]).filter(Boolean))]
    const { data } = await supabase
      .from('tournament_public_entries')
      .select('id, team_name, player1_name, player2_name')
      .in('id', needed)
    entryById = new Map((data || []).map((e) => [e.id, e]))
  }

  const tourById = new Map(tournaments.map((t) => [t.id, t]))
  const withMatches = new Set()
  const events = []

  for (const match of matches) {
    const cat = catById.get(match.category_id)
    const tour = cat && tourById.get(cat.tournament_id)
    if (!tour) continue
    withMatches.add(tour.id)
    const mineIsA = myEntryIds.has(match.entry_a_id)
    events.push(eventFromTournamentMatch(match, {
      tournament: tour,
      category: cat,
      myTeamName: pairLabel(entryById.get(mineIsA ? match.entry_a_id : match.entry_b_id)),
      opponentName: pairLabel(entryById.get(mineIsA ? match.entry_b_id : match.entry_a_id)),
    }))
  }

  for (const tour of tournaments) {
    // Feito o sorteio, o cartão do torneio dá lugar aos jogos.
    if (withMatches.has(tour.id)) continue
    // Um torneio onde não estou só aparece enquanto der para entrar.
    const my = myByTournament.get(tour.id) || null
    if (!my && tour.status !== 'inscricoes') continue
    events.push(eventFromTournament(tour, my))
  }

  return events
}
