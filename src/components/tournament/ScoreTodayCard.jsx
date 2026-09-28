// «Marcar resultados» na Home, no dia do torneio (Trello #505). Antes, um
// marcador que não era admin do clube só chegava ao /marcar se alguém lhe
// mandasse o link — no dia, à beira do campo, é o primeiro sítio que abre.
//
// Aparece só no dia (hora de Portugal, como o /marcar) e só a quem pode
// marcar: marcador nomeado ou admin do clube.
//
// Desde 28 set (o Francisco: «porque é que este cartão muda completamente
// aqui?»): é o cartão normal do torneio, na cor e com a etiqueta do torneio,
// e o botão principal é «Marcar resultados · N por marcar» (preto, como na
// página do evento), com «Estás a marcar resultados neste torneio.» por
// baixo. Quem também joga já tem o cartão do seu jogo: aí o «Marcar
// resultados» não o substitui — vem por baixo, como ligação (`asLink`).
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { listTournamentsToScoreToday, listMatchesToScore } from '../../lib/tournamentApi'
import { dayKeyInTz } from '../../lib/tournamentDay'
import { errorKind } from '../../lib/errors'
import TournamentEventCard from '../agenda/TournamentEventCard'
import { eventFromTournament } from '../../lib/agenda'

/** Os torneios que a pessoa marca hoje. Fica na Home (e não dentro do
 *  cartão) porque a Home precisa de saber que há um, para abrir em «Hoje»
 *  em vez de saltar para o próximo dia com jogos. */
export function useTournamentsToScoreToday() {
  const { user, adminOrganizations } = useAuth()
  const [rows, setRows] = useState([])
  const adminIds = (adminOrganizations || []).map((o) => o?.id).filter(Boolean).join(',')

  useEffect(() => {
    if (!user) { setRows([]); return undefined }
    let alive = true
    listTournamentsToScoreToday({ userId: user.id, adminOrgIds: adminIds ? adminIds.split(',') : [], today: dayKeyInTz() })
      .then((list) => { if (alive) setRows(list) })
      .catch((err) => {
        if (errorKind(err) !== 'not_ready') console.error('Error loading tournaments to score today:', err)
        if (alive) setRows([])
      })
    return () => { alive = false }
  }, [user, adminIds])

  return rows
}

const hasScore = (m) => m.status === 'terminado' || (m.score_a != null && m.score_b != null)

/** Quantos jogos de hoje ainda não têm resultado, por torneio. */
function usePendingCounts(rows) {
  const [counts, setCounts] = useState({})
  const ids = rows.map((x) => x.id).join(',')
  useEffect(() => {
    let alive = true
    const today = dayKeyInTz()
    Promise.all(rows.map((x) => listMatchesToScore(x.id, today)
      .then((list) => [x.id, (list || []).filter((m) => !hasScore(m)).length])
      .catch(() => [x.id, null])))
      .then((pairs) => { if (alive) setCounts(Object.fromEntries(pairs)) })
    return () => { alive = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids])
  return counts
}

export default function ScoreTodayCard({ rows = [], asLink = false }) {
  const { t } = useTranslation()
  const counts = usePendingCounts(rows)
  if (rows.length === 0) return null
  const cta = (x) => [t('tournament.score.link_cta'), counts[x.id] > 0 ? t('friends.to_mark', { count: counts[x.id] }) : null]
    .filter(Boolean).join(' · ')

  if (asLink) {
    return (
      <>
        {rows.map((x) => (
          <div key={x.id}>
            <Link to={`/torneio/${x.slug || x.id}/marcar`}
              className="press flex min-h-[48px] w-full items-center justify-between gap-2 rounded-ctrl border border-line bg-white px-4 text-sm font-extrabold text-ink-900">
              <span className="min-w-0 truncate">{cta(x)}</span>
              <ChevronRight size={16} className="shrink-0 text-ink-500" />
            </Link>
            <p className="mt-1 px-1 text-xs text-muted">{x.name} · {t('tournament.score.link_title')}</p>
          </div>
        ))}
      </>
    )
  }

  // O cartão normal do torneio, igual ao de sempre; só o fundo muda.
  return (
    <>
      {rows.map((x) => (
        <TournamentEventCard key={x.id} event={eventFromTournament(x)} footer={(
          <>
            <Link to={`/torneio/${x.slug || x.id}/marcar`}
              className="press mt-3 flex min-h-[48px] w-full items-center justify-center rounded-ctrl bg-ink-900 px-4 text-sm font-extrabold text-white">
              {cta(x)}
            </Link>
            <p className="mt-1.5 text-xs text-muted">{t('tournament.score.link_title')}</p>
          </>
        )} />
      ))}
    </>
  )
}
