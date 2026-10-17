import { useRef, useState } from 'react'

/**
 * Arrastar uma folha para baixo para a fechar (Renato, 17 out: no iPhone a
 * pessoa puxa a folha pela pega e nada acontecia). Só começa quando o
 * conteúdo da folha está no topo — a deslizar a lista não fecha nada.
 * Fecha a mais de 110 px ou com um puxão rápido; senão volta ao sítio.
 *
 *   const drag = useSheetDrag(onClose)
 *   <div {...drag.bind} style={drag.style} className="… overflow-y-auto overscroll-contain">
 */
export function useSheetDrag(onClose, { disabled = false } = {}) {
  const start = useRef(null)
  const [dy, setDy] = useState(0)
  const [dragging, setDragging] = useState(false)
  // A entrada da folha (animate-pop) tem fill-mode both e prende o transform:
  // depois do primeiro arrasto desliga-se, para o translateY valer (e não
  // volta a tocar quando a folha regressa ao sítio).
  const [moved, setMoved] = useState(false)

  const onTouchStart = (e) => {
    if (disabled || e.currentTarget.scrollTop > 0) { start.current = null; return }
    start.current = { y: e.touches[0].clientY, t: Date.now() }
  }
  const onTouchMove = (e) => {
    if (!start.current) return
    const d = e.touches[0].clientY - start.current.y
    if (d <= 0) { if (dragging) { setDy(0); setDragging(false) } return }
    if (!dragging) { setDragging(true); setMoved(true) }
    setDy(d)
  }
  const onTouchEnd = () => {
    if (!start.current) return
    const fast = dy > 40 && dy / Math.max(1, Date.now() - start.current.t) > 0.6
    start.current = null
    setDragging(false)
    if (dy > 110 || fast) { setDy(0); onClose() } else setDy(0)
  }

  return {
    bind: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd },
    style: {
      transform: dy ? `translateY(${dy}px)` : undefined,
      animation: moved ? 'none' : undefined,
      transition: dragging ? 'none' : 'transform 200ms cubic-bezier(0.22, 1, 0.36, 1)',
    },
  }
}
