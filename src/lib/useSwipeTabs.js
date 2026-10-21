import { useEffect, useRef } from 'react'
import { startsAtEdge, lockDirection, neighbour, followOffset, shouldSwitch } from './swipeTabs'

/* O gesto de deslizar entre os separadores do menu de baixo (plano em
   notas-entre-devs/2026-10-19-deslizar-separadores/PLANO.md). Só nos ecrãs
   do menu (`paths`); nunca muda os separadores de dentro de uma página.

   Não conta (PLANO, «Quando não conta»): nos 24 px de cada borda, quando o
   dedo começa em algo que já desliza para o lado (filtros, caras, capas,
   mapas, gráfico), na pílula dos separadores, num campo de escrever, ou com
   uma folha aberta.

   Animação (UX): durante, a página vai com o dedo, mais devagar, até 25%.
   Ao largar, passado o limite, a página de agora sai ~30% para o lado do
   gesto a apagar-se e a nova entra de ~30% a aparecer, 220 ms, com a curva
   das folhas, ao mesmo tempo (a que sai é uma cópia por cima). Não passou:
   volta ao sítio em 160 ms. Pontas: ressalto de 12 px. «Reduzir movimento»:
   muda sem animação. A posição de cada ecrã guarda-se em `tops`. */

const CURVE = 'cubic-bezier(0.22, 1, 0.36, 1)' // a das folhas (useSheetDrag)
const IN_MS = 220
const BACK_MS = 160
// Lista juntada com a versão do Bugs (19 out): o gráfico é role="slider" e os
// sítios sem papel próprio marcam-se com data-no-tab-swipe.
const NO_SWIPE = 'input, textarea, select, [contenteditable="true"], [role=tablist], [role="slider"], [data-no-swipe], [data-no-tab-swipe], .leaflet-container, canvas'

function reducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

/** Algum elemento entre o dedo e a página já desliza para o lado? */
function scrollsSideways(target, stop) {
  for (let el = target; el && el !== stop; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 2) {
      const ox = getComputedStyle(el).overflowX
      if (ox === 'auto' || ox === 'scroll') return true
    }
  }
  return false
}

function sheetOpen() {
  // As folhas sem role (as antigas) são as fixed inset-0 z-50.
  return !!document.querySelector('[aria-modal="true"], [role="dialog"], .fixed.inset-0.z-50') || document.body.hasAttribute('data-steps')
}

export function useSwipeTabs({ mainRef, contentRef, paths, current, onSwitch }) {
  const tops = useRef(new Map())
  const live = useRef({ paths, current, onSwitch })
  live.current = { paths, current, onSwitch }

  // A posição de cada ecrã, para voltar a ela quando se chega por um deslize.
  useEffect(() => {
    const main = mainRef.current
    if (!main || !paths.includes(current)) return
    const save = () => tops.current.set(current, main.scrollTop)
    main.addEventListener('scroll', save, { passive: true })
    return () => { save(); main.removeEventListener('scroll', save) }
  }, [mainRef, current, paths])

  useEffect(() => {
    const main = mainRef.current
    if (!main) return
    let g = null // o gesto em curso

    const setX = (x, ms) => {
      const el = contentRef.current
      if (!el) return
      // A entrada da página (animate-fade-up, com «both») prende o transform: tira-se.
      el.style.animation = 'none'
      el.style.transition = ms ? `transform ${ms}ms ${CURVE}, opacity ${ms}ms ${CURVE}` : 'none'
      el.style.transform = x ? `translate3d(${x}px,0,0)` : ''
    }

    const onStart = (e) => {
      g = null
      const { paths: ps, current: cur } = live.current
      if (e.touches.length !== 1 || !ps.includes(cur)) return
      const t = e.touches[0]
      const width = main.clientWidth
      if (startsAtEdge(t.clientX, window.innerWidth)) return
      if (e.target.closest?.(NO_SWIPE) || scrollsSideways(e.target, main) || sheetOpen()) return
      g = { x0: t.clientX, y0: t.clientY, dx: 0, dy: 0, dir: null, width }
    }

    const onMove = (e) => {
      if (!g) return
      const t = e.touches[0]
      g.dx = t.clientX - g.x0
      g.dy = t.clientY - g.y0
      if (!g.dir) g.dir = lockDirection(g.dx, g.dy)
      if (g.dir === 'v') { g = null; return }
      if (g.dir !== 'h') return
      e.preventDefault() // o dedo está a ir para o lado: a lista não desce
      const { paths: ps, current: cur } = live.current
      const next = neighbour(ps, cur, g.dx)
      if (!reducedMotion()) setX(followOffset(g.dx, g.width, !!next), 0)
    }

    const onEnd = () => {
      if (!g || g.dir !== 'h') { g = null; return }
      const { paths: ps, current: cur, onSwitch: go } = live.current
      const next = neighbour(ps, cur, g.dx)
      const dx = g.dx
      const dy = g.dy
      g = null
      if (!shouldSwitch(dx, dy, !!next)) { setX(0, reducedMotion() ? 0 : BACK_MS); return }

      const top = tops.current.get(next) ?? 0
      if (reducedMotion()) { setX(0, 0); go(next, top); return }

      // A página de agora sai: uma cópia por cima, que desliza e se apaga.
      const el = contentRef.current
      const box = main.getBoundingClientRect()
      const ghost = el.cloneNode(true)
      ghost.setAttribute('aria-hidden', 'true')
      const shift = Math.sign(dx) * box.width * 0.3
      Object.assign(ghost.style, {
        position: 'fixed', left: `${el.getBoundingClientRect().left}px`, top: `${el.getBoundingClientRect().top}px`,
        width: `${el.offsetWidth}px`, margin: '0', pointerEvents: 'none', zIndex: '10', animation: 'none',
        transition: `transform ${IN_MS}ms ${CURVE}, opacity ${IN_MS}ms ${CURVE}`,
      })
      const clip = document.createElement('div')
      Object.assign(clip.style, { position: 'fixed', left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, overflow: 'hidden', pointerEvents: 'none', zIndex: '10', background: 'var(--ground, #F1F2EE)' })
      ghost.style.left = `${el.getBoundingClientRect().left - box.left}px`
      ghost.style.top = `${el.getBoundingClientRect().top - box.top}px`
      ghost.style.position = 'absolute'
      clip.appendChild(ghost)
      document.body.appendChild(clip)

      // A nova entra do outro lado, a aparecer.
      go(next, top)
      requestAnimationFrame(() => {
        const fresh = contentRef.current
        if (fresh) {
          fresh.style.animation = 'none'
          fresh.style.transition = 'none'
          fresh.style.transform = `translate3d(${-shift}px,0,0)`
          fresh.style.opacity = '0'
        }
        requestAnimationFrame(() => {
          clip.style.background = 'transparent'
          ghost.style.transform = `translate3d(${shift}px,0,0)`
          ghost.style.opacity = '0'
          if (fresh) {
            fresh.style.transition = `transform ${IN_MS}ms ${CURVE}, opacity ${IN_MS}ms ${CURVE}`
            fresh.style.transform = ''
            fresh.style.opacity = ''
          }
          // Arruma quando a cópia acaba de sair (com uma rede, se o evento não vier).
          let done = false
          const tidy = () => { if (done) return; done = true; clip.remove(); if (fresh) fresh.style.transition = '' }
          ghost.addEventListener('transitionend', tidy, { once: true })
          setTimeout(tidy, IN_MS * 4)
        })
      })
    }

    main.addEventListener('touchstart', onStart, { passive: true })
    main.addEventListener('touchmove', onMove, { passive: false })
    main.addEventListener('touchend', onEnd, { passive: true })
    main.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      main.removeEventListener('touchstart', onStart)
      main.removeEventListener('touchmove', onMove)
      main.removeEventListener('touchend', onEnd)
      main.removeEventListener('touchcancel', onEnd)
    }
  }, [mainRef, contentRef])
}
