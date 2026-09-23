// Dev-only: dados fictícios de um torneio (Trello #361) para a sessão
// Admin(Dev) — ver devMockNetwork.js. Liga-se com
// localStorage.mockTournament = 'true'.
//
//   mockTournamentState = 'inscricoes' | 'sorteado' | 'terminado'
//     em que ponto está o torneio (por defeito 'sorteado', que é o que
//     enche a página); 'inscricoes' é antes de haver jogos.
//   mockTournamentEmpty = 'true'  torneio acabado de criar, sem inscritos.
//
// Os valores são os do desenho aprovado (design-handoff/2026-09-19-torneios,
// prints 03, 05 e 07): o "Smash Open 2026", 5 categorias, 84 duplas,
// 127 jogos, 3 dias. NÃO são os do Smash Cup — esses ainda estão a ser
// decididos com o WFit e não se fixam no código (ATUALIZACOES-21-SET, §5).

const on = () => localStorage.getItem('mockTournament') === 'true'
const empty = () => localStorage.getItem('mockTournamentEmpty') === 'true'
const state = () => localStorage.getItem('mockTournamentState') || 'sorteado'

// Cartaz fictício: é a imagem que o CLUBE carrega, não um desenho nosso.
// De propósito com cara de cartaz de clube (e não de ecrã da app), para
// ninguém confundir os dois ao ver um print.
const FAKE_POSTER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="480">'
  + '<rect width="1200" height="480" fill="#0E3B2E"/>'
  + '<rect x="70" y="60" width="1060" height="360" fill="none" stroke="#7FB77E" stroke-width="4"/>'
  + '<line x1="600" y1="60" x2="600" y2="420" stroke="#7FB77E" stroke-width="4"/>'
  + '<text x="120" y="230" font-family="Georgia" font-size="64" fill="#FFFFFF">Smash Padel Almada</text>'
  + '<text x="122" y="300" font-family="Georgia" font-size="34" fill="#BFE3C6">cartaz do clube · 9 a 11 de outubro</text></svg>'
)

const pad = (n) => String(n).padStart(2, '0')
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
// Sexta, sábado e domingo da semana que vem — para o torneio cair sempre
// à frente de hoje, seja qual for o dia em que se abre o ecrã.
const nextFriday = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + ((5 - ((d.getDay() + 6) % 7) - 1 + 7) % 7 || 7))
  return d
}
const dayAfter = (base, n) => {
  const d = new Date(base)
  d.setDate(d.getDate() + n)
  return d
}

const CATEGORIES = [
  { id: 'cat-m3', code: 'M3', name: 'Masculinos 3', gender: 'masculino', level: 3, day_index: 0, start_time: '18:00', slots: 16, entry_count: 16, price_cents: 2500, status: 'inscricoes', position: 1 },
  { id: 'cat-m4', code: 'M4', name: 'Masculinos 4', gender: 'masculino', level: 4, day_index: 1, start_time: '12:00', slots: 24, entry_count: 24, price_cents: 2500, status: 'inscricoes', position: 2 },
  { id: 'cat-m5', code: 'M5', name: 'Masculinos 5', gender: 'masculino', level: 5, day_index: 1, start_time: '10:00', slots: 16, entry_count: 16, price_cents: 2500, status: 'sorteada', position: 3 },
  { id: 'cat-f4', code: 'F4', name: 'Femininos 4', gender: 'feminino', level: 4, day_index: 2, start_time: '12:00', slots: 12, entry_count: 12, price_cents: 2500, status: 'inscricoes', position: 4 },
  { id: 'cat-mx4', code: 'MX4', name: 'Mistos 4', gender: 'misto', level: 4, day_index: 1, start_time: '12:00', slots: 16, entry_count: 16, price_cents: 3000, status: 'inscricoes', position: 5 },
]

// "Os meus jogos" do print 05, 1.º telemóvel: três jogos de grupo ganhos,
// os quartos com hora antecipada (era 17:00) e as meias ainda por saber.
const MY_MATCHES = () => {
  const fri = nextFriday()
  const sat = iso(dayAfter(fri, 1))
  const sun = iso(dayAfter(fri, 2))
  return [
    { id: 'm-1', category_id: 'cat-m5', phase: 'group', group_label: 'Grupo A', round_label: null, order_in_group: 1, of_group: 3, date: sat, time: '10:00', court: 'Campo 2', opponent: 'Dois não fazem um', score: '9-6', won: true, status: 'terminado', previous_time: null },
    { id: 'm-2', category_id: 'cat-m5', phase: 'group', group_label: 'Grupo A', round_label: null, order_in_group: 2, of_group: 3, date: sat, time: '13:00', court: 'Campo 1', opponent: 'Santos / Santos', score: '9-8', won: true, status: 'terminado', previous_time: null },
    { id: 'm-3', category_id: 'cat-m5', phase: 'group', group_label: 'Grupo A', round_label: null, order_in_group: 3, of_group: 3, date: sat, time: '15:00', court: 'Campo 3', opponent: 'Costa / Pinto', score: '9-6', won: true, status: 'terminado', previous_time: null },
    { id: 'm-4', category_id: 'cat-m5', phase: 'knockout', group_label: null, round_label: 'Quartos de final', order_in_group: null, of_group: null, date: sat, time: '16:20', court: 'Campo 3', opponent: '2.º do Grupo B', score: null, won: null, status: 'marcado', previous_time: '17:00' },
    { id: 'm-5', category_id: 'cat-m5', phase: 'knockout', group_label: null, round_label: 'Meias-finais', order_in_group: null, of_group: null, date: sun, time: '10:00', court: null, opponent: null, score: null, won: null, status: 'previsto', previous_time: null },
  ]
}

const TOURNAMENT = () => {
  const fri = nextFriday()
  // `mockTournamentEmpty` = torneio acabado de criar. Se o estado for pedido
  // à mão, manda ele — é a única forma de ver «rascunho sem inscritos», que
  // é o único caso em que o botão de apagar aparece na barra do admin.
  const asked = localStorage.getItem('mockTournamentState')
  const st = empty() && !asked ? 'inscricoes' : state()
  return {
    id: 'tour-smash-open',
    slug: 'smash-open-2026',
    name: 'Smash Open 2026',
    organization_id: '00000000-0000-0000-0000-0000000000aa',
    club_name: 'Smash Padel',
    club_logo_url: null,
    location: 'Smash Padel · Almada',
    starts_on: iso(fri),
    ends_on: iso(dayAfter(fri, 2)),
    status: st,
    is_public: true,
    // A mesma conta que o `get_tournament_page` faz do lado de lá: é
    // pré-visualização quando o torneio não abre a quem chega de fora —
    // ainda rascunho, ou escondido.
    is_preview: st === 'rascunho',
    court_count: 4,
    entry_fee_cents: 2500,
    entries_deadline: iso(dayAfter(fri, -4)),
    draw_on: iso(dayAfter(fri, -2)),
    organizer_text: 'Pagamento na receção ou por MB Way. A inscrição só fica válida quando o clube confirmar.',
    // mockTournamentScoring = 'melhor_2_sets' | 'melhor_3_sets' para ver o
    // ecrã do marcador a pedir os sets um a um.
    rules: { scoring: localStorage.getItem('mockTournamentScoring') || 'pro_set_9' },
    // Cartaz fictício, para se ver o topo da página com imagem. Em
    // localhost não há Storage: carregar um cartaz a sério precisa de
    // sessão verdadeira.
    poster_url: FAKE_POSTER,
    day_count: 3,
    category_count: empty() ? 5 : CATEGORIES.length,
    entry_count: empty() ? 0 : 84,
    match_count: empty() || st === 'inscricoes' ? 0 : 127,
  }
}

// day_index é só dos dados de teste: na base de dados a categoria guarda
// day_date (a data mesmo), como o Dev 3 escreveu na nota de 21 set.
const categories = () => {
  const fri = nextFriday()
  return CATEGORIES.map(({ day_index, ...c }) => ({
    ...c,
    day_date: iso(dayAfter(fri, day_index)),
    entry_count: empty() ? 0 : c.entry_count,
  }))
}

// O que o admin criar em localhost fica aqui até recarregar a página — é o
// que basta para ver a lista cheia, o torneio novo e os botões de estado.
let created = []

export const TOURNAMENT_RPC_MOCKS = {
  list_club_tournaments: () => {
    if (!on()) return []
    const base = empty() ? [] : [{
      ...TOURNAMENT(),
      entry_count: 84,
      category_count: 5,
    }]
    return [...created, ...base]
  },
  create_tournament: (params) => {
    const d = params?.p_draft || {}
    const days = d.days || []
    created = [{
      id: `tour-${created.length + 1}`,
      slug: null,
      name: d.name || 'Torneio',
      club_name: 'Smash Padel',
      club_logo_url: null,
      location: d.location || null,
      starts_on: days[0]?.date || null,
      ends_on: days[days.length - 1]?.date || null,
      status: d.status || 'rascunho',
      category_count: (d.categories || []).length,
      entry_count: 0,
      day_count: days.length,
      match_count: 0,
    }, ...created]
    return created[0].id
  },
  set_tournament_status: (params) => {
    created = created.map((x) => (x.id === params?.p_tournament_id ? { ...x, status: params.p_status } : x))
    return null
  },
  delete_tournament: (params) => {
    created = created.filter((x) => x.id !== params?.p_tournament_id)
    return null
  },
  // Espelha o get_tournament_results a sério (migration_tournaments_finish
  // + _results_my, Dev 3): sem XP — não existe conta de XP nos torneios — e
  // com `podium_players`, uma linha por PESSOA, que é o que resolve o caso
  // da dupla que trocou de gente a meio. O `champion.name` continua a ser o
  // nome da DUPLA; os dois níveis são de propósito.
  get_tournament_results: () => {
    if (!on()) return null
    const t2 = (name, players) => ({ entry_id: name, name, players })
    const pp = (name, final_position, played_final, matches_played, matches_won) =>
      ({ name, final_position, played_final, matches_played, matches_won })
    return {
      categories: [
        { id: 'cat-m5', code: 'M5', name: 'Masculinos 5',
          // O `champion` é o par ATUAL da inscrição (confirmado pelo Dev 3 no
          // ensaio): quem saiu a meio não aparece no nome da dupla, só na
          // lista de baixo. É de propósito — o nome da dupla é o que vai no
          // cartaz e no WhatsApp.
          champion: t2('Barros / Antunes', ['Francisco Barros', 'Hugo Antunes']),
          runner_up: t2('Lima / Reis', ['Pedro Lima', 'Nuno Reis']),
          third: null, prize_first: '2 garrafas de bolas · voucher', prize_second: '1 garrafa de bolas',
          // O Rui Costa torceu o tornozelo nos grupos; entrou o Hugo Antunes
          // e jogou a final. Os três ficam campeões (Francisco, 23 set).
          podium_players: [
            pp('Francisco Barros', 1, true, 5, 4),
            pp('Hugo Antunes', 1, true, 2, 2),
            pp('Rui Costa', 1, false, 3, 2),
            pp('Pedro Lima', 2, true, 5, 3),
            pp('Nuno Reis', 2, true, 5, 3),
          ] },
        { id: 'cat-mx4', code: 'MX4', name: 'Mistos 4',
          champion: t2('Silva / Lopes', ['Marta Silva', 'Tiago Lopes']),
          runner_up: t2('Francisco Barros / Silva', ['Francisco Barros', 'Marta Silva']),
          third: t2('Reis / Ana', ['Nuno Reis', 'Ana Moreira']), prize_first: null, prize_second: null,
          podium_players: [
            pp('Marta Silva', 1, true, 4, 4),
            pp('Tiago Lopes', 1, true, 4, 4),
            pp('Francisco Barros', 2, true, 4, 3),
            pp('Ana Moreira', 3, true, 4, 2),
            pp('Nuno Reis', 3, true, 4, 2),
          ] },
      ],
      my: {
        player_name: 'Francisco Barros', category_code: 'M5', category_name: 'Masculinos 5',
        matches: 5, matches_won: 4, rating_delta: 18, final_position: 1,
      },
    }
  },
  get_tournament_for_edit: (params) => {
    if (!on()) return null
    const fri = nextFriday()
    const mine = created.find((x) => x.id === params?.p_tournament_id)
    const t = mine ? { ...TOURNAMENT(), ...mine } : TOURNAMENT()
    return {
      tournament: { ...t, entries_deadline: `${t.entries_deadline}T23:59`, draw_on: t.draw_on, rules: {} },
      days: [0, 1, 2].map((n) => ({
        id: `d${n}`, date: iso(dayAfter(fri, n)), starts_at: n === 0 ? '18:00' : '09:00', ends_at: n === 2 ? '18:00' : '21:00', courts: n === 2 ? 3 : 4,
      })),
      courts: ['Campo 1', 'Campo 2', 'Campo 3 · KIA', 'Campo 4'].map((name, i) => ({ id: `c${i}`, name })),
      categories: categories(),
      // mockTournamentEntries = 'true' → já há inscrições, e então só se
      // pode mudar o que não as estraga.
      has_entries: localStorage.getItem('mockTournamentEntries') === 'true',
    }
  },
  update_tournament: () => null,
  get_tournament_page: () => {
    if (!on()) return null
    return {
      tournament: TOURNAMENT(),
      categories: categories(),
      my: empty() ? null : { category_id: 'cat-m5', state: 'validada', entry_id: 'en-me' },
      my_matches: empty() || state() === 'inscricoes' ? [] : MY_MATCHES(),
    }
  },
}

// ── Marcadores e resultados (#365) ──────────────────────────────────────
// Guardar um resultado em localhost muda mesmo o cartão, para se poder ver
// o ecrã antes e depois — e o «corrigir».
const team = (name, players) => ({ entry_id: name.toLowerCase().replace(/[^a-z]/g, ''), name, players })
let MATCHES = null
const resetMatches = () => {
  const today = new Date()
  const at = (hhmm) => `${iso(today)}T${hhmm}`
  // O dia do print 10: quatro horas, dois campos, três categorias — e o
  // Rui Costa a jogar às 10, às 11 e às 12, que é o choque que o desenho
  // mostra assinalado a vermelho ("ficava com 3 jogos seguidos").
  const m = (id, code, group, court, hhmm, status, a, b, score) => ({
    match_id: id, category_code: code, group_label: group, round_label: null,
    court, scheduled_at: at(hhmm), status,
    team_a: a, team_b: b,
    score_a: score ? score[0] : null, score_b: score ? score[1] : null,
    sets: null, corrected_by_name: null,
  })
  const barros = team('Barros / Costa', ['Francisco Barros', 'Rui Costa'])
  const santos = team('Santos / Santos', ['José Santos', 'Rafael Santos'])
  const silva = team('Silva / Lopes', ['Marta Silva', 'Tiago Lopes'])
  const reis = team('Reis / Ana', ['Nuno Reis', 'Ana Moreira'])
  const tapia = team('Tapia Girls', ['Inês Rocha', 'Beatriz Faria'])
  const barao = team('Barão / Néu', ['Sofia Barão', 'Rita Néu'])
  const lima = team('Lima / Reis', ['Pedro Lima', 'Nuno Reis'])
  const gomes = team('Gomes / Pais', ['André Gomes', 'Vasco Pais'])
  const pinto = team('Costa / Pinto', ['Rui Costa', 'Dinis Pinto'])
  const marta = team('Costa / Marta', ['Rui Costa', 'Marta Silva'])
  const boss = team("Boss's", ['Zé Carlos', 'Vasco Tomás'])
  const nunes = team('Nunes / Cruz', ['Ivo Nunes', 'António Cruz'])

  MATCHES = [
    m('m-1', 'M5', 'Grupo A', 'Campo 1', '10:00', 'terminado', barros, santos, [9, 6]),
    m('m-2', 'MX4', 'Grupo B', 'Campo 2', '10:00', 'terminado', silva, reis, [9, 7]),
    m('m-3', 'F4', 'Grupo A', 'Campo 1', '11:00', 'a_decorrer', tapia, barao),
    m('m-4', 'M5', 'Grupo B', 'Campo 2', '11:00', 'a_decorrer', lima, pinto),
    m('m-5', 'MX4', 'Grupo A', 'Campo 1', '12:00', 'marcado', marta, gomes),
    m('m-6', 'M5', 'Grupo C', 'Campo 3', '12:00', 'marcado', santos, boss),
    m('m-7', 'M5', 'Grupo A', 'Campo 1', '13:00', 'marcado', nunes, boss),
    m('m-8', 'F4', 'Grupo B', 'Campo 2', '13:00', 'marcado', tapia, barao),
  ]
}

const SCOREKEEPERS = [
  { user_id: 'u-ana', name: 'Ana Moreira', avatar_url: null, category_codes: [] },
  { user_id: 'u-tiago', name: 'Tiago Lopes', avatar_url: null, category_codes: ['M5', 'MX4'] },
]

export const TOURNAMENT_SCORE_RPC_MOCKS = {
  list_tournament_scorekeepers: () => (on() && !empty() ? SCOREKEEPERS : []),
  add_tournament_scorekeeper: () => null,
  remove_tournament_scorekeeper: () => null,
  list_tournament_matches_to_score: () => {
    if (!on()) return []
    if (!MATCHES) resetMatches()
    return empty() ? [] : MATCHES
  },
  save_match_result: (params) => {
    if (!MATCHES) resetMatches()
    MATCHES = MATCHES.map((m) => (m.match_id === params?.p_match_id ? {
      ...m,
      status: 'terminado',
      score_a: params.p_score_a,
      score_b: params.p_score_b,
      sets: params.p_sets || null,
      // Corrigir um resultado já gravado fica registado (cartão #365).
      corrected_by_name: m.status === 'terminado' ? 'Admin (Dev)' : null,
    } : m))
    return null
  },
  reschedule_match: (params) => {
    if (!MATCHES) resetMatches()
    MATCHES = MATCHES.map((m) => (m.match_id === params?.p_match_id ? {
      ...m,
      previous_scheduled_at: m.scheduled_at,
      // Guarda como a base de dados: com fuso, não texto cortado.
      scheduled_at: new Date(params.p_scheduled_at).toISOString(),
      court: params.p_court || m.court,
    } : m))
    return null
  },
  mark_walkover: (params) => {
    if (!MATCHES) resetMatches()
    MATCHES = MATCHES.map((m) => (m.match_id === params?.p_match_id ? {
      ...m,
      status: params.p_kind === 'falta' ? 'falta' : 'desistencia',
      score_a: params.p_loser === 'a' ? 0 : 9,
      score_b: params.p_loser === 'a' ? 9 : 0,
    } : m))
    return null
  },
}

Object.assign(TOURNAMENT_RPC_MOCKS, TOURNAMENT_SCORE_RPC_MOCKS)

export const TOURNAMENT_TABLE_MOCKS = {
  tournaments: () => (on() ? [TOURNAMENT()] : []),
}
