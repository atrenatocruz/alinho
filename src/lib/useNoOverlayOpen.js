import { useEffect, useState } from 'react'

// Há alguma folha ou janela aberta por cima da página? As folhas da app são
// todas `fixed inset-0` (Sheet, ConfirmSheet, as do mix, do torneio, das
// aulas…) ou dizem role="dialog". Serve para uma janela que aparece sozinha
// (ex.: a conquista nova) esperar a sua vez, em vez de abrir por cima de uma
// pergunta que a pessoa tem à frente (PO, 11 out).
const OVERLAY_SELECTOR = '.fixed.inset-0, [role="dialog"], [aria-modal="true"]'

export const overlayOpen = () =>
  typeof document !== 'undefined' && document.querySelector(OVERLAY_SELECTOR) != null

/** true quando não há nenhuma folha aberta; volta a ver sempre que o DOM muda. */
export function useNoOverlayOpen(enabled = true) {
  const [free, setFree] = useState(() => !overlayOpen())
  useEffect(() => {
    if (!enabled) return undefined
    const check = () => setFree(!overlayOpen())
    check()
    const obs = new MutationObserver(check)
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'role'] })
    return () => obs.disconnect()
  }, [enabled])
  return free
}
