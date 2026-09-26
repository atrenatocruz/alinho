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

const myGamesReal = () => localStorage.getItem('mockTMyGamesReal') === 'true'

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
    // Como a base de dados o guarda: um instante com fuso. 22:59 UTC é 23:59
    // em Lisboa no horário de verão — é o que o ecrã tem de mostrar (#487).
    // mockTReopenLate: o prazo do torneio já passou (ontem) — o aviso do
    // sorteio fica até ser mudado.
    entries_deadline: localStorage.getItem('mockTReopenLate') === 'true'
      ? `${iso(dayAfter(new Date(), -1))}T22:59:00+00:00`
      : `${iso(dayAfter(fri, -4))}T22:59:00+00:00`,
    draw_on: iso(dayAfter(fri, -2)),
    organizer_text: 'Pagamento na receção ou por MB Way. A inscrição só fica válida quando o clube confirmar.',
    // mockTournamentScoring = 'melhor_2_sets' | 'melhor_3_sets' para ver o
    // ecrã do marcador a pedir os sets um a um.
    // mockTTieBreak = 'super_tiebreak': o 8-8 decide-se no super tie-break a 10.
    rules: { scoring: localStorage.getItem('mockTournamentScoring') || 'pro_set_9', tiebreak_8_8: localStorage.getItem('mockTTieBreak') || 'tiebreak' },
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
  // mockTDrawPartial (Trello #560): 'true' = M5 sorteada, M3 e M4 fechadas
  // por sortear, F4 e MX4 ainda abertas; 'all' = todas sorteadas.
  const partial = localStorage.getItem('mockTDrawPartial')
  const statusOf = (c) => (partial === 'all' ? 'sorteada'
    : partial === 'true' && ['M3', 'M4'].includes(c.code) ? 'fechada' : c.status)
  return CATEGORIES.map(({ day_index, ...c }) => ({
    ...c,
    status: statusOf(c),
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
    // mockTPrivate = 'true': mais um, privado e com inscrições abertas (#482).
    const priv = localStorage.getItem('mockTPrivate') === 'true' && !empty()
      ? [{ ...TOURNAMENT(), id: 'tour-private', slug: 'smash-cup-privado', name: 'Smash Cup by WFit', status: 'inscricoes', is_public: false, entry_count: 12, category_count: 7 }]
      : []
    return [...created, ...priv, ...base]
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
  // Os torneios abertos, para a Comunidade e a Home (Trello #462). Espelha
  // a `list_open_tournaments`: fecha primeiro à frente de joga primeiro, e
  // `spots_left` a null quer dizer «sem limite de vagas», não zero.
  list_open_tournaments: (params) => {
    if (!on()) return null
    const t = TOURNAMENT()
    const linha = {
      id: t.id, slug: t.slug, name: 'Smash Cup by WFit', location: 'Smash Padel Almada',
      poster_url: t.poster_url, starts_on: t.starts_on, ends_on: t.ends_on,
      entries_deadline: t.entries_deadline, entry_fee_cents: 2500, status: 'inscricoes',
      organization_id: t.organization_id, club_name: 'Smash Padel Almada', club_logo_url: null,
      day_count: 3, court_count: 4, categories_total: 7, categories_open: 7,
      spots_left: 12, entries_confirmed: 34, days_to_deadline: 5,
    }
    // Um segundo, sem limite de vagas, para se ver que o `null` não é zero.
    const outro = {
      ...linha, id: 'tour-liga-verao', slug: 'liga-de-verao', name: 'Liga de Verão',
      location: 'Padel Parque', club_name: 'Padel Parque', categories_total: 2,
      categories_open: 2, spots_left: null, entries_confirmed: 8, days_to_deadline: 12,
      entry_fee_cents: 0, poster_url: null,
    }
    const todos = [linha, outro]
    const so = params?.p_organization_id
    return (so ? todos.filter((x) => x.organization_id === so) : todos).slice(0, params?.p_limit || 20)
  },
  get_tournament_for_edit: (params) => {
    if (!on()) return null
    const fri = nextFriday()
    const mine = created.find((x) => x.id === params?.p_tournament_id)
    const t = mine ? { ...TOURNAMENT(), ...mine } : TOURNAMENT()
    // mockTBadDates (Trello #514): 'past' = prazo já passado (ontem);
    // 'draw' = sorteio antes do prazo; 'duration' = mínima maior que a máxima.
    const bad = localStorage.getItem('mockTBadDates')
    const yesterday = dayAfter(new Date(), -1)
    // 'legacy' (QA, 26 set): o prazo guardado sem fuso antes do #487 —
    // 23:59 em UTC, que em Lisboa é 00:59 do dia seguinte.
    const edits = bad === 'legacy' ? { entries_deadline: '2026-10-05T23:59:00+00:00' }
      : bad === 'past' ? { entries_deadline: `${iso(yesterday)}T22:59:00+00:00` }
      : bad === 'draw' ? { draw_on: iso(dayAfter(fri, -6)) }
        : {}
    const rules = bad === 'duration' ? { duration_min: 90, duration_max: 60 } : {}
    return {
      tournament: { ...t, draw_on: t.draw_on, ...edits, rules },
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
    const fri = nextFriday()
    return {
      tournament: TOURNAMENT(),
      categories: categories(),
      // Os dias do torneio vêm mesmo nesta resposta em produção (confirmado
      // no tournament_page_json); faltavam aqui, e sem eles o seletor de dia
      // do ecrã de marcar nunca aparecia em localhost (Trello #460).
      days: [0, 1, 2].map((n) => ({
        id: `d${n}`, date: iso(dayAfter(fri, n)),
        starts_at: n === 0 ? '18:00' : '09:00', ends_at: n === 2 ? '18:00' : '21:00',
      })),
      // localStorage.mockTMyGamesReal = 'true' (+ mockTDraw): sou a dupla e1
      // do M4 e «Os meus jogos» lê as vistas, como em produção (Trello #508).
      ...(myGamesReal()
        ? { my: { category_id: 'cat-m4', state: 'validada', entry_id: 'e1' },
            my_entries: [{ category_id: 'cat-m4', status: 'validada', state: 'validada', entry_id: 'e1' }],
            my_matches: [] }
        : { my: empty() ? null : { category_id: 'cat-m5', state: 'validada', entry_id: 'en-me' },
            my_matches: empty() || state() === 'inscricoes' ? [] : MY_MATCHES() }),
    }
  },
}

// ── Marcadores e resultados (#365) ──────────────────────────────────────
// Guardar um resultado em localhost muda mesmo o cartão, para se poder ver
// o ecrã antes e depois — e o «corrigir».
const team = (name, players) => ({ entry_id: name.toLowerCase().replace(/[^a-z]/g, ''), name, players })
let MATCHES = null
const resetMatches = () => {
  // No 1.º dia do torneio de teste (sexta), e com fuso — como vêm da base de
  // dados. Estavam em «hoje» e sem fuso: não batiam com os dias do próprio
  // torneio de teste, e só apareciam porque o mock ignorava o dia pedido
  // (Trello #487, a página de marcar passou a escolher o dia ela mesma).
  const day1 = nextFriday()
  const at = (hhmm) => new Date(`${iso(day1)}T${hhmm}`).toISOString()
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
    // localStorage.mockTCorrection = 'true': a Marta pede a correção deste
    // jogo (Trello #485), para se ver o pedido no /marcar.
    { ...m('m-2', 'MX4', 'Grupo B', 'Campo 2', '10:00', 'terminado', silva, reis, [9, 7]),
      correction_request: localStorage.getItem('mockTCorrection') === 'true'
        ? { score_a: 7, score_b: 9, note: 'Trocaram as duplas ao marcar.', at: new Date().toISOString(), by_name: 'Marta Silva' }
        : null },
    m('m-3', 'F4', 'Grupo A', 'Campo 1', '11:00', 'a_decorrer', tapia, barao),
    m('m-4', 'M5', 'Grupo B', 'Campo 2', '11:00', 'a_decorrer', lima, pinto),
    m('m-5', 'MX4', 'Grupo A', 'Campo 1', '12:00', 'marcado', marta, gomes),
    m('m-6', 'M5', 'Grupo C', 'Campo 3', '12:00', 'marcado', santos, boss),
    m('m-7', 'M5', 'Grupo A', 'Campo 1', '13:00', 'marcado', nunes, boss),
    m('m-8', 'F4', 'Grupo B', 'Campo 2', '13:00', 'marcado', tapia, barao),
  ]
  // localStorage.mockTUnscheduled = 'true' — quatro jogos acabados de
  // sortear, sem hora nem campo, como a draw_category os deixa (#487).
  if (localStorage.getItem('mockTUnscheduled') === 'true') {
    const semHora = (id, code, group, a, b) => ({
      ...m(id, code, group, null, '10:00', 'marcado', a, b), scheduled_at: null, court: null,
      category_id: `cat-${code.toLowerCase()}`, stage: 'grupo',
    })
    MATCHES = [
      ...MATCHES,
      semHora('u-1', 'M4', 'Grupo A', barros, lima),
      semHora('u-2', 'M4', 'Grupo A', gomes, nunes),
      semHora('u-3', 'M4', 'Grupo B', santos, boss),
      semHora('u-4', 'F4', 'Grupo C', tapia, barao),
    ]
  }
}

const SCOREKEEPERS = [
  { user_id: 'u-ana', name: 'Ana Moreira', avatar_url: null, category_codes: [] },
  { user_id: 'u-tiago', name: 'Tiago Lopes', avatar_url: null, category_codes: ['M5', 'MX4'] },
]

export const TOURNAMENT_SCORE_RPC_MOCKS = {
  list_tournament_scorekeepers: () => (on() && !empty() ? SCOREKEEPERS : []),
  add_tournament_scorekeeper: () => null,
  remove_tournament_scorekeeper: () => null,
  // Pedidos de correção (Trello #485): pedir não muda nada no /marcar de
  // teste; resolver grava (aceitar) ou só limpa o pedido (recusar).
  request_match_correction: () => null,
  resolve_match_correction: (params) => {
    if (!MATCHES) resetMatches()
    MATCHES = MATCHES.map((m) => {
      if (m.match_id !== params?.p_match_id || !m.correction_request) return m
      const r = m.correction_request
      return params.p_accept
        ? { ...m, score_a: r.score_a, score_b: r.score_b, corrected_by_name: 'Admin (Dev)', correction_request: null }
        : { ...m, correction_request: null }
    })
    return null
  },
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
  // Quem está no ensaio de admin pode marcar (#487).
  can_score_tournament: () => on(),
  // Grava as horas propostas, como a save_match_schedule: hora com fuso e
  // o campo pelo nome (#487).
  save_match_schedule: (params) => {
    if (!MATCHES) resetMatches()
    const slots = new Map((params?.p_slots || []).map((sl) => [sl.match_id, sl]))
    MATCHES = MATCHES.map((m) => (slots.has(m.match_id) ? {
      ...m,
      scheduled_at: new Date(slots.get(m.match_id).starts_at).toISOString(),
      court: slots.get(m.match_id).court || m.court,
    } : m))
    return slots.size
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
  // Procurar marcadores (Trello #518): só id, nome e foto.
  search_people_basic: () => [
    { id: 'u-marta', name: 'Marta Costa', avatar_url: null },
    { id: 'u-tiago', name: 'Tiago Ferreira', avatar_url: null },
  ],
  // Desfazer falta (Trello #491): o jogo volta a estar por jogar.
  undo_walkover: (params) => {
    if (!MATCHES) resetMatches()
    MATCHES = MATCHES.map((m) => (m.match_id === params?.p_match_id
      ? { ...m, status: 'marcado', score_a: null, score_b: null } : m))
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

// ── Fechar categorias (Trello #485) ──────────────────────────────────────
// localStorage.mockTClose = 'true' (com mockTournament e
// mockTournamentState = 'a_decorrer'): as 7 categorias do Smash, uma em
// cada ponto — já fechada, com jogos por jogar, pronta com final, pronta só
// com um grupo, pronta com dois grupos e sem final (quem organiza escolhe),
// com a final por jogar, e sem sorteio. Ganha aos dados do sorteio (Dev 3)
// só enquanto estiver ligado.
const closeOn = () => localStorage.getItem('mockTClose') === 'true'
const closedNow = new Set()

const CLOSE_CATS = [
  { id: 'cc-m3', code: 'M3', name: 'Masculinos 3', status: 'terminada', position: 1 },
  { id: 'cc-m4', code: 'M4', name: 'Masculinos 4', status: 'a_decorrer', position: 2 },
  { id: 'cc-m5', code: 'M5', name: 'Masculinos 5', status: 'a_decorrer', position: 3 },
  { id: 'cc-f4', code: 'F4', name: 'Femininos 4', status: 'a_decorrer', position: 4 },
  { id: 'cc-f3', code: 'F3', name: 'Femininos 3', status: 'a_decorrer', position: 5 },
  { id: 'cc-mx4', code: 'MX4', name: 'Mistos 4', status: 'sorteada', position: 6 },
  { id: 'cc-f5', code: 'F5', name: 'Femininos 5', status: 'fechada', position: 7 },
  // #484: dois grupos acabados e o quadro por preencher; e um já preenchido.
  { id: 'cc-mx5', code: 'MX5', name: 'Mistos 5', status: 'a_decorrer', position: 8, format: { qualifiers_per_group: 2 } },
  { id: 'cc-m6', code: 'M6', name: 'Masculinos 6', status: 'a_decorrer', position: 9, format: { qualifiers_per_group: 2 } },
]
const bracketFilled = new Set(['cc-m6'])
const twoGroupsDone = (c) => [
  cm(c, 1, { entry_a_id: e(c, 1), entry_b_id: e(c, 2), winner_entry_id: e(c, 1) }),
  cm(c, 2, { entry_a_id: e(c, 1), entry_b_id: e(c, 3), winner_entry_id: e(c, 1) }),
  cm(c, 3, { entry_a_id: e(c, 2), entry_b_id: e(c, 3), winner_entry_id: e(c, 2) }),
  cm(c, 4, { group_id: `${c}-g2`, entry_a_id: e(c, 4), entry_b_id: e(c, 5), winner_entry_id: e(c, 4) }),
  cm(c, 5, { group_id: `${c}-g2`, entry_a_id: e(c, 4), entry_b_id: e(c, 6), winner_entry_id: e(c, 4) }),
  cm(c, 6, { group_id: `${c}-g2`, entry_a_id: e(c, 5), entry_b_id: e(c, 6), winner_entry_id: e(c, 5) }),
]
const semis = (c) => {
  const f = bracketFilled.has(c)
  const open = { status: 'marcado', score_a: null, score_b: null, winner_entry_id: null, group_id: null, stage: 'principal', round: 'SF' }
  return [
    cm(c, 7, { ...open, bracket_slot: 1, source_a: '1.º do Grupo A', source_b: '2.º do Grupo B', entry_a_id: f ? e(c, 1) : null, entry_b_id: f ? e(c, 5) : null }),
    cm(c, 8, { ...open, bracket_slot: 2, source_a: '1.º do Grupo B', source_b: '2.º do Grupo A', entry_a_id: f ? e(c, 4) : null, entry_b_id: f ? e(c, 2) : null }),
    cm(c, 9, { ...open, round: 'F', bracket_slot: 1, source_a: 'Vencedor da 1.ª meia', source_b: 'Vencedor da 2.ª meia', entry_a_id: null, entry_b_id: null }),
  ]
}
const PAIRS = ['Barros / Antunes', 'Lima / Reis', 'Costa / Pinto', 'Santos / Santos', 'Mendes / Silva', 'Rosa / Pinto']
const closeEntries = (cat) => PAIRS.map((name, i) => ({
  id: `${cat}-e${i + 1}`, category_id: cat, team_name: name, status: 'selecionada', seed_number: null,
}))
const cm = (cat, n, over) => ({
  id: `${cat}-m${n}`, category_id: cat, stage: 'grupo', group_id: `${cat}-g1`, round: null, bracket_slot: null,
  entry_a_id: `${cat}-e1`, entry_b_id: `${cat}-e2`, status: 'terminado', score_a: 9, score_b: 5,
  winner_entry_id: `${cat}-e1`, scheduled_at: null, court_name: null, ...over,
})
const e = (cat, i) => `${cat}-e${i}`
const CLOSE_MATCHES = {
  // 3 jogos de grupo ainda por jogar
  'cc-m4': (c) => [
    cm(c, 1),
    cm(c, 2, { entry_a_id: e(c, 3), entry_b_id: e(c, 4), status: 'marcado', score_a: null, score_b: null, winner_entry_id: null }),
    cm(c, 3, { entry_a_id: e(c, 1), entry_b_id: e(c, 3), status: 'a_decorrer', score_a: null, score_b: null, winner_entry_id: null }),
    cm(c, 4, { entry_a_id: e(c, 2), entry_b_id: e(c, 4), status: 'marcado', score_a: null, score_b: null, winner_entry_id: null }),
  ],
  // com quadro: final e jogo de 3.º jogados
  'cc-m5': (c) => [
    cm(c, 1),
    cm(c, 2, { stage: 'principal', group_id: null, round: 'F', bracket_slot: 1, entry_a_id: e(c, 1), entry_b_id: e(c, 2), winner_entry_id: e(c, 1) }),
    cm(c, 3, { stage: '3lugar', group_id: null, entry_a_id: e(c, 3), entry_b_id: e(c, 4), winner_entry_id: e(c, 3) }),
  ],
  // só um grupo de 4, tudo jogado
  'cc-f4': (c) => [
    cm(c, 1, { entry_a_id: e(c, 1), entry_b_id: e(c, 2), score_a: 9, score_b: 4, winner_entry_id: e(c, 1) }),
    cm(c, 2, { entry_a_id: e(c, 3), entry_b_id: e(c, 4), score_a: 9, score_b: 7, winner_entry_id: e(c, 3) }),
    cm(c, 3, { entry_a_id: e(c, 1), entry_b_id: e(c, 3), score_a: 9, score_b: 8, winner_entry_id: e(c, 1) }),
    cm(c, 4, { entry_a_id: e(c, 2), entry_b_id: e(c, 4), score_a: 9, score_b: 6, winner_entry_id: e(c, 2) }),
    cm(c, 5, { entry_a_id: e(c, 1), entry_b_id: e(c, 4), score_a: 9, score_b: 2, winner_entry_id: e(c, 1) }),
    cm(c, 6, { entry_a_id: e(c, 2), entry_b_id: e(c, 3), score_a: 5, score_b: 9, winner_entry_id: e(c, 3) }),
  ],
  // dois grupos, sem quadro
  'cc-f3': (c) => [
    cm(c, 1),
    cm(c, 2, { group_id: `${c}-g2`, entry_a_id: e(c, 3), entry_b_id: e(c, 4), winner_entry_id: e(c, 3) }),
  ],
  'cc-mx5': (c) => [...twoGroupsDone(c), ...semis(c)],
  'cc-m6': (c) => [...twoGroupsDone(c), ...semis(c)],
  // a final tem uma dupla e espera pela outra
  'cc-mx4': (c) => [
    cm(c, 1),
    cm(c, 2, { stage: 'principal', group_id: null, round: 'F', bracket_slot: 1, entry_a_id: e(c, 1), entry_b_id: null, status: 'marcado', score_a: null, score_b: null, winner_entry_id: null }),
  ],
}
const CLOSE_GROUPS = {
  'cc-m4': [[1, 2, 3, 4]],
  'cc-m5': [[1, 2, 3, 4]],
  'cc-f4': [[1, 2, 3, 4]],
  'cc-f3': [[1, 2], [3, 4]],
  'cc-mx4': [[1, 2, 3]],
  'cc-mx5': [[1, 2, 3], [4, 5, 6]],
  'cc-m6': [[1, 2, 3], [4, 5, 6]],
}
const catOf = (url) => decodeURIComponent(url).match(/category_id=eq\.([a-z0-9-]+)/)?.[1]

export const TOURNAMENT_CLOSE_RPC_MOCKS = {
  list_tournament_categories_admin: () => (closeOn() ? {
    rules: {}, days: [],
    categories: CLOSE_CATS.map((c) => (closedNow.has(c.id) ? { ...c, status: 'terminada' } : c)),
  } : undefined),
  fill_bracket_from_groups: (params) => {
    if (!closeOn()) return undefined
    bracketFilled.add(params?.p_category_id)
    return { filled: (params?.p_qualified || []).length }
  },
  clear_bracket_from_groups: (params) => {
    if (!closeOn()) return undefined
    bracketFilled.delete(params?.p_category_id)
    return { cleared: true }
  },
  finish_category: (params) => {
    if (!closeOn()) return undefined
    closedNow.add(params?.p_category_id)
    return { champion: null, from_bracket: true, players_rated: 8 }
  },
}
export const TOURNAMENT_CLOSE_TABLE_MOCKS = {
  tournament_public_groups: (url) => {
    if (!closeOn()) return undefined
    const c = catOf(url)
    return (CLOSE_GROUPS[c] || []).flatMap((teams, gi) => teams.map((n, pi) => ({
      id: `${c}-g${gi + 1}`, category_id: c, number: gi + 1, name: `Grupo ${'AB'[gi]}`, entry_id: e(c, n), position: pi + 1,
    })))
  },
  tournament_public_entries: (url) => (closeOn() ? closeEntries(catOf(url)) : undefined),
  tournament_public_matches: (url) => {
    if (!closeOn()) return undefined
    const c = catOf(url)
    return CLOSE_MATCHES[c] ? CLOSE_MATCHES[c](c) : []
  },
}

// ── Marcar resultados na Home, no dia (Trello #505) ─────────────────────
// localStorage.mockTScoreToday = 'true': sou marcador de um torneio que se
// joga hoje (e de outro que só é amanhã, que NÃO pode aparecer). Ganha aos
// outros mocks das mesmas tabelas só enquanto estiver ligado.
const scoreTodayOn = () => localStorage.getItem('mockTScoreToday') === 'true'
const lisbonDay = (n) => {
  const d = new Date(Date.now() + n * 86400000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
export const TOURNAMENT_SCORE_TODAY_TABLE_MOCKS = {
  tournament_scorekeepers: () => (scoreTodayOn()
    ? [{ tournament_id: 'tour-hoje' }, { tournament_id: 'tour-amanha' }] : undefined),
  tournament_public: (url) => {
    if (!scoreTodayOn() || !/status=in\./.test(decodeURIComponent(url))) return undefined
    return [
      { id: 'tour-hoje', slug: 'smash-open-2026', name: 'Smash Open 2026', club_name: 'Smash Padel',
        starts_on: lisbonDay(-1), ends_on: lisbonDay(1), status: 'a_decorrer' },
      { id: 'tour-amanha', slug: 'torneio-de-amanha', name: 'Torneio de amanhã', club_name: 'Smash Padel',
        starts_on: lisbonDay(1), ends_on: lisbonDay(2), status: 'sorteado' },
    ]
  },
}

// ── Reabrir inscrições de uma categoria (Trello #517) ───────────────────
// Funciona com os dados do sorteio (mockTDraw). Reabrir põe a categoria em
// «inscrições» até recarregar a página. localStorage.mockTReopenLate =
// 'true' faz o servidor responder que o prazo do torneio já passou.
const reopened = new Set()
export const TOURNAMENT_REOPEN_RPC_MOCKS = {
  reopen_category_entries: (params) => {
    reopened.add(params?.p_category_id)
    return { chosen_back: 16, waitlist_back: 0, deadline_passed: localStorage.getItem('mockTReopenLate') === 'true' }
  },
  list_tournament_categories_admin: (params, before) => {
    if (!reopened.size || !before) return undefined
    const data = before(params)
    return { ...data, categories: (data?.categories || []).map((c) => (reopened.has(c.id) ? { ...c, status: 'inscricoes' } : c)) }
  },
}

// ── Grupos acabados (Trello #513) ───────────────────────────────────────
// localStorage.mockTGroupsDone = 'true' (com mockTDraw): o jogo que estava
// a decorrer no Grupo A do sorteio de teste acaba, para se ver a tabela
// com os apurados marcados.
export const TOURNAMENT_GROUPS_DONE_TABLE_MOCKS = {
  tournament_public_matches: (url, before) => {
    if (localStorage.getItem('mockTGroupsDone') !== 'true' || !before) return undefined
    return (before(url) || []).map((m) => (m.stage === 'grupo' && m.status === 'a_decorrer'
      ? { ...m, status: 'terminado', score_a: 9, score_b: 7, winner_entry_id: m.entry_a_id } : m))
  },
}

// ── Suplente que sobe para dentro (Trello #548) ─────────────────────────
// localStorage.mockTPromoted = 'true': dois avisos no sino — um já dentro,
// outro à espera que o parceiro aceite.
const promotedRead = new Set()
export const TOURNAMENT_PROMOTED_RPC_MOCKS = {
  mark_notifications_read: (params) => {
    if (localStorage.getItem('mockTPromoted') !== 'true') return undefined
    for (const id of params?.p_ids || []) promotedRead.add(id)
    return null
  },
}
export const TOURNAMENT_PROMOTED_TABLE_MOCKS = {
  notifications: (url, before) => {
    if (localStorage.getItem('mockTPromoted') !== 'true') return undefined
    const respondBy = new Date(Date.now() + 3 * 86400000).toISOString()
    const base = { tournament_id: 'tour-smash-open', tournament_slug: 'smash-open-2026', tournament_name: 'Smash Open 2026' }
    return [
      { id: 'tp1', kind: 'tournament_promoted', game_id: null, created_at: new Date().toISOString(),
        data: { ...base, entry_id: 'e-1', status: 'validada', category_id: 'cat-m4', category_code: 'M4', category_name: 'Masculinos 4', partner_name: 'Rui Mendes', partner_pending: false } },
      { id: 'tp2', kind: 'tournament_promoted', game_id: null, created_at: new Date().toISOString(),
        data: { ...base, entry_id: 'e-2', status: 'convite', category_id: 'cat-mx4', category_code: 'MX4', category_name: 'Mistos 4', partner_name: 'Ana Costa', partner_pending: true, respond_by: respondBy } },
      ...((before && before(url)) || []),
    ].filter((n) => !promotedRead.has(n.id))
  },
}
