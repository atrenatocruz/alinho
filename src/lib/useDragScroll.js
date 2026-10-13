import { useEffect, useRef } from 'react'

/** Arrastar com o rato as filas que deslizam, como o dedo no telemóvel
 *  (SPEC-1, ponto 5). Um arrasto não conta como toque no que está por baixo.
 *  A roda do rato também a faz deslizar para o lado (R4, 13 out) — só
 *  enquanto houver para onde ir; no fim, a roda volta a descer a página. */
export function useDragScroll() {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    let down = null
    let moved = false
    const onDown = (e) => { if (e.pointerType !== 'mouse' || e.button !== 0) return; down = { x: e.clientX, left: el.scrollLeft }; moved = false }
    const onMove = (e) => {
      if (!down) return
      const dx = e.clientX - down.x
      if (Math.abs(dx) > 4) moved = true
      if (moved) el.scrollLeft = down.left - dx
    }
    const onUp = () => { down = null }
    const onClick = (e) => { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false } }
    const onWheel = (e) => {
      if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      const max = el.scrollWidth - el.clientWidth
      if (max <= 0) return
      const next = Math.min(max, Math.max(0, el.scrollLeft + e.deltaY))
      if (next === el.scrollLeft) return
      e.preventDefault()
      el.scrollLeft = next
    }
    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    el.addEventListener('click', onClick, true)
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      el.removeEventListener('click', onClick, true)
      el.removeEventListener('wheel', onWheel)
    }
  }, [])
  return ref
}
