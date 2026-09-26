// Peças pequenas partilhadas pelos ecrãs do torneio (Trello #361 a #366).
// Cores do desenho aprovado (design-handoff/2026-09-19-torneios, SPEC §9):
// torneio = lilás — fundo #E9E7FB, contorno #C9C3F3, texto #4338A8. São as
// mesmas que já estavam reservadas em KIND_STYLE.tournament
// (src/components/agenda/EventCard.jsx).
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Trophy } from 'lucide-react'

export const LILAC = { bg: '#E9E7FB', border: '#C9C3F3', text: '#4338A8' }

/** Etiqueta branca com texto lilás ("Torneio", "M5 · Grupo A · 1/3"). */
export function TourTag({ icon: Icon = Trophy, children }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-white px-2 py-[3px] text-[11px] font-extrabold" style={{ color: LILAC.text }}>
      {Icon && <Icon size={12} strokeWidth={2.2} />}
      {children}
    </span>
  )
}

/** Rótulo em mono maiúsculo ("GRUPO A · PASSAM OS 2 PRIMEIROS"). Só para
 *  estados e títulos pequenos de secção ou de dia — NUNCA para o rótulo de
 *  um campo de formulário, que é o FieldLabel (DESIGN.md 126-127; revisão
 *  da designer de 26 set, «os torneios parecem outra app»). */
export function MonoLabel({ children, className = '' }) {
  return <p className={`font-mono text-[11px] font-extrabold uppercase tracking-[0.06em] text-ink-500 ${className}`}>{children}</p>
}

/** O rótulo de um campo, igual ao do «Criar mix» (Geist, normal). */
export function FieldLabel({ children, className = '', htmlFor }) {
  return <label htmlFor={htmlFor} className={`block text-sm font-medium text-gray-700 mb-2 ${className}`}>{children}</label>
}

/** A própria pessoa nunca é "Tu" — é o nome dela, destacado a verde-claro
 *  (SPEC §2, decisão do Francisco a 19 set). */
export function Me({ children }) {
  return <span className="rounded font-bold px-[3px]" style={{ background: '#DCFCE7', color: '#14532D' }}>{children}</span>
}

/** Pastilha de estado do torneio ou da inscrição. Etiquetas de 1 a 3
 *  palavras, para caberem no cartão sem partir linha (SPEC §2). */
export function StatePill({ tone = 'grey', children }) {
  const tones = {
    in: 'bg-ok text-white',
    wait: 'text-white',
    live: 'text-ink-900',
    dark: 'bg-ink-900 text-white',
    grey: 'bg-ink-50 text-ink-700',
  }
  const style = tone === 'wait' ? { background: '#B86E00' } : tone === 'live' ? { background: '#C5DD01' } : undefined
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-[3px] text-[11px] font-extrabold ${tones[tone] || tones.grey}`} style={style}>
      {children}
    </span>
  )
}

/** Seletor de categoria: pastilha com seta que abre a lista. Abre sempre na
 *  categoria de quem está a ver (print 05). */
export function CategorySelect({ categories, value, onChange, label, mineId = null }) {
  const [open, setOpen] = useState(false)
  const box = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const current = categories.find((c) => c.id === value) || categories[0]
  if (!current) return null

  return (
    <div className="relative inline-block" ref={box}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-expanded={open}
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-line bg-canvas px-3 py-1.5 text-[12.5px] font-semibold text-ink-900"
      >
        {current.code} · {current.name}
        <ChevronDown size={14} strokeWidth={2.4} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 min-w-[220px] overflow-hidden rounded-ctrl border border-line bg-canvas shadow-lg">
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => { onChange(c.id); setOpen(false) }}
              className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm ${c.id === current.id ? 'bg-ink-50 font-bold text-ink-900' : 'text-ink-700 hover:bg-ink-50'}`}
            >
              <span>{c.code} · {c.name}</span>
              {c.id === mineId && <span className="h-2 w-2 shrink-0 rounded-full bg-ok" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
