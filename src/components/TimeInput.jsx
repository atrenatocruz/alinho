// A hora sempre em 24 h («16:00», nunca «04:00 PM»), em todo o lado onde se
// escolhe hora (Renato/Francisco, 16 out). O <input type="time"> do browser
// segue a língua do computador ou do telemóvel, e num em inglês aparece em
// AM/PM, sem forma de o mudar. Aqui são duas partes, horas 00–23 e minutos.
// Funciona como o input: `value` em 'HH:MM' (ou '') e `onChange(e)`, com
// `e.target.value` também em 'HH:MM'. `step` em segundos, como no input
// (1800 = de meia em meia hora); por omissão, de 5 em 5 minutos. Um valor
// fora do passo continua na lista.
//
// No telemóvel, cada parte é um <select>, que abre a roda do sistema. No
// computador (rato), a lista nativa do browser abria enorme, colada à
// esquerda e a tapar a folha (Francisco, 16 out). Lá, cada parte abre uma
// lista própria, pequena (6 linhas), por baixo da caixa, com a escolhida à
// vista e a preto.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const pad = (n) => String(n).padStart(2, '0')
const ROW = 36
const ROWS = 6

const useDesktop = () => {
  const q = '(hover: hover) and (pointer: fine)'
  const [desk, setDesk] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches)
  useEffect(() => {
    const m = window.matchMedia?.(q)
    if (!m) return undefined
    const on = () => setDesk(m.matches)
    m.addEventListener?.('change', on)
    return () => m.removeEventListener?.('change', on)
  }, [])
  return desk
}

// Uma parte (horas ou minutos) no computador: a caixa e a lista por baixo.
function DeskPart({ value, options, onPick, disabled, label, id }) {
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
    setPos({ left: r.left + r.width / 2 - 36, top, height: h })
  }
  useEffect(() => {
    if (!open) return undefined
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'center' })
    const away = (e) => { if (!listRef.current?.contains(e.target) && !btnRef.current?.contains(e.target)) setOpen(false) }
    const key = (e) => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus() } }
    const move = () => setOpen(false)
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
        className="min-w-[2.4ch] rounded-[6px] px-0.5 text-center text-base tabular-nums text-ink-900 outline-none focus-visible:ring-2 focus-visible:ring-ink-900/30 disabled:cursor-default">
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
                className={`block w-full rounded-[8px] text-center text-[15px] tabular-nums ${sel ? 'bg-ink-900 font-extrabold text-white' : 'text-ink-900 hover:bg-ink-50'}`}
                style={{ height: ROW }}>
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

export default function TimeInput({ value = '', onChange, step = 300, className = '', disabled = false, id, 'aria-label': ariaLabel, required = false }) {
  const desk = useDesktop()
  const [hh = '', mm = ''] = String(value || '').slice(0, 5).split(':')
  const every = Math.max(1, Math.round(Number(step || 300) / 60))
  const hours = Array.from({ length: 24 }, (_, h) => pad(h))
  const minutes = []
  for (let m = 0; m < 60; m += every) minutes.push(pad(m))
  if (mm && !minutes.includes(mm)) minutes.push(mm)
  minutes.sort()
  const emit = (h, m) => onChange?.({ target: { value: h && m ? `${h}:${m}` : '' } })
  const hLabel = ariaLabel ? `${ariaLabel} (horas)` : 'Horas'
  const mLabel = ariaLabel ? `${ariaLabel} (minutos)` : 'Minutos'
  const sel = 'min-w-0 cursor-pointer appearance-none bg-transparent text-center text-base tabular-nums text-ink-900 outline-none disabled:cursor-default'
  return (
    <div role="group" aria-label={ariaLabel}
      className={`flex items-center gap-0.5 ${className} ${disabled ? 'opacity-60' : ''}`}>
      {desk ? (
        <>
          <DeskPart id={id} value={hh} options={hours} label={hLabel} disabled={disabled} onPick={(h) => emit(h, mm || '00')} />
          <span aria-hidden="true" className="text-ink-500">:</span>
          <DeskPart value={mm} options={minutes} label={mLabel} disabled={disabled} onPick={(m) => emit(hh || '00', m)} />
        </>
      ) : (
        <>
          <select id={id} value={hh} disabled={disabled} required={required} aria-label={hLabel}
            onChange={(e) => emit(e.target.value, mm || '00')} className={`${sel} w-[2.4ch]`}>
            {!hh && <option value="">--</option>}
            {hours.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
          <span aria-hidden="true" className="text-ink-500">:</span>
          <select value={mm} disabled={disabled} required={required} aria-label={mLabel}
            onChange={(e) => emit(hh || '00', e.target.value)} className={`${sel} w-[2.4ch]`}>
            {!mm && <option value="">--</option>}
            {minutes.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </>
      )}
    </div>
  )
}
