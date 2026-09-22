// Torneios (Trello #361 a #366) — leitura e escrita no Supabase.
// O modelo de dados é a Fase 0 do desenho aprovado
// (Alinho/design-handoff/2026-09-19-torneios/SPEC.md §10 e §11) e ainda
// está à espera do "sim" do Renato (base de dados) e do Ruben (contas do
// formato e do horário). Até a migração correr, estas RPCs não existem:
// quem chama trata errorKind(error) === 'not_ready' como "torneios ainda
// não disponíveis" e mostra o estado vazio — nada rebenta em produção.
//
// Em localhost, localStorage.mockTournament = 'true' (com a sessão
// Admin(Dev)) devolve um torneio fictício — ver devMockTournament.js.
//
// O torneio é uma ENTIDADE NOVA: nada aqui toca em `games` (o mix).
import { supabase } from './supabase'

/** Cabeçalho da página do torneio + categorias, numa só chamada.
 *
 *  Devolve (proposta, por validar com o Renato):
 *    tournament: { id, slug, name, organization_id, club_name, club_logo_url,
 *      location, starts_on, ends_on, status ('rascunho' | 'inscricoes' |
 *      'fechado' | 'sorteado' | 'a_decorrer' | 'terminado'), is_public,
 *      court_count, entry_fee_cents, entries_deadline, draw_on, organizer_text,
 *      poster_url, day_count, category_count, entry_count, match_count }
 *    categories: [{ id, code, name, gender, level, age_group, day_date,
 *      start_time, slots, price_cents, entry_count, status, position }]
 *    my: { category_id, state, entry_id } | null  ← UMA inscrição, a
 *        primeira da pessoa neste torneio (não uma por categoria)
 *
 *  Abre sem sessão (SPEC §4.9): a política de leitura pública devolve o
 *  mesmo, menos o `my`. */
export async function getTournamentPage(idOrSlug) {
  const { data, error } = await supabase.rpc('get_tournament_page', { p_tournament: idOrSlug })
  if (error) throw error
  return data || null
}

/** Existe torneio nesta base de dados? Usado para esconder o ponto de
 *  entrada no Gerir enquanto a migração não correr. */
export async function tournamentsAvailable() {
  // A vista pública, não a tabela: as tabelas do torneio não abrem ao
  // browser (nota do Dev 3, 21 set). Sem a migração corrida, a vista não
  // existe e isto devolve false — é o que esconde o separador no Gerir.
  const { error } = await supabase.from('tournament_public').select('id').limit(1)
  return !error
}

/** Torneios de um clube, para o Gerir (cartão «Torneio 1/6»). */
export async function listClubTournaments(organizationId) {
  const { data, error } = await supabase.rpc('list_club_tournaments', { p_organization_id: organizationId })
  if (error) throw error
  return data || []
}

/** Cria o torneio, os dias, os campos e as categorias de uma vez — é uma
 *  coisa só do ponto de vista do organizador, e meio torneio criado não
 *  serve a ninguém. Assinatura combinada com o plano técnico do Dev 3
 *  (tabelas tournaments / tournament_days / tournament_courts /
 *  tournament_categories), ainda por validar com o Renato.
 *
 *  draft: { name, location, poster_url, entries_close_at, draw_at,
 *           is_public, organizer_text, rules, days: [{ date, starts_at,
 *           ends_at, courts }], courts: ['Campo 1', …],
 *           categories: [{ code, name, gender, level, age_group, day,
 *           start_time, slots, price }] }
 *
 *  `rules` é o passo 4 inteiro (pontuação, duração mín./máx., chegar antes,
 *  aviso para antecipar, tolerância, máx. seguidos, máx. categorias por
 *  pessoa, como se escolhe quem entra) — guardado em jsonb, para não serem
 *  dez colunas que ninguém consulta. */
export async function createTournament(organizationId, draft) {
  const { data, error } = await supabase.rpc('create_tournament', {
    p_organization_id: organizationId, p_draft: draft,
  })
  if (error) throw error
  return data
}

/** O torneio inteiro para o ecrã de editar: ao contrário do
 *  get_tournament_page, funciona com rascunhos e com torneios escondidos, e
 *  devolve os campos e as categorias como o admin os escreveu.
 *
 *  Devolve { tournament, days, courts, categories, has_entries }.
 *  `has_entries` é o que decide o que se pode mudar — é a mesma conta que o
 *  update_tournament faz do lado de lá, para o ecrã não prometer o que o
 *  servidor recusa. Só admin do clube.
 *
 *  ⚠️ FUNÇÃO POR ESCREVER (Dev 3). Até existir, o ecrã de editar mostra o
 *  estado vazio, como tudo o resto do torneio. */
export async function getTournamentForEdit(tournamentId) {
  const { data, error } = await supabase.rpc('get_tournament_for_edit', { p_tournament_id: tournamentId })
  if (error) throw error
  return data || null
}

/** Editar um torneio. Enquanto não há inscrições muda-se tudo; depois, só o
 *  que não estraga inscrições feitas (nome, local, cartaz, texto do
 *  organizador, prazo, data do sorteio e se é público) — é o próprio
 *  update_tournament que ignora o resto. */
export async function updateTournament(tournamentId, draft) {
  const { error } = await supabase.rpc('update_tournament', { p_tournament_id: tournamentId, p_draft: draft })
  if (error) throw error
}

/** Abrir/fechar inscrições e voltar atrás (rascunho ↔ inscrições ↔
 *  fechado). Do sorteio em diante o estado muda sozinho. */
export async function setTournamentStatus(tournamentId, status) {
  const { error } = await supabase.rpc('set_tournament_status', { p_tournament_id: tournamentId, p_status: status })
  if (error) throw error
}

/** Só enquanto for rascunho e ninguém se tiver inscrito (cartão #361). */
export async function deleteTournament(tournamentId) {
  const { error } = await supabase.rpc('delete_tournament', { p_tournament_id: tournamentId })
  if (error) throw error
}

/** O fim do torneio (print 12): quem ganhou cada categoria e o que a pessoa
 *  que está a ver levou de lá.
 *
 *  Devolve { categories: [{ id, code, name, champion, runner_up, third,
 *  prize }], my: { xp, matches, rating_delta, category_code } | null }.
 *  `champion`/`runner_up`/`third` são a mesma forma das duplas dos jogos
 *  ({ entry_id, name, players }); `third` só existe se a categoria tiver
 *  jogo de 3.º e 4.º lugar. Abre sem conta — sem sessão vem sem o `my`.
 *
 *  ⚠️ FUNÇÃO POR ESCREVER (Dev 3). Até existir, o ecrã do fim não aparece. */
export async function getTournamentResults(idOrSlug) {
  const { data, error } = await supabase.rpc('get_tournament_results', { p_tournament: idOrSlug })
  if (error) throw error
  return data || null
}

// ── Marcadores e resultados (Trello #365, «Torneio 5/6») ─────────────────
// Mesma ideia do game_scorekeepers dos mixes, mas por torneio E categoria
// (CODIGO-EXISTENTE.md §3). Quem marca é o admin ou uma pessoa que ele
// escolhe; a mesma conta pode estar aberta noutro telemóvel ao mesmo tempo.

/** Quem pode marcar resultados neste torneio, com as categorias de cada um. */
export async function listScorekeepers(tournamentId) {
  const { data, error } = await supabase.rpc('list_tournament_scorekeepers', { p_tournament_id: tournamentId })
  if (error) throw error
  return data || []
}

/** categoryIds vazio = todas as categorias. */
export async function addScorekeeper(tournamentId, userId, categoryIds = []) {
  const { error } = await supabase.rpc('add_tournament_scorekeeper', {
    p_tournament_id: tournamentId, p_user_id: userId, p_category_ids: categoryIds,
  })
  if (error) throw error
}

export async function removeScorekeeper(tournamentId, userId) {
  const { error } = await supabase.rpc('remove_tournament_scorekeeper', {
    p_tournament_id: tournamentId, p_user_id: userId,
  })
  if (error) throw error
}

/** Os jogos de um dia que interessam a quem marca: o que está a decorrer e
 *  o que vem a seguir, em todos os campos e só nas categorias que a pessoa
 *  pode marcar. Cada linha: match_id, category_code, group_label,
 *  round_label, court, scheduled_at, status, team_a, team_b (nome e
 *  jogadores), score_a, score_b, sets, corrected_by_name, corrected_at. */
export async function listMatchesToScore(tournamentId, dateIso) {
  const { data, error } = await supabase.rpc('list_tournament_matches_to_score', {
    p_tournament_id: tournamentId, p_date: dateIso,
  })
  if (error) throw error
  return data || []
}

/** Guarda (ou corrige) o resultado. O servidor é que recalcula a
 *  classificação, preenche a fase seguinte e dá os pontos de ranking — o
 *  ecrã só manda o resultado. Uma correção fica registada com quem a fez
 *  (critério 3 do cartão #365). */
export async function saveMatchResult(matchId, { score_a, score_b, sets = null }) {
  const { error } = await supabase.rpc('save_match_result', {
    p_match_id: matchId, p_score_a: score_a, p_score_b: score_b, p_sets: sets,
  })
  if (error) throw error
}

/** Mudar um jogo de hora e/ou de campo, a partir da grelha do organizador.
 *  O servidor é que manda: recusa se o lugar novo puser alguém em dois
 *  jogos à mesma hora, der três seguidos à mesma pessoa, ocupar um campo já
 *  ocupado, ou pôr uma fase antes da anterior — as mesmas regras do
 *  tournamentSchedule.js. E avisa quem joga, se já estiver publicado.
 *
 *  ⚠️ FUNÇÃO POR ESCREVER (Dev 3). No plano técnico dele estava
 *  `reschedule_matches(ids[], new_times[])`, pensada para o «antecipar»;
 *  esta é a irmã para mover UM jogo à mão, e precisa também do campo.
 *  Até existir, a grelha mostra a mensagem de erro e não muda nada. */
export async function rescheduleMatch(matchId, { scheduled_at, court }) {
  const { error } = await supabase.rpc('reschedule_match', {
    p_match_id: matchId, p_scheduled_at: scheduled_at, p_court: court,
  })
  if (error) throw error
}

/** Falta ou desistência. `loser` é 'a' ou 'b' — quem faltou ou desistiu;
 *  `justified` só conta nas faltas (justificada / sem justificação), e a
 *  sem justificação fica no histórico visível aos admins (SPEC §7). */
export async function markWalkover(matchId, { kind, loser, justified = null }) {
  const { error } = await supabase.rpc('mark_walkover', {
    p_match_id: matchId, p_kind: kind, p_loser: loser, p_justified: justified,
  })
  if (error) throw error
}
