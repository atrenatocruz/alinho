// A página da liga (/liga/:slug) — pública, legível sem sessão. Capa com o
// Alino da liga (EventHero kind="league"), separadores Tabela · Jornadas ·
// Clubes e a categoria por chips. Mockups 1 · «Página da liga».
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import EventHero from '../components/event/EventHero'
import { Tabs, Chips, PrimaryButton, EmptyState } from '../components/ui'
import StandingsTable from '../components/league/StandingsTable'
import EncounterRow from '../components/league/EncounterRow'
import { getLeaguePage, applyToLeague, leagueErrorMessage } from '../lib/leagueApi'
import { categoryRows, encounterState, isMine } from '../lib/leagueView'
import { categoryCode } from '../lib/tournaments'
import { toDayKey } from '../lib/agenda'

export default function LeaguePage() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [page, setPage] = useState(undefined)
  const [tab, setTab] = useState('table')
  const [catId, setCatId] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => getLeaguePage(slug).then((p) => {
    setPage(p)
    if (p) setCatId((cur) => cur || p.categories[0]?.id || null)
  }).catch(() => setPage(null))
  useEffect(() => { load() }, [slug]) // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => (page && catId ? categoryRows(page, catId) : []), [page, catId])
  if (page === undefined) return null
  if (page === null) return <EmptyState title={t('league.empty_rounds_title')} subtitle="" />

  const { league, viewer } = page
  const myTeamIds = viewer.team_ids || []
  const today = toDayKey(new Date())
  const teamsById = new Map(page.teams.map((x) => [x.id, x]))
  const cat = page.categories.find((c) => c.id === catId)
  const catRounds = page.rounds.filter((r) => r.category_id === catId)
  const myRow = rows.find((r) => myTeamIds.includes(r.teamId))
  const currentRound = catRounds.filter((r) => r.window_start <= today).pop()

  // Inscrever: um admin de clube, inscrições abertas, o clube ainda sem pedido nesta categoria.
  const applyClub = viewer.admin_clubs?.find((c) => !page.teams.some((x) => x.category_id === catId && x.organization_id === c.id))
  const canApply = league.status === 'inscricoes' && cat?.status === 'inscricoes' && applyClub

  const apply = async () => {
    setBusy(true); setError('')
    try { await applyToLeague(catId, applyClub.id); await load() } catch (e) { setError(leagueErrorMessage(t, e)) } finally { setBusy(false) }
  }

  return (
    <div className="pb-6">
      <EventHero
        kind="league"
        chip={`${t(`league.kind_${league.kind}`)} · ${t('league.categories_count', { count: page.categories.length })}`}
        org={{ name: league.owner?.name || 'alinho', kindLabel: t(`league.kind_${league.kind}`), logo: league.owner?.logo,
               onOpen: league.owner ? () => navigate(`/clube/${league.owner.slug}`) : null }}
        title={league.name}
        time={currentRound ? t('league.round', { n: currentRound.number }) : null}
        timeAside={currentRound ? t('league.round_of', { total: catRounds.length }) : null}
        dateLine={[t(`league.status_${league.status}`), cat?.home_away ? t('league.home_away') : null].filter(Boolean).join(' · ')}
        onBack={() => navigate(-1)}
        onShare={() => navigator.share?.({ title: league.name, url: window.location.href })}
        status={myRow ? { tone: 'kind', text: t('league.your_position', { pos: myRow.position, code: categoryCode(cat.gender, cat.level) }),
                          meta: t('league.clubs_count', { count: rows.length }) } : null}
        manage={viewer.can_manage ? (
          <PrimaryButton variant="ink" className="w-full" onClick={() => navigate(`/liga/${slug}/gerir`)}>{t('league.manage')}</PrimaryButton>
        ) : null}
      >
        {canApply && <PrimaryButton className="w-full" disabled={busy} onClick={apply}>{t('league.apply')}</PrimaryButton>}
        {error && <p className="text-sm font-semibold text-danger">{error}</p>}
      </EventHero>

      <div className="mt-3 space-y-3">
        <Tabs label={league.name} value={tab} onChange={setTab}
          options={[{ value: 'table', label: t('league.tab_table') }, { value: 'rounds', label: t('league.tab_rounds') }, { value: 'clubs', label: t('league.tab_clubs') }]} />
        {page.categories.length > 1 && (
          <Chips label={t('league.category_label')} value={catId} onChange={setCatId}
            options={page.categories.map((c) => ({ value: c.id, label: categoryCode(c.gender, c.level) }))} />
        )}

        {tab === 'table' && <StandingsTable rows={rows} myTeamIds={myTeamIds} />}

        {tab === 'rounds' && (catRounds.length === 0
          ? <EmptyState pose={null} title={t('league.empty_rounds_title')} subtitle={t('league.empty_rounds_text')} />
          : catRounds.map((r) => (
            <section key={r.id} className="space-y-2.5">
              <div className="flex items-baseline gap-2 px-0.5 pt-1">
                <b className="font-display text-[20px] font-black tracking-[-.02em]">{t('league.round', { n: r.number })}</b>
                <span className="font-display text-sm font-semibold text-[#5B6068]">{r.window_start} – {r.window_end}</span>
              </div>
              {page.encounters.filter((e) => e.round_id === r.id).map((e) => (
                <EncounterRow key={e.id} encounter={e} state={encounterState(e, today, r.window_end)}
                  home={teamsById.get(e.home_team_id)} away={teamsById.get(e.away_team_id)}
                  mine={isMine(e, myTeamIds)} to={`/liga/${slug}/encontro/${e.id}`} />
              ))}
            </section>
          )))}

        {tab === 'clubs' && (
          <div className="overflow-hidden rounded-card bg-white shadow-[0_1px_2px_rgba(17,17,17,.06)]">
            {page.teams.filter((x) => x.category_id === catId).map((x) => (
              <button key={x.id} type="button" onClick={() => navigate(`/liga/${slug}/equipa/${x.id}`)}
                className="flex min-h-[52px] w-full items-center justify-between gap-2 border-t border-[#EEF0F3] px-3.5 text-left first:border-t-0">
                <span className="flex items-center gap-2 font-bold">{x.name}
                  {myTeamIds.includes(x.id) && <span className="rounded-full bg-lime-400 px-1.5 py-0.5 font-display text-[10.5px] font-bold">{t('league.your_club')}</span>}
                </span>
                <span className="font-display text-[13px] font-extrabold text-ink-500">{x.status === 'aprovada' ? '' : t(`league.team_${x.status}`, x.status)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
