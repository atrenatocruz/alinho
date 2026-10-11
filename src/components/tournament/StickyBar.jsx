// A categoria, os separadores e os dias presos ao descer (design-handoff/
// 2026-10-11-torneio-topo-preso, aprovado para experimentar pelo Francisco a
// 11 out). Ficam por baixo da barra do título (BackBar, 64 px + a margem do
// telemóvel), com fundo branco e uma sombra leve; em cima, antes de descer,
// tudo como hoje. Mudar de categoria, de separador ou de dia na barra presa
// leva ao início dessa lista, logo abaixo da barra — não ao topo da página.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const BAR_TOP = 'calc(4rem + var(--safe-top, env(safe-area-inset-top, 0px)))'
const SHADOW = 'shadow-[0_8px_12px_-10px_rgba(15,23,42,0.35)]'

/** O que desliza: o <main> do Layout (overflow-y-auto), não a janela. */
function scroller(el) {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY
    if (o === 'auto' || o === 'scroll') return p
  }
  return document.scrollingElement || document.documentElement
}
const topOf = (box) => (box === document.scrollingElement || box === document.documentElement ? 0 : box.getBoundingClientRect().top)

/** Preso? A barra presa fica com o `top` que o CSS lhe dá; solta, está abaixo. */
function useStuck(ref, onMeasure) {
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const box = scroller(el)
    const target = box === document.scrollingElement || box === document.documentElement ? window : box
    const update = () => {
      const top = parseFloat(getComputedStyle(el).top) || 0
      const r = el.getBoundingClientRect()
      setStuck(box.scrollTop > 0 && r.top - topOf(box) <= top + 0.5)
      onMeasure?.(top, r.height)
    }
    update()
    target.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    ro?.observe(el)
    return () => {
      target.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      ro?.disconnect()
    }
  }, [ref, onMeasure])
  return stuck
}

/** Leva a lista ao início, logo abaixo da barra presa — só quando já se
 *  desceu para lá dela (em cima, nada mexe). Vê-se pelo marcador que fica no
 *  sítio da barra: se já passou para cima do topo preso, desceu-se. */
function useBackToListStart(resetKey, sentinel, topPx) {
  const first = useRef(true)
  useLayoutEffect(() => {
    if (first.current) { first.current = false; return }
    if (!sentinel.current) return
    const box = scroller(sentinel.current)
    const offset = sentinel.current.getBoundingClientRect().top - topOf(box) - topPx()
    if (offset >= -1) return
    box.scrollTo({ top: Math.max(0, box.scrollTop + offset) })
  }, [resetKey]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** A categoria e os separadores. `resetKey` muda ao trocar de categoria ou de
 *  separador; `shadow` sai quando há dias presos por baixo (Horário), para não
 *  ficarem duas sombras. */
export function StickyTabs({ children, resetKey, shadow = true }) {
  const ref = useRef(null)
  const sentinel = useRef(null)
  const measure = useRef((top, h) => {
    document.documentElement.style.setProperty('--t-sticky-bottom', `${top + h}px`)
  }).current
  const stuck = useStuck(ref, measure)
  useEffect(() => () => document.documentElement.style.removeProperty('--t-sticky-bottom'), [])
  useBackToListStart(resetKey, sentinel, () => parseFloat(getComputedStyle(ref.current).top) || 0)
  return (
    <>
      <div ref={sentinel} aria-hidden />
      {/* A mesma altura presa ou solta: o espaço que sai do meio (16 → 8 px)
          passa para baixo — senão a página saltava ao prender. */}
      <div ref={ref} style={{ top: BAR_TOP }}
        className={`sticky z-[9] -mx-4 bg-white px-4 ${stuck ? `space-y-2 pb-4 pt-2 ${shadow ? SHADOW : ''}` : 'space-y-4 pb-2 pt-2'}`}>
        {children}
      </div>
    </>
  )
}

/** Os dias do Horário, presos por baixo da categoria e dos separadores. */
export function StickyDays({ children, resetKey }) {
  const ref = useRef(null)
  const sentinel = useRef(null)
  const stuck = useStuck(ref)
  useBackToListStart(resetKey, sentinel, () => (parseFloat(getComputedStyle(ref.current).top) || 0))
  return (
    <>
      <div ref={sentinel} aria-hidden />
      <div ref={ref} style={{ top: 'var(--t-sticky-bottom, 0px)' }}
        className={`sticky z-[8] -mx-4 mb-2 bg-white px-4 pb-2 ${stuck ? SHADOW : ''}`}>
        {children}
      </div>
    </>
  )
}
