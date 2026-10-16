// A liga na Home (Renato, 16 out: sem separador próprio — aparece entre os
// jogos). Cada encontro em que estou escalado ou falo pela equipa é um cartão
// no seu dia; sem data, fica no último dia da jornada. «Para ti» junta os
// resultados por confirmar e as ligas abertas para os clubes que administro.
import { toDayKey } from './agenda'
import { myLeagueAgenda } from './leagueApi'
import { KIND_COLORS } from './kindColors'

export function eventFromLeagueEncounter(row) {
  const startsAt = row.scheduled_at ? new Date(row.scheduled_at) : new Date(`${row.window_end}T12:00:00`)
  return {
    key: `league:${row.id}`,
    source: 'league_encounter',
    kind: 'league',
    id: row.id,
    slug: row.league_slug,
    startsAt,
    hasTime: !!row.scheduled_at,
    dayKey: row.scheduled_at ? toDayKey(startsAt) : row.window_end,
    mine: true,
    needsMyAnswer: !!row.needs_my_answer,
    finished: row.status === 'oficial',
    raw: row,
  }
}

export function leagueForYouItems(agenda, t, lang = 'pt-PT') {
  const items = []
  for (const e of agenda?.encounters || []) {
    if (!e.needs_my_answer) continue
    const day = e.scheduled_at ? new Date(e.scheduled_at) : new Date(`${e.window_end}T12:00:00`)
    items.push({
      key: `league-confirm:${e.id}`, icon: '✓', bg: KIND_COLORS.league.light,
      title: t('league.foryou_confirm', { when: day.toLocaleDateString(lang, { weekday: 'long' }) }),
      sub: `${e.home_name} vs ${e.away_name} · ${e.league_name}`,
      to: `/liga/${e.league_slug}/encontro/${e.id}`, cta: t('league.confirm_result'),
    })
  }
  for (const l of agenda?.open_leagues || []) {
    items.push({
      key: `league-open:${l.slug}`, icon: '🏆', bg: KIND_COLORS.league.light,
      title: t('league.foryou_open', { name: l.name }), sub: l.my_club_name,
      to: `/liga/${l.slug}`, cta: t('league.apply'),
    })
  }
  return items
}

/** Para a Home: os eventos e os «Para ti» da liga. Sem as migrações, vazio. */
export async function loadLeagueHome() {
  try {
    const agenda = await myLeagueAgenda()
    return { events: (agenda?.encounters || []).map(eventFromLeagueEncounter), agenda }
  } catch (error) {
    if (error?.code !== 'PGRST202' && error?.code !== '42883') console.error('Error loading league agenda:', error)
    return { events: [], agenda: null }
  }
}
