// Categorias que chocam (design-handoff/2026-10-09-torneio-categorias-chocam,
// aprovado pelo Francisco a 9 out, com o «MUDOU»: os choques resolvem-se
// antes do sorteio, e aqui bloqueia — ninguém joga dois jogos ao mesmo tempo).
// Os dados são do Dev 3 (tournament_player_clashes, my_category_clashes,
// admin_remove_player_from_entry).
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ChevronRight } from 'lucide-react'
import { Sheet } from '../agenda/AgendaControls'
import { describeError } from '../../lib/errors'
import { dayKeyInTz, hhmmInTz } from '../../lib/tournamentDay'
import { removePlayerFromEntry } from '../../lib/tournamentApi'

const BTN = 'inline-flex min-h-[48px] w-full items-center justify-center rounded-ctrl px-5 text-base font-extrabold transition-all duration-fast active:scale-[0.98] disabled:opacity-40'

/** Só os choques de antes do sorteio (as categorias a começar quase juntas). */
export const startClashes = (clashes) => (clashes || []).filter((c) => c.kind === 'near_start')

/** Os casos de uma categoria: as pessoas que também estão noutra que começa
 *  quase à mesma hora. Cada caso diz a inscrição DESTA categoria e a outra. */
export function casesFor(clashes, categoryId, kind = 'near_start') {
  return (clashes || []).filter((c) => c.kind === kind)
    .filter((c) => c.category_a === categoryId || c.category_b === categoryId)
    .map((c) => (c.category_a === categoryId
      ? { ...c, here: { id: c.category_a, code: c.code_a, entry: c.entry_id_a, at: c.at_a }, other: { id: c.category_b, code: c.code_b, entry: c.entry_id_b, at: c.at_b } }
      : { ...c, here: { id: c.category_b, code: c.code_b, entry: c.entry_id_b, at: c.at_b }, other: { id: c.category_a, code: c.code_a, entry: c.entry_id_a, at: c.at_a } }))
}

/** «sábado às 12:00» / «sáb 12:00», na hora de Portugal. */
export function whenText(iso, lang, short = false) {
  if (!iso) return ''
  const day = new Date(`${dayKeyInTz(new Date(iso))}T12:00`)
  const wd = day.toLocaleDateString(lang, { weekday: short ? 'short' : 'long' }).replace('.', '').split('-')[0]
  return short ? `${wd} ${hhmmInTz(iso)}` : `${wd} às ${hhmmInTz(iso)}`
}

/** A caixa amarela de cima: o que falta resolver, e «Resolver ›». */
export function ClashBanner({ children, onResolve }) {
  const { t } = useTranslation()
  return (
    <div className="mb-3 rounded-ctrl border border-warning/40 bg-warning/10 px-3.5 py-3 text-sm text-ink-900">
      <p className="flex gap-2"><AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" /><span>{children}</span></p>
      {onResolve && (
        <button type="button" onClick={onResolve} className="mt-1.5 min-h-[36px] text-sm font-extrabold underline underline-offset-2">
          {t('tclash.resolve')}
        </button>
      )}
    </div>
  )
}

/** A folha com os casos (do «Resolver ›»). `clashes` já vem só com os do
 *  momento: antes do sorteio, as categorias juntas; depois, os jogos juntos
 *  — e aí há «Abrir o Horário», a outra forma de resolver (SPEC, ponto 6). */
export function ClashListSheet({ clashes, onPick, onClose, onSchedule = null }) {
  const { t, i18n } = useTranslation()
  const list = clashes || []
  return (
    <Sheet title={t('tclash.list_title')} onClose={onClose}>
      <p className="text-sm text-ink-700">{t(onSchedule ? 'tclash.list_intro_after' : 'tclash.list_intro')}</p>
      <div className="mt-3 divide-y divide-line">
        {list.map((c) => (
          <button key={`${c.user_id}-${c.category_a}-${c.category_b}`} type="button" onClick={() => onPick(c)}
            className="flex w-full items-center gap-3 py-3 text-left">
            <span className="min-w-0 flex-1">
              <b className="block truncate text-sm font-extrabold text-ink-900">{c.name}</b>
              <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
                <span className="rounded-md bg-ink-900 px-1.5 py-0.5 font-mono text-[11px] font-bold text-white">{c.code_a}</span>
                <span className="rounded-md bg-ink-900 px-1.5 py-0.5 font-mono text-[11px] font-bold text-white">{c.code_b}</span>
                {whenText(c.at_a, i18n.language, true)}
              </span>
            </span>
            <span className="inline-flex shrink-0 items-center text-sm font-extrabold text-ink-900">{t('tclash.solve_one')} <ChevronRight size={16} /></span>
          </button>
        ))}
      </div>
      {onSchedule && <button type="button" onClick={onSchedule} className={`${BTN} mt-3 bg-ink-900 text-white`}>{t('tclash.open_schedule')}</button>}
      <button type="button" onClick={onClose} className={`${BTN} ${onSchedule ? 'mt-2' : 'mt-3'} border border-line bg-white text-ink-900`}>{t('tclash.close')}</button>
    </Sheet>
  )
}

/** Um caso: «Tirar do MX4» (vermelho), «Tirar do M4» (contorno vermelho),
 *  «Mudar a hora do MX4» (contorno) e «Ainda não». `hereId`: a categoria onde
 *  se está (é dessa que o vermelho cheio tira); sem ela, a segunda.
 *  O «Mudar a hora» voltou a 13 out: com inscritos, a hora de uma categoria
 *  muda-se no Editar até ao sorteio dela (Dev 3). Abre o Editar nessa
 *  categoria, com a hora à frente. */
export function ClashCaseSheet({ clash, hereId = null, onRemoved, onClose }) {
  const { t, i18n } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const a = { id: clash.category_a, code: clash.code_a, entry: clash.entry_id_a }
  const b = { id: clash.category_b, code: clash.code_b, entry: clash.entry_id_b }
  const [first, second] = hereId === a.id ? [a, b] : [b, a]
  const [params, setParams] = useSearchParams()
  const changeTime = () => {
    const next = new URLSearchParams(params)
    next.set('admin', 'editar'); next.set('cat', first.code)
    // Como o «Editar» da barra: ao fechar, volta-se para aqui.
    setParams(next, { state: { adminFromPage: true } })
  }
  const remove = async (from) => {
    setBusy(true); setError('')
    try {
      await removePlayerFromEntry(from.entry, clash.user_id)
      onRemoved(from)
    } catch (err) {
      setError(describeError(t, err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet title={clash.name} onClose={onClose}>
      <p className="text-sm text-ink-700">
        {t('tclash.case_line', { a: clash.code_a, b: clash.code_b, when: whenText(clash.at_a, i18n.language) })}
      </p>
      {error && <p role="alert" className="mt-3 rounded-ctrl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm font-bold text-danger">{error}</p>}
      <div className="mt-4 space-y-2">
        <button type="button" disabled={busy} onClick={() => remove(first)} className={`${BTN} bg-danger text-white`}>
          {t('tclash.remove_from', { code: first.code })}
        </button>
        <button type="button" disabled={busy} onClick={() => remove(second)} className={`${BTN} border border-danger bg-white text-danger`}>
          {t('tclash.remove_from', { code: second.code })}
        </button>
        <button type="button" disabled={busy} onClick={changeTime} className={`${BTN} border border-line bg-white text-ink-900`}>
          {t('tclash.change_time', { code: first.code })}
        </button>
        <button type="button" onClick={onClose} className={`${BTN} border border-line bg-white text-ink-900`}>
          {t('tclash.not_now')}
        </button>
      </div>
      <p className="mt-3 text-xs text-muted">{t('tclash.case_note', { code: first.code })}</p>

    </Sheet>
  )
}

/** Duas categorias que começam no mesmo dia com menos de 1 hora entre elas
 *  (inclui a mesma hora) — a regra de «antes do sorteio» (SPEC, topo). */
export function categoriesClash(a, b) {
  if (!a || !b || a.id === b.id || !a.day_date || !b.day_date || a.day_date !== b.day_date) return false
  const mins = (c) => { const [h, m] = String(c.start_time || '').split(':').map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : null }
  const x = mins(a)
  const y = mins(b)
  return x != null && y != null && Math.abs(x - y) < 60
}

/** «sábado às 12:00», a partir do dia e da hora da categoria. */
export function categoryWhen(c, lang) {
  if (!c?.day_date) return ''
  const wd = new Date(`${c.day_date}T12:00`).toLocaleDateString(lang, { weekday: 'long' }).split('-')[0]
  return c.start_time ? `${wd} às ${String(c.start_time).slice(0, 5)}` : wd
}

/** A caixa amarela de quem joga: o aviso e, se houver, a ligação. */
export function ClashNotice({ children, action = null }) {
  return (
    <div className="rounded-ctrl border border-warning/40 bg-warning/10 px-3.5 py-3 text-sm text-ink-900">
      <p className="flex gap-2"><AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" /><span>{children}</span></p>
      {action && (
        <button type="button" onClick={action.onClick} className="mt-1.5 min-h-[36px] text-sm font-extrabold underline underline-offset-2">
          {action.label}
        </button>
      )}
    </div>
  )
}

/** Depois do sorteio (acerto de 9 out): tirar alguém partia o quadro, por
 *  isso a saída é «Trocar jogador» — primeiro em que categoria. A que está
 *  aberta troca aqui; a outra abre as Duplas dela. */
export function ClashSwapSheet({ clash, hereId, onSwapHere, onSwapThere, onSchedule, onClose }) {
  const { t, i18n } = useTranslation()
  const here = clash.category_a === hereId ? { code: clash.code_a, at: clash.at_a } : { code: clash.code_b, at: clash.at_b }
  const there = clash.category_a === hereId ? { code: clash.code_b, at: clash.at_b } : { code: clash.code_a, at: clash.at_a }
  return (
    <Sheet title={clash.name} onClose={onClose}>
      <p className="text-sm text-ink-700">
        {t('tclash.games_line', { a: here.code, ta: hhmmInTz(here.at), b: there.code, tb: hhmmInTz(there.at), day: whenText(here.at, i18n.language, true).split(' ')[0] })}
      </p>
      <div className="mt-4 space-y-2">
        <button type="button" onClick={onSwapHere} className={`${BTN} bg-ink-900 text-white`}>{t('tclash.swap_in', { code: here.code })}</button>
        <button type="button" onClick={onSwapThere} className={`${BTN} border border-line bg-white text-ink-900`}>{t('tclash.swap_in', { code: there.code })}</button>
        <button type="button" onClick={onSchedule} className={`${BTN} border border-line bg-white text-ink-900`}>{t('tclash.open_schedule')}</button>
        <button type="button" onClick={onClose} className={`${BTN} border border-line bg-white text-ink-900`}>{t('tclash.not_now')}</button>
      </div>
      <p className="mt-3 text-xs text-muted">{t('tclash.swap_note')}</p>
    </Sheet>
  )
}
