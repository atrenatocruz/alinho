// «A decorrer agora» (design-handoff/2026-09-27-a-decorrer-agora, aprovado
// pelo Francisco a 27 set). Na Home, no topo de hoje: «● A DECORRER AGORA · N»
// e cartões pequenos que deslizam para o lado; na página do clube ou grupo,
// «● A DECORRER AGORA NO CLUBE» e o mesmo cartão a toda a largura. Sem nada a
// decorrer, a faixa não aparece. Um cartão para todos os tipos, na cor do
// tipo: etiqueta, nome, clube e jogadores, e quem vai à frente (no torneio,
// o último resultado — liveTournamentCard, Dev 1). Os dados vêm do
// list_live_events (Dev 3), que já esconde quem esconde os resultados.
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
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

/* No computador a faixa arrasta-se com o rato e tem setas (Francisco, 30 set:
   «não consigo mexer nisto com o rato»). No telemóvel continua a deslizar
   com o dedo, como estava. Um arrasto não abre o cartão; um toque abre.
   No computador o 1.º cartão alinha com a coluna e só a ponta direita
   desliza e esbate (UX, 30 set). */
function useMouseDrag() {
  const ref = useRef(null)
  const drag = useRef(null)
  const onPointerDown = (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return
    drag.current = { x: e.clientX, left: ref.current.scrollLeft, moved: false }
  }
  const onPointerMove = (e) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    if (Math.abs(dx) > 5) d.moved = true
    if (d.moved) ref.current.scrollLeft = d.left - dx
  }
  const end = () => { setTimeout(() => { drag.current = null }, 0) }
  // Depois de arrastar, o clique que o rato solta não abre o cartão.
  const onClickCapture = (e) => { if (drag.current?.moved) { e.preventDefault(); e.stopPropagation() } }
  const by = (dir) => {
    const el = ref.current
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' })
  }
  return { ref, by, handlers: { onPointerDown, onPointerMove, onPointerUp: end, onPointerLeave: end, onClickCapture, onDragStart: (e) => e.preventDefault() } }
}

/** `organizationId`: a página do clube/grupo (cartões a toda a largura);
 *  sem ele, a Home (os meus clubes e grupos, a deslizar). `onCount` diz à Home
 *  quantos há, para abrir em Hoje. */
export default function LiveStrip({ organizationId = null, orgKind = 'club', onCount }) {
  const { t } = useTranslation()
  const [rows, setRows] = useState([])
  const strip = useMouseDrag()
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
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-mono text-[11px] font-extrabold uppercase tracking-widest text-ink-900">
          <span aria-hidden className="h-2 w-2 rounded-full bg-danger" />
          {wide ? t(orgKind === 'group' ? 'live.title_group' : 'live.title_club') : `${t('live.title')} · ${rows.length}`}
        </p>
        {!wide && rows.length > 1 && (
          <span className="hidden gap-1.5 md:flex">
            {[[-1, ChevronLeft, 'live.prev'], [1, ChevronRight, 'live.next']].map(([dir, Icon, key]) => (
              <button key={key} type="button" onClick={() => strip.by(dir)} aria-label={t(key)}
                className="press flex h-8 w-8 items-center justify-center rounded-full border border-line bg-white text-ink-900">
                <Icon size={16} />
              </button>
            ))}
          </span>
        )}
      </div>
      {wide ? (
        <div className="space-y-2.5">{cards.map((c, i) => <LiveCard key={i} c={c} wide />)}</div>
      ) : (
        <div ref={strip.ref} {...strip.handlers} className="-mx-4 flex snap-x scroll-pl-4 gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:ml-0 md:scroll-pl-0 md:pl-0 md:cursor-grab md:select-none md:[mask-image:linear-gradient(to_right,black_88%,transparent)]">
          {cards.map((c, i) => <LiveCard key={i} c={c} />)}
        </div>
      )}
    </section>
  )
}
