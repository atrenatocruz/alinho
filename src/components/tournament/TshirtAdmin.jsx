// As t-shirts vistas por quem organiza (SPEC 2026-10-08-torneio-t-shirts,
// pontos 4 e 5): o cartão «👕 T-shirts · torneio todo» por cima das duplas,
// com a soma de TODAS as categorias, e a folha «Por tamanho · Por pessoa»,
// onde quem organiza muda o tamanho de qualquer jogador — mesmo depois do
// prazo. As contas são do Dev 3 (tournament_tshirt_counts / _people).
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Sheet } from '../agenda/AgendaControls'
import { Tabs } from '../ui'
import { adminSetTshirtSize, getTshirtCounts, getTshirtPeople } from '../../lib/tournamentApi'
import { NO_TSHIRT, TshirtPicker, sizeMark, sizesOf, tshirtOf, tshirtOn, shirtRulesOf } from './tshirt'

const euros = (cents, locale) => (Number(cents || 0) / 100).toLocaleString(locale, { maximumFractionDigits: 2 })

/** O cartão de cima. Sem t-shirt no torneio, ou sem a função, não aparece. */
export function TshirtSummaryCard({ tournament }) {
  const { t } = useTranslation()
  const [counts, setCounts] = useState(null)
  const [open, setOpen] = useState(false)
  const on = tshirtOn(shirtRulesOf(tournament))
  const load = useCallback(() => {
    if (!on || !tournament?.id) return
    getTshirtCounts(tournament.id).then(setCounts).catch((err) => console.error('Error loading t-shirt counts:', err))
  }, [on, tournament?.id])
  useEffect(load, [load])
  if (!on || !counts) return null
  const bySize = Object.fromEntries((counts.sizes || []).map((s) => [s.size, Number(s.count) || 0]))
  return (
    <>
      <div className="card space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <b className="text-sm font-extrabold text-ink-900"><span aria-hidden="true">👕 </span>{t('tshirt.admin_title')}</b>
          <button type="button" onClick={() => setOpen(true)} className="-my-2 inline-flex min-h-[44px] items-center text-xs font-extrabold text-ink-900 underline underline-offset-2">
            {t('tshirt.admin_see_people')}
          </button>
        </div>
        <p className="text-xs text-muted">
          {t('tshirt.admin_counts', { requested: Number(counts.requested) || 0, declined: Number(counts.declined) || 0, pending: Number(counts.pending) || 0 })}
        </p>
        <div className="grid grid-cols-6 gap-1.5">
          {sizesOf(shirtRulesOf(tournament)).map((s) => (
            <div key={s} className="rounded-ctrl border border-line bg-surface py-1.5 text-center">
              <b className="block text-lg leading-tight text-ink-900">{bySize[s] || 0}</b>
              <span className="font-mono text-[10px] font-bold text-muted">{s}</span>
            </div>
          ))}
        </div>
      </div>
      {open && <TshirtPeopleSheet tournament={tournament} counts={counts} onClose={() => setOpen(false)} onChanged={load} />}
    </>
  )
}

/** A folha «T-shirts · <torneio>». */
function TshirtPeopleSheet({ tournament, counts, onClose, onChanged }) {
  const { t, i18n } = useTranslation()
  const [tab, setTab] = useState('people')
  const [people, setPeople] = useState(null)
  const [editing, setEditing] = useState(null) // a pessoa a mudar
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const ts = tshirtOf(shirtRulesOf(tournament))
  const load = useCallback(() => {
    getTshirtPeople(tournament.id)
      .then((rows) => setPeople([...rows].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt'))))
      .catch((err) => { console.error('Error loading t-shirt people:', err); setPeople([]) })
  }, [tournament.id])
  useEffect(load, [load])

  const change = async (size) => {
    setBusy(true); setError('')
    try {
      await adminSetTshirtSize(editing.entry_id, editing.slot, size)
      setEditing(null)
      load(); onChanged?.()
    } catch (err) {
      console.error('Error changing t-shirt:', err)
      setError(t('tshirt.admin_change_error'))
    } finally { setBusy(false) }
  }

  const requested = Number(counts?.requested) || 0
  return (
    <Sheet title={t('tshirt.admin_sheet_title', { name: tournament.name })} onClose={onClose}>
      {editing ? (
        <div className="space-y-3">
          <button type="button" onClick={() => setEditing(null)} className="-ml-1 inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-ink-500">
            <ChevronLeft size={16} /> {t('tshirt.admin_back')}
          </button>
          <p className="text-sm font-extrabold text-ink-900">{editing.name}{editing.category_code ? ` · ${editing.category_code}` : ''}</p>
          <TshirtPicker rules={shirtRulesOf(tournament)} value={editing.size || null} onChange={change} disabled={busy} label={editing.name} />
          {error && <p className="text-sm font-extrabold text-danger">{error}</p>}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted">
            {ts.mode === 'sale'
              ? t('tshirt.admin_sheet_sale', { count: requested, price: euros(ts.price_cents, i18n.language) })
              : t('tshirt.admin_sheet_gift', { count: requested })}
          </p>
          <Tabs value={tab} onChange={setTab} label={t('tshirt.admin_sheet_title', { name: '' })}
            options={[{ value: 'size', label: t('tshirt.admin_by_size') }, { value: 'people', label: t('tshirt.admin_by_person') }]} />
          {people === null ? (
            <p className="py-6 text-center text-xs text-muted">{t('common.loading')}</p>
          ) : tab === 'people' ? (
            <>
              <div>
                {people.map((p) => (
                  <button key={`${p.entry_id}-${p.slot}`} type="button" onClick={() => { setError(''); setEditing(p) }}
                    className="flex min-h-[44px] w-full items-center gap-2 border-t border-line py-2 text-left">
                    <span className="min-w-0 flex-1 truncate text-sm text-ink-900">
                      {p.name}{p.category_code ? <span className="text-muted"> · {p.category_code}</span> : null}
                    </span>
                    <b className="font-mono text-sm text-ink-900">{sizeMark(p.size)}</b>
                    <ChevronRight size={16} className="shrink-0 text-muted" />
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted">{t('tshirt.admin_legend')}</p>
            </>
          ) : (
            <div>
              {[...sizesOf(shirtRulesOf(tournament)), NO_TSHIRT, null].map((s) => {
                const who = people.filter((p) => (p.size || null) === s)
                if (!who.length) return null
                return (
                  <div key={String(s)} className="border-t border-line py-2">
                    <p className="flex items-center justify-between text-sm">
                      <b className="text-ink-900">{s === NO_TSHIRT ? t('tshirt.no_thanks') : s || t('tshirt.not_chosen')}</b>
                      <b className="font-mono text-ink-900">{who.length}</b>
                    </p>
                    <p className="text-xs text-muted">{who.map((p) => p.name).join(', ')}</p>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </Sheet>
  )
}

/** Os dois tamanhos da dupla, em pequeno: «👕 L · M» («—» não quer, «?» por
 *  escolher). Só quem organiza vê. */
export function PairShirts({ entry }) {
  const marks = [entry.player1_tshirt, entry.player2_name || entry.guest_name || entry.player2_id ? entry.player2_tshirt : undefined]
    .filter((m) => m !== undefined)
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-ink-50 px-2 py-0.5 font-mono text-[11px] font-bold text-ink-700">
      <span aria-hidden="true">👕</span>{marks.map(sizeMark).join(' · ')}
    </span>
  )
}
