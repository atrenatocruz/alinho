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

// O vidro cobre a margem do telemóvel (hora e bateria) e a linha dos botões
// inteira; só desvanece nos FADE px de baixo — com a margem do iPhone, um
// desvanecer em percentagem começava a meio dos botões e via-se o conteúdo
// nítido ao lado do nome (UX, 15 out).
const FADE = 24
const GLASS_BG = {
  background: `linear-gradient(to bottom, rgba(241,242,238,0.92) 0%, rgba(241,242,238,0.75) calc(100% - ${FADE}px), rgba(241,242,238,0) 100%)`,
  WebkitBackdropFilter: 'blur(10px)',
  backdropFilter: 'blur(10px)',
  WebkitMaskImage: `linear-gradient(to bottom, #000 calc(100% - ${FADE}px), transparent)`,
  maskImage: `linear-gradient(to bottom, #000 calc(100% - ${FADE}px), transparent)`,
}

// A faixa da hora e da bateria: o vidro cheio e só 8 px a desvanecer em baixo.
const STRIP_BG = {
  background: 'rgba(241,242,238,0.92)',
  WebkitBackdropFilter: 'blur(10px)',
  backdropFilter: 'blur(10px)',
  WebkitMaskImage: 'linear-gradient(to bottom, #000 calc(100% - 8px), transparent)',
  maskImage: 'linear-gradient(to bottom, #000 calc(100% - 8px), transparent)',
}

/** O contentor que desliza (o <main> da app; sem ele, a janela). */
export function scrollParentOf(el) {
  for (let n = el?.parentElement; n; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY
    if (oy === 'auto' || oy === 'scroll') return n
  }
  return null
}

/** A largura da área que desliza, sem a barra de deslizar do computador: a
 *  barra fica centrada com a coluna. Mede outra vez sempre que a área muda
 *  de largura — a barra de deslizar do computador só aparece quando a página
 *  cresce, e a coluna anda ~8 px; medida uma vez só, o «‹» ficava para dentro
 *  e o partilhar para fora (Francisco, 15 out). */
// useEffect e não useLayoutEffect: a GlassBar vem antes da capa na página, e
// no useLayoutEffect dela o ref da capa ainda não está ligado — a área saía
// nula e a barra ficava à largura da janela (só no build: em local o
// StrictMode corre os efeitos duas vezes e escondia isto — QA, 15 out).
function useScrollArea(anchorRef) {
  const [box, setBox] = useState(null)
  useEffect(() => {
    const area = scrollParentOf(anchorRef.current)
    // O vidro ocupa a área toda (de ponta a ponta da janela); os botões e o
    // nome alinham-se com o próprio `anchorRef` (a capa, ou o lugar da barra
    // nas páginas sem capa), 16 px para dentro. Assim seguem a largura de cada
    // página — a dos jogos entre amigos é mais estreita (QA, 15 out) — e nada
    // depende da barra de deslizar.
    const measure = () => {
      if (!area) { setBox({ left: 0, width: document.documentElement.clientWidth, colLeft: 0, colWidth: document.documentElement.clientWidth }); return }
      const r = area.getBoundingClientRect()
      const col = (anchorRef.current || area.firstElementChild || area).getBoundingClientRect()
      const next = { left: r.left, width: r.width, colLeft: col.left - r.left, colWidth: col.width }
      setBox((b) => (b && b.left === next.left && b.width === next.width && b.colLeft === next.colLeft && b.colWidth === next.colWidth ? b : next))
    }
    measure()
    window.addEventListener('resize', measure)
    const ro = area && typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    ro?.observe(area)
    // A barra de deslizar aparece quando o conteúdo cresce, sem mudar o
    // tamanho da área por fora: vigia-se também o conteúdo.
    if (ro && area.firstElementChild) ro.observe(area.firstElementChild)
    if (ro && anchorRef.current) ro.observe(anchorRef.current)
    // E ao deslizar, por garantia (medir é barato e só muda se mudou).
    area?.addEventListener('scroll', measure, { passive: true })
    return () => { window.removeEventListener('resize', measure); area?.removeEventListener('scroll', measure); ro?.disconnect() }
  }, [anchorRef])
  return box
}

/** true quando `targetRef` já chegou ao fundo da linha dos botões da barra
 *  (`rowRef`): é aí que o nome sobe para a barra e o vidro aparece, numa troca
 *  cruzada com o título grande (UX, 15 out — nunca se vê o título grande
 *  cortado a meio do vidro). Num título de várias linhas conta o topo da
 *  ÚLTIMA linha (`lastLine`): as de cima sobem como o resto do conteúdo, e o
 *  título só sai quando já só resta essa (UX — senão ficava um buraco).
 *  `edge: 'bottom'`: conta o fundo do alvo (a capa já saiu de baixo dos botões). */
export function useUnderBar(targetRef, rowRef, deps = [], { lastLine = false, edge = 'top' } = {}) {
  const [under, setUnder] = useState(false)
  useEffect(() => {
    const target = targetRef.current
    if (!target) return undefined
    const area = scrollParentOf(target)
    let raf = 0
    const read = () => {
      raf = 0
      const row = rowRef.current
      if (!row) return
      const r = target.getBoundingClientRect()
      let y = r.top
      if (edge === 'bottom') y = r.bottom
      else if (lastLine) {
        const lh = parseFloat(getComputedStyle(target).lineHeight)
        if (lh > 0) y = Math.max(r.top, r.bottom - lh)
      }
      setUnder(y < row.getBoundingClientRect().bottom)
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(read) }
    read()
    const scroller = area || window
    scroller.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => { scroller.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); if (raf) cancelAnimationFrame(raf) }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  return under
}

/** `show`: a barra está lá (os botões); `filled`: com o vidro por trás;
 *  `title`/`dot`: o nome ao centro, só com `showTitle`. `wide`: dois botões
 *  à direita (♡ e partilhar) — os dois lados ficam com a mesma largura, para
 *  o nome ficar mesmo ao centro. */
// `strip`: só a faixa da margem do telemóvel (hora e bateria) com vidro, para
// o conteúdo não passar nítido por baixo dela antes de o vidro todo entrar
// (UX, 15 out). Sem margem (computador, Android) tem 0 px e não se vê.
// `inner`: o recuo dos botões em relação à coluna — nas páginas cuja folha é
// mais estreita no computador, os círculos alinham com os cartões.
export default function GlassBar({ anchorRef, rowRef = null, show = true, filled = true, strip = false, showTitle = false, title, dot, left, right, wide = false, inner = 'px-4' }) {
  const box = useScrollArea(anchorRef)
  if (!box || typeof document === 'undefined') return null
  return createPortal(
    <div aria-hidden={!show || undefined}
      // Só os botões apanham os toques: o resto da barra deixa passar para a
      // página que está por baixo.
      className={`pointer-events-none fixed z-30 transition-opacity duration-fast ${show ? 'opacity-100' : 'opacity-0'}`}
      // No site de testes, logo por baixo da faixa laranja (--tb-h, index.css);
      // no alinho.pt não há faixa e fica colada em cima (UX, 15 out).
      style={{ top: 'var(--tb-h, 0px)', left: box.left, width: box.width }}>
      <div aria-hidden="true" className={`pointer-events-none absolute inset-x-0 top-0 transition-opacity duration-fast ${filled ? 'opacity-100' : 'opacity-0'}`}
        style={{ ...GLASS_BG, height: `calc(${GLASS_BAR_H} + ${FADE}px)` }} />
      <div aria-hidden="true" className={`pointer-events-none absolute inset-x-0 top-0 transition-opacity duration-fast ${strip && !filled ? 'opacity-100' : 'opacity-0'}`}
        style={{ ...STRIP_BG, height: `calc(${SAFE_TOP} + 8px)` }} />
      <div className={`relative ${inner}`} style={{ paddingTop: SAFE_TOP, marginLeft: box.colLeft, width: box.colWidth }}>
        <div ref={rowRef} className={`grid h-16 items-center gap-3 ${wide ? 'grid-cols-[minmax(92px,auto)_minmax(0,1fr)_minmax(92px,auto)]' : 'grid-cols-[42px_minmax(0,1fr)_42px]'}`}>
          <div className={`flex ${show ? 'pointer-events-auto' : ''}`}>{left}</div>
          <p aria-hidden={!showTitle} className={`flex min-w-0 items-center justify-center gap-2 text-base font-extrabold text-ink-900 transition-opacity duration-fast ${showTitle ? 'opacity-100' : 'opacity-0'}`}>
            {dot && <i aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />}
            <span className="min-w-0 truncate">{title}</span>
          </p>
          <div className={`flex justify-end gap-2 ${show ? 'pointer-events-auto' : ''}`}>{right}</div>
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
      setEdge({ left: a.left - r.left, right: r.right - a.right })
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
