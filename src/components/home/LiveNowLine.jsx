// «A decorrer agora» numa linha (Home do futuro, SPEC-2, ponto 2 — aprovado
// pelo Francisco a 9 out). Ponto vermelho a piscar, «A decorrer agora · N»,
// os nomes por baixo em cinzento e ›. Tocar abre uma folha com os cartões de
// sempre (os da faixa de 27 set), um por baixo do outro. Sem nada a decorrer,
// a linha não aparece. Os dados são os mesmos: list_live_events (Dev 3).
// Segue os filtros de tipo e de clube da barra (UX, 9 out, de um teste do
// QA): sem nada a decorrer desse tipo ou clube, a linha não aparece.
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { listLiveEvents } from '../../lib/liveEvents'
import { cardFields, LiveCard } from '../live/LiveStrip'
import { Sheet } from '../agenda/AgendaControls'

// O tipo de cada um, como na agenda: um jogo entre amigos num clube é
// «Jogo em aberto» (Francisco, 28 set).
const kindOf = (row) => (row.kind === 'friends' && row.org_kind && row.org_kind !== 'group' ? 'open' : row.kind)

/** Os que passam nos filtros da barra: o tipo e, com clubes escolhidos, só os
 *  desses clubes (como applyFilters). */
export function filterLive(rows, filters) {
  if (!filters) return rows
  const kinds = new Set(filters.kinds || [])
  const orgIds = filters.orgIds ? new Set(filters.orgIds) : null
  return rows.filter((r) => kinds.has(kindOf(r)) && (!orgIds || (r.organization_id != null && orgIds.has(r.organization_id))))
}

/** `filters`: os da barra. `onCount` diz à Home quantos há (já filtrados).
 *  `show = false` (Personalizar): carrega na mesma, mas não se vê. */
export default function LiveNowLine({ filters = null, onCount, show = true }) {
  const { t } = useTranslation()
  const [all, setAll] = useState([])
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let alive = true
    listLiveEvents()
      .then((r) => { if (alive) setAll(r) })
      .catch((err) => console.error('Error loading live events:', err))
    return () => { alive = false }
  }, [])
  const rows = useMemo(() => filterLive(all, filters), [all, filters])
  useEffect(() => { onCount?.(rows.length) }, [rows.length]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!show || !rows.length) return null
  const cards = rows.map((r) => cardFields(r, t, false))
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="press flex w-full items-center gap-2.5 rounded-2xl border border-line bg-white px-3 py-[11px] text-left">
        <span aria-hidden className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-danger" />
        <span className="min-w-0 flex-1">
          <b className="block text-[13.5px] font-extrabold text-ink-900">{t('live.title')} · {rows.length}</b>
          <small className="block truncate text-[11.5px] text-muted">{cards.map((c) => c.title).filter(Boolean).join(' · ')}</small>
        </span>
        <ChevronRight size={18} className="shrink-0 text-[#9CA3AF]" />
      </button>
      {open && (
        <Sheet title={t('live.title')} onClose={() => setOpen(false)}>
          <p className="-mt-1 mb-3 text-[13px] text-ink-700">{t('home.live_sheet_text')}</p>
          <div className="space-y-2.5">
            {cards.map((c, i) => <LiveCard key={i} c={c} wide />)}
          </div>
          <button type="button" onClick={() => setOpen(false)}
            className="press mt-4 flex min-h-[52px] w-full items-center justify-center rounded-ctrl border-[1.5px] border-ink-900 bg-white px-4 text-[15px] font-extrabold text-ink-900">
            {t('ui.close')}
          </button>
        </Sheet>
      )}
    </>
  )
}
