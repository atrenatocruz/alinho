// «Já jogados» na Home (design-handoff/2026-09-27-jogos-jogados-do-clube,
// proposta-2-filtro; aprovado pelo Francisco a 27 set, com a atualização de
// 28 set: os jogos entre amigos dos grupos também entram). Só o passado, do
// mais recente para trás, por dias; cartões cinzentos com «Terminado»; o meu
// com o contorno verde e os meus pontos. Tocar abre os resultados. Quem
// esconde os resultados continua escondido (vem já assim do servidor).
// Dados: list_played_events do Dev 3 (migration_ja_jogados.sql).
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CheckCircle2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { toDayKey } from '../../lib/agenda'
import { formatTime } from '../../lib/formatDate'
import { KindTag, OrgHeader, StateTag } from './EventCard'
import { dayLabel } from './AgendaControls'

const PAGE = 20
const KIND = { mix: 'mix', tournament: 'tournament', friends: 'friends' }
// Num clube, a sessão entre amigos é «Jogo em aberto» (Francisco, 28 set).
const kindOf = (r) => (r.kind === 'friends' && r.org_kind !== 'group' ? 'open' : KIND[r.kind])

async function listPlayed(orgId, before) {
  const { data, error } = await supabase.rpc('list_played_events', { p_organization_id: orgId, p_before: before, p_limit: PAGE })
  if (error) throw error
  return data || { rows: [], total: 0 }
}

export default function PlayedList({ orgIds = null, kinds }) {
  const { t, i18n } = useTranslation()
  const [rows, setRows] = useState(null)
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  // Um clube escolhido: pede-se só esse. Vários: pedem-se todos e filtra-se aqui.
  const oneOrg = orgIds?.length === 1 ? orgIds[0] : null

  const load = async (before = null) => {
    setBusy(true)
    try {
      const res = await listPlayed(oneOrg, before)
      const got = res.rows || []
      setRows((cur) => (before ? [...(cur || []), ...got] : got))
      setMore(got.length === PAGE)
      setError(false)
    } catch (err) {
      console.error('Error loading played events:', err)
      setError(true)
      if (!before) setRows([])
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => { setRows(null); load() }, [oneOrg]) // eslint-disable-line react-hooks/exhaustive-deps

  if (rows === null) {
    return <div className="flex justify-center py-10"><div className="h-8 w-8 animate-spin rounded-full border-[3px] border-ink-50 border-t-ink-700" /></div>
  }
  const shown = rows.filter((r) => kinds.includes(kindOf(r)) && (!orgIds || orgIds.includes(r.organization_id)))
  const days = []
  for (const r of shown) {
    const key = toDayKey(new Date(r.date))
    const last = days[days.length - 1]
    if (last && last.key === key) last.rows.push(r)
    else days.push({ key, rows: [r] })
  }

  return (
    <div className="mt-3 space-y-5">
      {shown.length === 0 && (
        <p className="rounded-card border border-dashed border-line px-3 py-3 text-sm text-muted">
          {error ? t('agenda.played_error') : t('agenda.played_empty')}
        </p>
      )}
      {days.map((d) => (
        <section key={d.key} className="space-y-2.5">
          <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted">{dayLabel(d.key, t, i18n.language)}</p>
          {d.rows.map((r) => <PlayedCard key={`${r.kind}-${r.id}`} row={r} />)}
        </section>
      ))}
      {more && (
        <button type="button" disabled={busy} onClick={() => load(rows[rows.length - 1]?.date)}
          className="w-full min-h-[48px] rounded-ctrl border border-line bg-white text-sm font-extrabold text-ink-900 disabled:opacity-40">
          {t('agenda.played_more')}
        </button>
      )}
      <div className="h-[40vh]" aria-hidden="true" />
    </div>
  )
}

function PlayedCard({ row }) {
  const { t, i18n } = useTranslation()
  const kind = kindOf(row)
  const to = row.kind === 'mix' ? `/jogo/${row.id}`
    : row.kind === 'tournament' ? `/torneio/${row.slug || row.id}`
    : `/jogos-privados/sessao/${row.id}`
  const title = row.kind === 'friends' && kind === 'open' ? t('agenda.played_open_title')
    : row.kind === 'friends'
    ? (row.creator_name ? t('agenda.played_friends_title', { name: row.creator_name.split(' ')[0] }) : t('agenda.played_friends_title_anon'))
    : row.title
  const people = row.kind === 'tournament'
    ? (row.entries_count != null ? t('agenda.played_teams', { count: Number(row.entries_count) }) : null)
    : row.players_count != null ? t(row.kind === 'mix' ? 'agenda.played_players' : 'agenda.played_people', { count: Number(row.players_count) }) : null
  const points = row.i_played && row.my_points != null ? Number(row.my_points) : null
  const event = { orgName: row.org_name, orgKind: row.org_kind, orgLogo: row.org_logo, orgId: row.organization_id }
  const state = <StateTag tone="grey" icon={CheckCircle2}>{t('agenda.state_finished')}</StateTag>
  return (
    <div className={`relative overflow-hidden rounded-card bg-surface p-3.5 press ${row.i_played ? 'border-2 border-ok' : 'border border-line'}`}>
      <Link to={to} className="absolute inset-0" aria-label={title || ''} />
      {/* O estado ao canto, à direita de quem organiza (como nos outros cartões da Home). */}
      <OrgHeader event={event} past right={state} />
      <div className="flex items-start justify-between gap-2">
        <KindTag kind={kind} past />
        {!event.orgName && state}
      </div>
      {row.kind !== 'tournament' && (
        <p className="mt-2.5 text-[22px] font-extrabold leading-none text-muted">{formatTime(row.date, i18n.language, { hour: '2-digit', minute: '2-digit' })}</p>
      )}
      <h3 className="mt-1.5 text-base leading-snug text-muted">{title}</h3>
      {(people || points != null) && (
        <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-ink-900/10 pt-2.5 text-[13px]">
          <span className="text-ink-700">{people}</span>
          {points != null && (
            <b className="font-extrabold text-ink-900">{t('agenda.played_points', { points: `${points > 0 ? '+' : ''}${Math.round(points)}` })}</b>
          )}
        </div>
      )}
    </div>
  )
}
