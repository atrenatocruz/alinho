// A roda para escolher datas e horas (design-handoff/2026-10-18-roda-datas-horas,
// aprovado pelo Francisco a 19 out). Uma peça nossa, igual no iPhone, no
// Android e no computador — não a roda do sistema («está muito marada», 16 out).
//
// WheelColumn: uma coluna que desliza e pára sempre numa linha (scroll-snap).
//   5 linhas à vista, de 46 px; a do meio a preto, numa faixa #F4F5F1 (a faixa
//   é do WheelSheet, por trás das colunas); as outras a cinzento, mais pequenas
//   e inclinadas para trás. Toca-se numa linha para a pôr no meio; no
//   computador, a roda do rato e as setas. Cada coluna é uma lista que o leitor
//   de ecrã lê, com o nome (`label`).
// WheelSheet: a folha branca por baixo — pega, título, linha cinzenta opcional,
//   as colunas e «Feito» a preto. O campo só muda com «Feito»; o «✕» e tocar
//   fora fecham sem mudar nada.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'

export const ROW = 46
const VISIBLE = 5
const PAD = ((VISIBLE - 1) / 2) * ROW

export function WheelColumn({ options, value, onChange, label, className = '', align = 'center' }) {
  const ref = useRef(null)
  const [pos, setPos] = useState(0) // scrollTop, para inclinar as linhas
  const settle = useRef(null)
  const index = Math.max(0, options.findIndex((o) => o.value === value))

  // Abre já na linha certa, sem animação.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.scrollTop = index * ROW
    setPos(index * ROW)
  }, [options.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Se o valor mudar por fora (por exemplo, o dia que deixa de existir no mês),
  // a roda acompanha.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (Math.round(el.scrollTop / ROW) !== index) el.scrollTo({ top: index * ROW, behavior: 'smooth' })
  }, [index])

  const onScroll = () => {
    const el = ref.current
    if (!el) return
    setPos(el.scrollTop)
    clearTimeout(settle.current)
    settle.current = setTimeout(() => {
      const i = Math.min(options.length - 1, Math.max(0, Math.round(el.scrollTop / ROW)))
      if (options[i] && options[i].value !== value) onChange(options[i].value)
    }, 90)
  }
  useEffect(() => () => clearTimeout(settle.current), [])

  const goTo = (i) => {
    const j = Math.min(options.length - 1, Math.max(0, i))
    ref.current?.scrollTo({ top: j * ROW, behavior: 'smooth' })
  }
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); goTo(index + 1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); goTo(index - 1) }
    else if (e.key === 'PageDown') { e.preventDefault(); goTo(index + 5) }
    else if (e.key === 'PageUp') { e.preventDefault(); goTo(index - 5) }
    else if (e.key === 'Home') { e.preventDefault(); goTo(0) }
    else if (e.key === 'End') { e.preventDefault(); goTo(options.length - 1) }
  }

  return (
    <div
      ref={ref}
      role="listbox"
      aria-label={label}
      aria-activedescendant={options[index] ? `${label}-${index}` : undefined}
      tabIndex={0}
      onScroll={onScroll}
      onKeyDown={onKey}
      className={`no-scrollbar relative z-[1] overflow-y-auto overscroll-contain outline-none [scroll-snap-type:y_mandatory] focus-visible:ring-2 focus-visible:ring-ink-900/20 rounded-[14px] ${className}`}
      style={{
        height: VISIBLE * ROW,
        paddingTop: PAD,
        paddingBottom: PAD,
        // Desaparecem em cima e em baixo.
        maskImage: 'linear-gradient(to bottom, transparent 0, #000 30%, #000 70%, transparent 100%)',
        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, #000 30%, #000 70%, transparent 100%)',
      }}
    >
      {options.map((o, i) => {
        const d = (i * ROW - pos) / ROW // distância ao meio, em linhas
        const far = Math.min(2, Math.abs(d))
        const center = Math.abs(d) < 0.5
        return (
          <div
            key={o.value}
            id={`${label}-${i}`}
            role="option"
            aria-selected={i === index}
            onClick={() => goTo(i)}
            className={`flex cursor-pointer select-none items-center whitespace-nowrap tabular-nums [scroll-snap-align:center] ${align === 'start' ? 'justify-start pl-3' : align === 'end' ? 'justify-end pr-3' : 'justify-center'} ${center ? 'font-semibold text-[#040404]' : 'text-[#9CA3AF]'}`}
            style={{
              height: ROW,
              fontSize: center ? 22 : 19 - far * 1.5,
              transform: `perspective(400px) rotateX(${Math.max(-60, Math.min(60, -d * 22))}deg)`,
              transition: 'font-size 120ms',
            }}
          >
            {o.label}
          </div>
        )
      })}
    </div>
  )
}

/** A folha da roda. `columns` são <WheelColumn>; `onDone` guarda. */
export function WheelSheet({ title, subtitle = null, headline = null, onClose, onDone, children }) {
  const { t } = useTranslation()
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/50 animate-fade-in sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title}
        className="w-full rounded-t-[24px] bg-white px-5 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-2.5 shadow-lift animate-pop sm:max-w-md sm:rounded-[24px]"
        onClick={(e) => e.stopPropagation()}>
        <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-[#E3E4E6]" />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-lg font-medium text-ink-900">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
            {/* O dia escolhido por extenso, a preto, que muda enquanto se mexe. */}
            {headline && <p aria-live="polite" className="mt-0.5 text-[13px] font-semibold text-ink-900">{headline}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label={t('ui.close')}
            className="-mr-2 -mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-700 hover:bg-ink-50">
            <X size={20} />
          </button>
        </div>
        <div className="relative mt-4">
          {/* A faixa da linha do meio, por trás das colunas. */}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 rounded-[14px] bg-[#F4F5F1]" style={{ top: PAD, height: ROW }} />
          <div className="relative flex items-stretch">{children}</div>
        </div>
        <button type="button" onClick={onDone}
          className="press mt-5 flex min-h-[52px] w-full items-center justify-center rounded-ctrl bg-ink-900 text-base font-extrabold text-white">
          {t('ui.wheel_done')}
        </button>
      </div>
    </div>,
    document.body,
  )
}
