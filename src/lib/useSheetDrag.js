import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Arrastar uma folha para baixo para a fechar (Renato, 17 out: no iPhone a
 * pessoa puxa a folha pela pega e nada acontecia). Só começa quando o
 * conteúdo da folha está no topo — a deslizar a lista não fecha nada.
 * Fecha a mais de 110 px ou com um puxão rápido; senão volta ao sítio.
 *
 * O Safari recarrega a página quando se puxa para baixo (pull-to-refresh).
 * Para o gesto ser só da folha, os toques são ouvidos à mão com
 * `passive: false` (os do React são passivos e não deixam preventDefault):
 * enquanto se arrasta a folha, e em qualquer toque no fundo escuro (que não
 * tem nada para deslizar), o Safari não chega a ver o puxão. Fora das folhas
 * o pull-to-refresh continua como sempre.
 *
 *   const drag = useSheetDrag(onClose)
 *   <div ref={drag.backdropRef} …>
 *     <div ref={drag.panelRef} style={drag.style} className="… overflow-y-auto overscroll-contain">
 */
export function useSheetDrag(onClose, { disabled = false } = {}) {
  const start = useRef(null)
  const dyRef = useRef(0)
  const [dy, setDy] = useState(0)
  const [dragging, setDragging] = useState(false)
  // A entrada da folha (animate-pop) tem fill-mode both e prende o transform:
  // depois do primeiro arrasto desliga-se, para o translateY valer (e não
  // volta a tocar quando a folha regressa ao sítio).
  const [moved, setMoved] = useState(false)
  const [panel, setPanel] = useState(null)
  const [backdrop, setBackdrop] = useState(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const disabledRef = useRef(disabled)
  disabledRef.current = disabled

  useEffect(() => {
    if (!panel) return undefined
    const onStart = (e) => {
      if (disabledRef.current || panel.scrollTop > 0) { start.current = null; return }
      start.current = { y: e.touches[0].clientY, t: Date.now() }
    }
    const onMove = (e) => {
      if (!start.current) return
      const d = e.touches[0].clientY - start.current.y
      if (d <= 0) {
        if (dyRef.current) { dyRef.current = 0; setDy(0); setDragging(false) }
        return
      }
      // A puxar para baixo com a folha no topo: o gesto é nosso, não do Safari.
      if (e.cancelable) e.preventDefault()
      if (!dyRef.current) { setDragging(true); setMoved(true) }
      dyRef.current = d
      setDy(d)
    }
    const onEnd = () => {
      if (!start.current) return
      const d = dyRef.current
      const fast = d > 40 && d / Math.max(1, Date.now() - start.current.t) > 0.6
      start.current = null
      dyRef.current = 0
      setDragging(false)
      setDy(0)
      if (d > 110 || fast) closeRef.current()
    }
    panel.addEventListener('touchstart', onStart, { passive: true })
    panel.addEventListener('touchmove', onMove, { passive: false })
    panel.addEventListener('touchend', onEnd)
    panel.addEventListener('touchcancel', onEnd)
    return () => {
      panel.removeEventListener('touchstart', onStart)
      panel.removeEventListener('touchmove', onMove)
      panel.removeEventListener('touchend', onEnd)
      panel.removeEventListener('touchcancel', onEnd)
    }
  }, [panel])

  // O fundo escuro não desliza: um puxão ali também não recarrega a página.
  useEffect(() => {
    if (!backdrop) return undefined
    const block = (e) => { if (e.target === backdrop && e.cancelable) e.preventDefault() }
    backdrop.addEventListener('touchmove', block, { passive: false })
    return () => backdrop.removeEventListener('touchmove', block)
  }, [backdrop])

  return {
    panelRef: useCallback((el) => setPanel(el), []),
    backdropRef: useCallback((el) => setBackdrop(el), []),
    style: {
      transform: dy ? `translateY(${dy}px)` : undefined,
      animation: moved ? 'none' : undefined,
      transition: dragging ? 'none' : 'transform 200ms cubic-bezier(0.22, 1, 0.36, 1)',
    },
  }
}
