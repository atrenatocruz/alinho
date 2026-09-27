// «A decorrer agora» — o cartão do torneio (design-handoff/2026-09-27-a-decorrer-agora,
// aprovado pelo Francisco a 27 set). O cartão e a faixa são do Dev 2, iguais
// para todos os tipos; aqui só se escrevem os textos do torneio e para onde o
// toque leva: o quadro, na fase que está a decorrer.
//
// A linha vem do list_live_events (Dev 3), kind 'tournament':
//   { slug, tournament_id, name, org_name, category_code, stage ('groups' |
//     'knockout'), round ('R32'…'F' | null), matches_live,
//     last_result: { a_name, b_name, a_hidden, b_hidden,
//                    score ('6-4 · 3-6 · 10-7', do lado A), a_won } | null }
// Quem esconde os resultados nunca chega aqui pelo nome: escreve-se «Dupla
// M4», como nos cartões de partilha do torneio.

const ROUNDS = ['R32', 'R16', 'QF', 'SF', 'F', '3P']

/** «6-4 3-6» do lado de quem ganhou, com o traço da app («6–4 6–3»). */
export function winnerScore(score, aWon) {
  if (!score) return ''
  return String(score).trim().split(/\s+/).map((set) => {
    const [a, b] = set.split(/[-–]/)
    if (b === undefined) return set
    return aWon ? `${a}–${b}` : `${b}–${a}`
  }).join(' ')
}

function side(r, key, t, code) {
  if (r[`${key}_hidden`] || !r[`${key}_name`]) return t('livetour.hidden_pair', { n: r[`${key}_number`] ?? code ?? '' }).trim()
  return r[`${key}_name`]
}

/** «Serra / Mota 6–4»: quem ganhou o último jogo acabado, e o resultado. */
export function lastResultText(r, t, code) {
  if (!r) return ''
  const winner = r.a_won ? 'a' : 'b'
  return [side(r, winner, t, code), winnerScore(r.score, r.a_won)].filter(Boolean).join(' ')
}

/** Para onde leva o toque: «Todos os jogos», na secção da fase. */
export function liveTournamentLink(row) {
  const params = new URLSearchParams()
  if (row.category_code) params.set('cat', row.category_code)
  params.set('tab', 'all_games')
  params.set('sec', row.stage === 'groups' ? 'groups' : 'draw')
  return `/torneio/${row.slug || row.tournament_id}?${params}`
}

/** Os campos do cartão do Dev 2: { tag, title, meta, leadLabel, lead, to }. */
export function liveTournamentCard(row, t) {
  const phase = row.stage === 'groups' || !ROUNDS.includes(row.round)
    ? t('livetour.phase_groups')
    : t(`tournament.draw.round_${row.round}`)
  const live = Number(row.matches_live) || 0
  const lead = lastResultText(row.last_result, t, row.category_code)
  return {
    // A fase em minúsculas, como o «Mix · ronda 2 de 4».
    tag: t('livetour.tag', { phase: phase.toLocaleLowerCase() }),
    title: row.name,
    meta: [row.category_code, live > 0 ? t('livetour.matches_live', { count: live }) : row.org_name].filter(Boolean).join(' · '),
    leadLabel: lead ? t('livetour.last') : '',
    lead,
    to: liveTournamentLink(row),
  }
}
