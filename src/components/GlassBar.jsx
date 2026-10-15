// A barra de vidro presa em cima (design-handoff/2026-10-14-capa-barra-presa,
// aprovado pelo Francisco a 14 out: «como no topo da app do Claude»).
//   - Sem fundo sólido: um desfoque de 10 px com um degradê do cinzento da
//     página (#F1F2EE a 92 % em cima, 75 % a meio, 0 % em baixo). Sem linha,
//     cantos nem sombra; acaba a desvanecer-se.
//   - De ponta a ponta da janela (ponto 6), com os botões e o título
//     alinhados com a coluna da app.
//   - O «‹» à esquerda, à direita o partilhar (e o ♡), em círculos de vidro de
//     42 px; ao centro o nome, com o ponto na cor do tipo.
// Vai para o <body> (fixed): a coluna da app tem uma animação de entrada que
// prenderia um `fixed` lá dentro, e assim a barra ocupa a janela toda.
// Os separadores presos por baixo usam GLASS_BELOW, o mesmo vidro a continuar.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export const SAFE_TOP = 'var(--safe-top, env(safe-area-inset-top, 0px))'
/** A altura da barra (64 px + a margem do telemóvel): o sítio onde se
 *  prendem os separadores por baixo dela. */
export const GLASS_BAR_H = `calc(4rem + ${SAFE_TOP})`

export const GLASS_ROUND = 'flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full border border-white/70 bg-white/55 text-ink-900 shadow-[0_1px_3px_rgba(17,17,17,0.12)] backdrop-blur-md'

/** O fundo dos separadores presos por baixo da barra: o vidro a 75 %, que se
 *  desvanece em baixo, como o da barra. */
export const GLASS_BELOW_STYLE = {
  background: 'linear-gradient(to bottom, rgba(241,242,238,0.8) 0%, rgba(241,242,238,0.75) 70%, rgba(241,242,238,0) 100%)',
  WebkitBackdropFilter: 'blur(10px)',
  backdropFilter: 'blur(10px)',
  WebkitMaskImage: 'linear-gradient(to bottom, #000 75%, transparent)',
  maskImage: 'linear-gradient(to bottom, #000 75%, transparent)',
}

const GLASS_BG = {
  background: 'linear-gradient(to bottom, rgba(241,242,238,0.92) 0%, rgba(241,242,238,0.75) 55%, rgba(241,242,238,0) 100%)',
  WebkitBackdropFilter: 'blur(10px)',
  backdropFilter: 'blur(10px)',
  WebkitMaskImage: 'linear-gradient(to bottom, #000 60%, transparent)',
  maskImage: 'linear-gradient(to bottom, #000 60%, transparent)',
}

/** O contentor que desliza (o <main> da app; sem ele, a janela). */
export function scrollParentOf(el) {
  for (let n = el?.parentElement; n; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY
    if (oy === 'auto' || oy === 'scroll') return n
  }
  return null
}

/** true quando `el` já passou por cima de `offsetPx` do topo do ecrã. */
export function usePassedTop(ref, offsetPx = 0, deps = []) {
  const [passed, setPassed] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver(
      ([entry]) => setPassed(!entry.isIntersecting && entry.boundingClientRect.top < offsetPx),
      { rootMargin: `-${offsetPx}px 0px 0px 0px`, threshold: 0 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  return passed
}

/** A largura da área que desliza, sem a barra de deslizar do computador: a
 *  barra fica centrada com a coluna. */
function useScrollArea(anchorRef) {
  const [box, setBox] = useState(null)
  useLayoutEffect(() => {
    const area = scrollParentOf(anchorRef.current)
    const measure = () => {
      if (!area) { setBox({ left: 0, width: document.documentElement.clientWidth }); return }
      const r = area.getBoundingClientRect()
      setBox({ left: r.left, width: area.clientWidth })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [anchorRef])
  return box
}

/** `show`: a barra está lá (os botões); `filled`: com o vidro por trás;
 *  `title`/`dot`: o nome ao centro, só com `showTitle`. `wide`: dois botões
 *  à direita (♡ e partilhar) — os dois lados ficam com a mesma largura, para
 *  o nome ficar mesmo ao centro. */
export default function GlassBar({ anchorRef, show = true, filled = true, showTitle = false, title, dot, left, right, wide = false }) {
  const box = useScrollArea(anchorRef)
  if (!box || typeof document === 'undefined') return null
  return createPortal(
    <div aria-hidden={!show || undefined}
      className={`fixed top-0 z-30 transition-opacity duration-fast ${show ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      style={{ left: box.left, width: box.width }}>
      <div aria-hidden="true" className={`pointer-events-none absolute inset-x-0 top-0 transition-opacity duration-fast ${filled ? 'opacity-100' : 'opacity-0'}`}
        style={{ ...GLASS_BG, height: `calc(${GLASS_BAR_H} + 18px)` }} />
      <div className="relative mx-auto max-w-2xl px-4" style={{ paddingTop: SAFE_TOP }}>
        <div className={`grid h-16 items-center gap-3 ${wide ? 'grid-cols-[minmax(92px,auto)_minmax(0,1fr)_minmax(92px,auto)]' : 'grid-cols-[42px_minmax(0,1fr)_42px]'}`}>
          {left || <span aria-hidden />}
          <p aria-hidden={!showTitle} className={`flex min-w-0 items-center justify-center gap-2 text-base font-extrabold text-ink-900 transition-opacity duration-fast ${showTitle ? 'opacity-100' : 'opacity-0'}`}>
            {dot && <i aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />}
            <span className="min-w-0 truncate">{title}</span>
          </p>
          <div className="flex justify-end gap-2">{right}</div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** O fundo de vidro de um bloco preso, de ponta a ponta da área que desliza
 *  (no computador, a coluna é mais estreita): sem degrau entre a barra e os
 *  separadores (UX, 14 out). Devolve o `ref` do bloco e o estilo da camada. */
export function useGlassBehind(outerRef = null) {
  const own = useRef(null)
  const ref = outerRef || own
  const [edge, setEdge] = useState({ left: 0, right: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    const area = scrollParentOf(el)
    if (!el || !area) return undefined
    const measure = () => {
      const a = area.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      setEdge({ left: a.left - r.left, right: r.right - (a.left + area.clientWidth) })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [ref])
  return [ref, { ...GLASS_BELOW_STYLE, left: edge.left, right: edge.right }]
}

/** Os separadores de uma página com capa, presos logo por baixo da barra de
 *  vidro ao descer, «dentro do mesmo vidro» (SPEC, ponto 3). Tem de ser filho
 *  direto do contentor que desliza com eles (o sticky só prende dentro do
 *  pai). O vidro fica numa camada por trás, para o desvanecer não apagar os
 *  separadores. */
export function GlassPinned({ children, className = '', pinRef = null }) {
  const [ref, bg] = useGlassBehind(pinRef)
  return (
    <div ref={ref} className={`sticky isolate z-[9] -mx-4 px-4 pb-3 pt-1 ${className}`} style={{ top: GLASS_BAR_H, scrollMarginTop: GLASS_BAR_H }}>
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 -z-10" style={bg} />
      {children}
    </div>
  )
}
