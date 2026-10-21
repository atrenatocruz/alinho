// A hora sempre em 24 h («16:00», nunca «04:00 PM»), em todo o lado onde se
// escolhe hora (Renato/Francisco, 16 out). O <input type="time"> do browser
// segue a língua do computador ou do telemóvel, e num em inglês aparece em
// AM/PM, sem forma de o mudar. Aqui são duas partes, horas 00–23 e minutos.
// Funciona como o input: `value` em 'HH:MM' (ou '') e `onChange(e)`, com
// `e.target.value` também em 'HH:MM'. `step` em segundos, como no input
// (1800 = de meia em meia hora); por omissão, de 5 em 5 minutos. Um valor
// fora do passo continua na lista.
//
// Cada parte abre uma lista da app, pequena (6 linhas), junto à caixa, com
// a escolhida à vista e a preto — no computador e no telemóvel. A lista
// nativa abria enorme e colada à esquerda no computador, e a roda do sistema
// no telemóvel «está muito marada para mudar as horas, nem devia ser de
// sistema» (Francisco, 16 out). Com o dedo, as linhas têm 44 px.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Clock } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const pad = (n) => String(n).padStart(2, '0')
const ROWS = 6

// Com o dedo (sem rato), linhas de 44 px; com rato, de 36.
const useTouch = () => {
  const q = '(pointer: coarse)'
  const [touch, setTouch] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches)
  useEffect(() => {
    const m = window.matchMedia?.(q)
    if (!m) return undefined
    const on = () => setTouch(m.matches)
    m.addEventListener?.('change', on)
    return () => m.removeEventListener?.('change', on)
  }, [])
  return touch
}

// Uma parte (horas ou minutos): a caixa e a lista junto dela.
function Part({ value, options, onPick, disabled, label, id }) {
  const ROW = useTouch() ? 44 : 36
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)
  const listRef = useRef(null)
  const place = () => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    const h = Math.min(options.length, ROWS) * ROW + 8
    const below = window.innerHeight - r.bottom - 8
    const top = below >= h || below >= r.top ? r.bottom + 6 : r.top - 6 - h
    // Dentro do ecrã, com 8 px de folga (a 375 a lista nunca sai da folha).
    const left = Math.min(Math.max(8, r.left + r.width / 2 - 36), window.innerWidth - 80)
    setPos({ left, top: Math.max(8, top), height: h })
  }
  useEffect(() => {
    if (!open) return undefined
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'center' })
    const away = (e) => { if (!listRef.current?.contains(e.target) && !btnRef.current?.contains(e.target)) setOpen(false) }
    const key = (e) => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus() } }
    // Só fecha se a largura mudar (rodar o telemóvel); no iPhone a barra do
    // Safari a aparecer e sumir também dá «resize».
    const w0 = window.innerWidth
    const move = () => { if (window.innerWidth !== w0) setOpen(false) }
    document.addEventListener('mousedown', away, true)
    window.addEventListener('keydown', key)
    window.addEventListener('resize', move)
    return () => { document.removeEventListener('mousedown', away, true); window.removeEventListener('keydown', key); window.removeEventListener('resize', move) }
  }, [open])
  return (
    <>
      <button ref={btnRef} id={id} type="button" disabled={disabled} aria-label={label}
        aria-haspopup="listbox" aria-expanded={open}
        onClick={() => { if (!open) place(); setOpen((o) => !o) }}
        className="min-h-[44px] min-w-[2.6ch] rounded-[6px] px-1 text-center text-base tabular-nums text-ink-900 outline-none focus-visible:ring-2 focus-visible:ring-ink-900/30 disabled:cursor-default">
        {value || '--'}
      </button>
      {open && pos && createPortal(
        <div ref={listRef} role="listbox" aria-label={label}
          className="fixed z-[80] w-[72px] overflow-y-auto rounded-ctrl bg-white p-1 shadow-lift ring-1 ring-line"
          style={{ left: pos.left, top: pos.top, maxHeight: pos.height }}>
          {options.map((o) => {
            const sel = o === value
            return (
              <button key={o} type="button" role="option" aria-selected={sel}
                onClick={() => { onPick(o); setOpen(false); btnRef.current?.focus() }}
                className={`block w-full rounded-[8px] pl-3 text-left text-[15px] tabular-nums ${sel ? 'bg-ink-900 font-extrabold text-white' : 'text-ink-900 hover:bg-ink-50'}`}
                style={{ height: ROW, minHeight: ROW }}>
                {o}
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </>
  )
}

export default function TimeInput({ value = '', onChange, step = 300, className = '', disabled = false, id, 'aria-label': ariaLabel }) {
  const { t } = useTranslation()
  const [hh = '', mm = ''] = String(value || '').slice(0, 5).split(':')
  const every = Math.max(1, Math.round(Number(step || 300) / 60))
  const hours = Array.from({ length: 24 }, (_, h) => pad(h))
  const minutes = []
  for (let m = 0; m < 60; m += every) minutes.push(pad(m))
  if (mm && !minutes.includes(mm)) minutes.push(mm)
  minutes.sort()
  const emit = (h, m) => onChange?.({ target: { value: h && m ? `${h}:${m}` : '' } })
  const hLabel = ariaLabel ? t('timeinput.hours_of', { label: ariaLabel }) : t('timeinput.hours')
  const mLabel = ariaLabel ? t('timeinput.minutes_of', { label: ariaLabel }) : t('timeinput.minutes')
  // O relógio à direita mostra que é um campo, como o antigo (UX, 16 out);
  // tocar no espaço livre da caixa ou no relógio abre as horas. Nas caixas
  // estreitas (as horas do torneio, 100 px) não cabe e não aparece.
  const boxRef = useRef(null)
  const [roomy, setRoomy] = useState(true)
  useEffect(() => {
    const el = boxRef.current
    if (!el || typeof ResizeObserver !== 'function') return undefined
    const ro = new ResizeObserver(() => setRoomy(el.clientWidth >= 120))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const openHours = (e) => {
    if (disabled || e.target.closest('button')) return
    e.currentTarget.querySelector('button')?.click()
  }
  return (
    <div ref={boxRef} role="group" aria-label={ariaLabel} onClick={openHours}
      className={`flex cursor-pointer items-center gap-0.5 ${className} ${disabled ? 'cursor-default opacity-60' : ''}`}>
      <Part id={id} value={hh} options={hours} label={hLabel} disabled={disabled} onPick={(h) => emit(h, mm || '00')} />
      <span aria-hidden="true" className="text-ink-500">:</span>
      <Part value={mm} options={minutes} label={mLabel} disabled={disabled} onPick={(m) => emit(hh || '00', m)} />
      {roomy && <Clock size={18} aria-hidden="true" className="ml-auto shrink-0 text-ink-500" />}
    </div>
  )
}
