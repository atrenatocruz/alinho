// «A decorrer agora» (design-handoff/2026-09-27-a-decorrer-agora, aprovado
// pelo Francisco a 27 set). Na Home, no topo de hoje: «● A DECORRER AGORA · N»
// e cartões pequenos que deslizam para o lado; na página do clube ou grupo,
// «● A DECORRER AGORA NO CLUBE» e o mesmo cartão a toda a largura. Sem nada a
// decorrer, a faixa não aparece. Um cartão para todos os tipos, na cor do
// tipo: etiqueta, nome, clube e jogadores, e quem vai à frente (no torneio,
// o último resultado — liveTournamentCard, Dev 1). Os dados vêm do
// list_live_events (Dev 3), que já esconde quem esconde os resultados.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { KIND_STYLE } from '../agenda/EventCard'
import { listLiveEvents } from '../../lib/liveEvents'
import { liveTournamentCard } from '../tournament/liveTournament'

function cardFields(row, t, wide) {
  if (row.kind === 'tournament') return { ...liveTournamentCard(row, t), kind: 'tournament' }
  const lead = row.leader?.label || ''
  const wins = wide && row.leader?.wins != null ? ` · ${t('live.wins', { count: Number(row.leader.wins) })}` : ''
  if (row.kind === 'friends') {
    return {
      kind: 'friends',
      tag: t('live.friends_tag', { n: row.game_number, total: row.games_total }),
      // «Renato Cruz e amigos»: a etiqueta já diz que é um jogo entre amigos.
      title: row.title || (row.creator_name ? t('live.friends_title', { name: row.creator_name }) : t('createprivatematch.title')),
      meta: [wide ? null : row.org_name, t('live.players', { count: Number(row.players_count) || 0 })].filter(Boolean).join(' · '),
      leadLabel: lead ? t('live.ahead') : '',
      lead: lead ? `${lead}${wins}` : '',
      to: `/jogos-privados/sessao/${row.id}`,
    }
  }
  return {
    kind: 'mix',
    tag: t('live.mix_tag', { n: row.round_number, total: row.rounds_total }),
    title: row.title,
    meta: [wide ? null : row.org_name, t('live.players', { count: Number(row.players_count) || 0 }), wide && row.courts ? t('live.courts', { count: Number(row.courts) }) : null].filter(Boolean).join(' · '),
    leadLabel: lead ? t('live.ahead') : '',
    lead: lead ? `${lead}${wins}` : '',
    to: `/jogo/${row.id}`,
  }
}

function LiveCard({ c, wide }) {
  const style = KIND_STYLE[c.kind] || KIND_STYLE.mix
  return (
    <Link to={c.to} className={`press block rounded-card border p-3.5 ${style.card} ${wide ? 'w-full' : 'w-[78%] max-w-[300px] shrink-0 snap-start'}`}>
      <span className={`inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-1 text-[11px] font-extrabold ${style.text}`}>
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-danger" /> {c.tag}
      </span>
      <p className="mt-2 truncate text-base font-extrabold text-ink-900">{c.title}</p>
      {c.meta && <p className="truncate text-[13px] text-ink-700">{c.meta}</p>}
      {c.lead && (
        <p className="mt-2 truncate border-t border-ink-900/10 pt-2 text-[13px] text-ink-700">
          {c.leadLabel} <b className="text-ink-900">{c.lead}</b>
        </p>
      )}
    </Link>
  )
}

/** `organizationId`: a página do clube/grupo (cartões a toda a largura);
 *  sem ele, a Home (os meus clubes e grupos, a deslizar). `onCount` diz à Home
 *  quantos há, para abrir em Hoje. */
export default function LiveStrip({ organizationId = null, orgKind = 'club', onCount }) {
  const { t } = useTranslation()
  const [rows, setRows] = useState([])
  useEffect(() => {
    let alive = true
    listLiveEvents(organizationId)
      .then((r) => { if (alive) { setRows(r); onCount?.(r.length) } })
      .catch((err) => console.error('Error loading live events:', err))
    return () => { alive = false }
  }, [organizationId]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows.length) return null
  const wide = !!organizationId
  const cards = rows.map((r) => cardFields(r, t, wide))
  return (
    <section aria-label={t('live.title')}>
      <p className="mb-2 flex items-center gap-1.5 font-mono text-[11px] font-extrabold uppercase tracking-widest text-ink-900">
        <span aria-hidden className="h-2 w-2 rounded-full bg-danger" />
        {wide ? t(orgKind === 'group' ? 'live.title_group' : 'live.title_club') : `${t('live.title')} · ${rows.length}`}
      </p>
      {wide ? (
        <div className="space-y-2.5">{cards.map((c, i) => <LiveCard key={i} c={c} wide />)}</div>
      ) : (
        <div className="-mx-4 flex snap-x gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {cards.map((c, i) => <LiveCard key={i} c={c} />)}
        </div>
      )}
    </section>
  )
}
