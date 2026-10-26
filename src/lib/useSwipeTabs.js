import { useEffect, useRef } from 'react'
import { lockDirection, neighbour, followOffset, shouldSwitch } from './swipeTabs'

/* O gesto de deslizar entre os separadores do menu de baixo (plano em
   notas-entre-devs/2026-10-19-deslizar-separadores/PLANO.md). Só nos ecrãs
   do menu (`paths`); nunca muda os separadores de dentro de uma página.

   Só com o dedo EM CIMA do menu de baixo (`areaRef`), Francisco, 23 out:
   «Fica só em cima do menu. Não na pág.» Na página não faz nada, por isso
   já não são precisas as exceções das bordas, dos filtros e das caras. Um
   toque normal nos ícones continua a ser um toque: só depois de o dedo
   andar claramente para o lado é que o clique que se segue é engolido.
   Com uma folha aberta também não conta.

   Animação (UX): durante, a página vai com o dedo, mais devagar, até 25%.
   Ao largar, passado o limite, a página de agora sai ~30% para o lado do
   gesto a apagar-se e a nova entra de ~30% a aparecer, 220 ms, com a curva
   das folhas, ao mesmo tempo (a que sai é uma cópia por cima). Não passou:
   volta ao sítio em 160 ms. Pontas: ressalto de 12 px. «Reduzir movimento»:
   muda sem animação. A posição de cada ecrã guarda-se em `tops`. */

const CURVE = 'cubic-bezier(0.22, 1, 0.36, 1)' // a das folhas (useSheetDrag)
const IN_MS = 220
const BACK_MS = 160

function reducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

function sheetOpen() {
  // As folhas sem role (as antigas) são as fixed inset-0 z-50.
  return !!document.querySelector('[aria-modal="true"], [role="dialog"], .fixed.inset-0.z-50') || document.body.hasAttribute('data-steps')
}

export function useSwipeTabs({ mainRef, contentRef, areaRef, pillRef, paths, current, onSwitch }) {
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
    const area = areaRef.current
    if (!main || !area) return
    let g = null // o gesto em curso
    let swallowClick = false // depois de um deslize, o «clique» do fim não abre o ícone

    // A pastilha lima acompanha o dedo (no máximo meio item para cada lado).
    const setPill = (x, ms) => {
      const pill = pillRef?.current
      if (!pill) return
      pill.style.transition = ms ? `transform ${ms}ms ${CURVE}` : 'none'
      pill.style.transform = x ? `translate3d(${x}px,0,0)` : ''
    }

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
      if (sheetOpen()) return
      swallowClick = false
      g = { x0: t.clientX, y0: t.clientY, dx: 0, dy: 0, dir: null, width: main.clientWidth, item: area.clientWidth / Math.max(1, ps.length) }
    }

    const onMove = (e) => {
      if (!g) return
      const t = e.touches[0]
      g.dx = t.clientX - g.x0
      g.dy = t.clientY - g.y0
      if (!g.dir) g.dir = lockDirection(g.dx, g.dy)
      if (g.dir === 'v') { g = null; return }
      if (g.dir !== 'h') return
      e.preventDefault() // o dedo está a ir para o lado
      swallowClick = true
      const { paths: ps, current: cur } = live.current
      const next = neighbour(ps, cur, g.dx)
      if (!reducedMotion()) {
        setX(followOffset(g.dx, g.width, !!next), 0)
        // O menu anda no sentido do dedo; a página no contrário (puxa-se a seguinte).
        setPill(next ? -Math.sign(g.dx) * Math.min(Math.abs(g.dx) * 0.5, g.item / 2) : 0, 0)
      }
    }

    const onEnd = () => {
      if (!g || g.dir !== 'h') { g = null; return }
      const { paths: ps, current: cur, onSwitch: go } = live.current
      const next = neighbour(ps, cur, g.dx)
      const dx = g.dx
      const dy = g.dy
      g = null
      setPill(0, reducedMotion() ? 0 : BACK_MS)
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

    // Um deslize não pode virar toque: o clique que vem a seguir é engolido.
    const onClick = (e) => {
      if (!swallowClick) return
      swallowClick = false
      e.preventDefault()
      e.stopPropagation()
    }

    area.addEventListener('touchstart', onStart, { passive: true })
    area.addEventListener('touchmove', onMove, { passive: false })
    area.addEventListener('touchend', onEnd, { passive: true })
    area.addEventListener('touchcancel', onEnd, { passive: true })
    area.addEventListener('click', onClick, true)
    return () => {
      area.removeEventListener('touchstart', onStart)
      area.removeEventListener('touchmove', onMove)
      area.removeEventListener('touchend', onEnd)
      area.removeEventListener('touchcancel', onEnd)
      area.removeEventListener('click', onClick, true)
    }
  }, [mainRef, contentRef, areaRef, pillRef])
}
