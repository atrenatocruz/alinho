// O aviso preto no topo que some sozinho aos 3 s («✓ Obrigado. O resultado
// fica assim.»). Fica no Layout, por isso sobrevive a quem o pede: o sino
// fecha-se logo a seguir a «Está certo» e o aviso continua à vista.
// Chama-se com showAppToast(texto), de qualquer sítio.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'

const EVENT = 'alinho:toast'

export function showAppToast(text) {
  if (text) window.dispatchEvent(new CustomEvent(EVENT, { detail: text }))
}

export default function AppToast() {
  const [toast, setToast] = useState(null) // { text, n }
  useEffect(() => {
    let n = 0
    const on = (e) => setToast({ text: e.detail, n: ++n })
    window.addEventListener(EVENT, on)
    return () => window.removeEventListener(EVENT, on)
  }, [])
  useEffect(() => {
    if (!toast) return undefined
    const id = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(id)
  }, [toast])
  if (!toast) return null
  return createPortal(
    <div key={toast.n} role="status" className="fixed top-4 left-1/2 z-[70] -translate-x-1/2 w-max max-w-[calc(100vw-32px)] rounded-full bg-ink-900 px-4 py-2.5 text-sm font-extrabold text-white shadow-lift animate-fade-in">
      <Check size={16} className="-mt-0.5 mr-1.5 inline shrink-0" />
      {toast.text}
    </div>,
    document.body,
  )
}
