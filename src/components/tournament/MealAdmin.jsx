// A refeição vista por quem organiza (#799; SPEC 2026-11-11-torneio-refeicao,
// pontos 4 e 5): o cartão «🍽️ Refeições · torneio todo» por baixo do das
// t-shirts, com as pessoas de TODAS as categorias, e a folha «Refeições ·
// <torneio>», uma lista só, onde quem organiza muda a resposta de qualquer
// jogador, mesmo depois do prazo. As contas são do Dev 3.
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Sheet } from '../agenda/AgendaControls'
import { adminSetMeal, getMealCounts, getMealPeople } from '../../lib/tournamentApi'
import { MealMark, MealPicker, mealOf, mealOn, mealRulesOf } from './meal'
import { PanelSkeleton } from './TournamentSkeleton'

const euros = (cents, locale) => (Number(cents || 0) / 100).toLocaleString(locale, { maximumFractionDigits: 2 })

/** O cartão. Sem refeição no torneio, ou sem a função, não aparece. */
export function MealSummaryCard({ tournament }) {
  const { t } = useTranslation()
  const [counts, setCounts] = useState(null)
  const [open, setOpen] = useState(false)
  const on = mealOn(mealRulesOf(tournament))
  const load = useCallback(() => {
    if (!on || !tournament?.id) return
    getMealCounts(tournament.id).then(setCounts).catch((err) => console.error('Error loading meal counts:', err))
  }, [on, tournament?.id])
  useEffect(load, [load])
  if (!on || !counts) return null
  return (
    <>
      <div className="card space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <b className="text-sm font-extrabold text-ink-900"><span aria-hidden="true">🍽️ </span>{t('meal.admin_title')}</b>
          <button type="button" onClick={() => setOpen(true)} className="-my-2 inline-flex min-h-[44px] items-center text-xs font-extrabold text-ink-900 underline underline-offset-2">
            {t('tshirt.admin_see_people')}
          </button>
        </div>
        <p className="text-xs text-muted">
          {[
            t('meal.count_yes', { count: Number(counts.yes) || 0 }),
            t('meal.count_no', { count: Number(counts.no) || 0 }),
            t('meal.count_pending', { count: Number(counts.pending) || 0 }),
          ].join(' · ')}
        </p>
      </div>
      {open && <MealPeopleSheet tournament={tournament} counts={counts} onClose={() => setOpen(false)} onChanged={load} />}
    </>
  )
}

function MealPeopleSheet({ tournament, counts, onClose, onChanged }) {
  const { t, i18n } = useTranslation()
  const [people, setPeople] = useState(null)
  const [editing, setEditing] = useState(null) // a pessoa a mudar
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const m = mealOf(mealRulesOf(tournament))
  const load = useCallback(() => {
    getMealPeople(tournament.id)
      .then((rows) => setPeople([...rows].map((p) => ({
        ...p,
        entry_id: p.entry_ids?.[0],
        slot: p.slots?.[0] ?? 1,
        codes: Array.isArray(p.category_codes) ? p.category_codes : [],
      })).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt'))))
      .catch((err) => { console.error('Error loading meal people:', err); setPeople([]) })
  }, [tournament.id])
  useEffect(load, [load])

  const change = async (meal) => {
    setBusy(true); setError('')
    try {
      await adminSetMeal(editing.entry_id, editing.slot, meal)
      setEditing(null)
      load(); onChanged?.()
    } catch (err) {
      console.error('Error changing meal:', err)
      setError(t('tshirt.admin_change_error'))
    } finally { setBusy(false) }
  }

  const yes = Number(counts?.yes) || 0
  return (
    <Sheet title={t('meal.admin_sheet_title', { name: tournament.name })} onClose={onClose}>
      {editing ? (
        <div className="space-y-3">
          <button type="button" onClick={() => setEditing(null)} className="-ml-1 inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-ink-500">
            <ChevronLeft size={16} /> {t('tshirt.admin_back')}
          </button>
          <p className="text-sm font-extrabold text-ink-900">{[editing.name, ...editing.codes].join(' · ')}</p>
          <MealPicker value={editing.meal ?? null} onChange={change} disabled={busy} label={editing.name} />
          {error && <p className="text-sm font-extrabold text-danger">{error}</p>}
        </div>
      ) : (
        <div className="space-y-3">
          {/* O número para encomendar (SPEC, ponto 5). */}
          <p className="text-xs text-muted">
            {m.mode === 'sale'
              ? t('meal.admin_sheet_sale', { count: yes, price: euros(m.price_cents, i18n.language) })
              : t('meal.admin_sheet_included', { count: yes })}
          </p>
          {people === null ? (
            <PanelSkeleton rows={2} />
          ) : (
            <div>
              {people.map((p) => (
                <button key={`${p.user_id || p.entry_id}-${p.slot}`} type="button" onClick={() => { setError(''); setEditing(p) }}
                  className="flex min-h-[44px] w-full items-center gap-2 border-t border-line py-2 text-left">
                  <span className="min-w-0 flex-1 text-sm text-ink-900">
                    {p.name}{p.codes.length ? <span className="text-muted"> · {p.codes.join(' · ')}</span> : null}
                  </span>
                  <b className="text-sm text-ink-900"><MealMark meal={p.meal} /></b>
                  <ChevronRight size={16} className="shrink-0 text-muted" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Sheet>
  )
}
