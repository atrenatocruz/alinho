/* As contas da página de marcar do torneio (/torneio/:id/marcar).

   Dev 2, 24 set 2026 — o plano aprovado pelo Francisco depois do teste do
   Renato, em que um organizador não conseguia fazer o dia do torneio pela
   app. Tudo puro, para se testar sem base de dados. */

import { byCourt } from './tournamentScore'
import { scheduleMatches } from './tournamentSchedule'

const FINISHED = ['terminado', 'falta', 'desistencia']
const hasBothPairs = (m) => !!(m?.team_a && m?.team_b)

/** Um cartão por campo: o jogo que está a decorrer, ou então o próximo que
    já tem as duas duplas.

    Até aqui o cartão para meter o resultado só aparecia com o jogo
    «a_decorrer» — e nada, nem na app nem na base de dados, põe um jogo
    nesse estado. A `save_match_result` aceita o resultado de um jogo
    «marcado» (verificado na função viva), por isso não é preciso um passo
    de «começar jogo»: o marcador escreve o resultado quando o jogo acaba.
    Um jogo do quadro ainda sem duplas («1.º do Grupo A») não tem cartão —
    fica na lista do que vem a seguir. */
export function cardsByCourt(matches = []) {
  return byCourt(matches).map((c) => {
    const card = c.live || c.next.find(hasBothPairs) || null
    return { court: c.court, card, rest: c.next.filter((m) => m !== card) }
  })
}

/** Jogos por jogar que ainda não têm hora — os que o sorteio cria. */
export const unscheduledMatches = (matches = []) =>
  matches.filter((m) => !m.scheduled_at && !FINISHED.includes(m.status))

/** Nomes dos campos para as horas. Vazio quando o torneio não os tem
    registados — e sem eles não há onde pôr os jogos. */
export const courtNames = (courts = []) => (courts || []).map((c) => c?.name).filter(Boolean)

/** Propõe as horas dos jogos sem hora, com o cálculo do horário do torneio
    (`scheduleMatches`, do Dev 3 — ninguém em dois jogos à mesma hora, no
    máximo dois seguidos, fases pela ordem). Devolve o que se manda à
    `save_match_schedule` e o que não coube.

    `days` vem da página do torneio: { date, starts_at: 'HH:MM:SS',
    ends_at, courts: N }. `categories`: [{ id, day_date, start_time }], da
    mesma página — sem elas a proposta não respeita o dia de cada categoria. As horas de abertura são horas do dia, não
    instantes — por isso aqui corta-se, e está certo. */
export function proposeSchedule({ matches = [], days = [], courts = [], categories = [], durationMaxMin } = {}) {
  const names = courtNames(courts)
  if (!names.length) return { slots: [], preview: [], left: matches, noCourts: true }

  const dayInput = days.map((d) => ({
    date: d.date,
    start: String(d.starts_at || '').slice(0, 5),
    end: String(d.ends_at || '').slice(0, 5),
    courts: names.slice(0, Number(d.courts) > 0 ? Number(d.courts) : names.length),
  }))

  // O dia e a hora de cada categoria («domingo, a partir das 9h»): uma
  // categoria de domingo não vai para sexta (Trello #502).
  const catById = new Map((categories || []).map((c) => [c.id, c]))
  const input = matches.map((m) => ({
    id: m.match_id,
    categoryId: m.category_id,
    stage: m.stage,
    // A ronda da eliminatória (SF, F, 3P) — é ela que dá a ordem das fases,
    // não o `stage`, que é 'principal' em todas (Trello #502).
    round: m.round_label ?? m.round ?? null,
    day: catById.get(m.category_id)?.day_date || null,
    notBefore: String(catById.get(m.category_id)?.start_time || '').slice(0, 5) || null,
    groupId: m.group_label || null,
    // O mesmo nome em duas categorias é a mesma pessoa: é o que impede
    // que jogue em dois campos à mesma hora.
    players: [...(m.team_a?.players || []), ...(m.team_b?.players || [])].filter(Boolean),
    source: m,
  }))

  const { scheduled, unscheduled } = scheduleMatches(input, dayInput, durationMaxMin ? { durationMaxMin } : {})
  return {
    slots: scheduled.map((s) => ({ match_id: s.id, court: s.court, starts_at: s.startsAt.toISOString() })),
    preview: scheduled.map((s) => ({ ...s.source, court: s.court, scheduled_at: s.startsAt.toISOString() })),
    left: unscheduled.map((u) => u.source),
    noCourts: false,
  }
}
