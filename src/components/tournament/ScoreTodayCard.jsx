// «Marcar resultados» na Home, no dia do torneio (Trello #505). Antes, um
// marcador que não era admin do clube só chegava ao /marcar se alguém lhe
// mandasse o link — no dia, à beira do campo, é o primeiro sítio que abre.
//
// Aparece só no dia (hora de Portugal, como o /marcar) e só a quem pode
// marcar: marcador nomeado ou admin do clube. Mesmo texto e mesmo botão do
// cartão da página do torneio (SignupSlot, Dev 2), com o nome do torneio
// por cima — na Home podem cruzar-se dois torneios no mesmo dia.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../contexts/AuthContext'
import { listTournamentsToScoreToday } from '../../lib/tournamentApi'
import { dayKeyInTz } from '../../lib/tournamentDay'
import { errorKind } from '../../lib/errors'

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

export default function ScoreTodayCard({ rows = [] }) {
  const { t } = useTranslation()
  if (rows.length === 0) return null
  return (
    <>
      {rows.map((x) => (
        // O nome inteiro, nunca cortado, e o botão por baixo a toda a largura
        // — à beira do campo acerta-se sem mirar.
        <div key={x.id} className="card space-y-2.5">
          <div>
            <p className="font-extrabold text-ink-900">{x.name}</p>
            <p className="text-sm text-ink-700">{t('tournament.score.link_title')}</p>
          </div>
          <Link to={`/torneio/${x.slug || x.id}/marcar`}
            className="flex min-h-[48px] w-full items-center justify-center rounded-full bg-ink-900 px-4 text-sm font-bold text-white">
            {t('tournament.score.link_cta')}
          </Link>
        </div>
      ))}
    </>
  )
}
