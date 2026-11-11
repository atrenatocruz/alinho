// O cartaz em ecrã inteiro (#809, design-handoff/2026-11-11-torneio-cartaz-
// inteiro/SPEC.md): o aspeto do visualizador da foto de perfil
// (PhotoViewerModal, em ui.jsx), mais aproximar com dois dedos, com toque
// duplo (ou duplo clique) e com a roda do rato, e arrastar quando está
// aproximado. Fecha com o X, com um toque fora da imagem quando não está
// aproximado, com o «voltar» do telemóvel e com o Esc.
// O «voltar»: ao abrir junta-se uma entrada ao histórico com o mesmo endereço
// e o mesmo estado do React Router (a página não muda); o «voltar» tira-a e
// fecha. Fechar de outra forma volta atrás essa entrada.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { clampPan, clampScale, doubleTap, isDoubleTap, zoomAt } from '../lib/zoomPan'

const REST = { x: 0, y: 0, s: 1 }

export default function PosterViewer({ url, alt = '', onClose }) {
  const { t } = useTranslation()
  const boxRef = useRef(null)
  const imgRef = useRef(null)
  const [view, setView] = useState(REST)
  const viewRef = useRef(REST)
  const pointers = useRef(new Map()) // id → { x, y }
  const gesture = useRef(null) // { kind: 'pinch'|'pan', … }
  const lastTap = useRef(null)
  const moved = useRef(false)
  const downOnImage = useRef(false)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const pushed = useRef(false)

  const set = (v) => { viewRef.current = v; setView(v) }

  // As medidas da imagem ajustada e da caixa, e um ponto do ecrã a partir do centro.
  const measure = () => {
    const b = boxRef.current.getBoundingClientRect()
    const img = imgRef.current
    return { box: { w: img.offsetWidth, h: img.offsetHeight, W: b.width, H: b.height }, cx: b.left + b.width / 2, cy: b.top + b.height / 2 }
  }
  const fromCenter = (m, e) => ({ x: e.clientX - m.cx, y: e.clientY - m.cy })

  // O «voltar» do telemóvel (e do browser) e o Esc.
  useEffect(() => {
    // A marca evita duas entradas quando o efeito corre duas vezes (StrictMode).
    if (!window.history.state?.posterViewer) {
      window.history.pushState({ ...(window.history.state || {}), posterViewer: true }, '', window.location.href)
    }
    pushed.current = true
    const onPop = () => { pushed.current = false; closeRef.current() }
    const onKey = (e) => { if (e.key === 'Escape') close() }
    window.addEventListener('popstate', onPop)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('keydown', onKey)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function close() {
    if (pushed.current) window.history.back() // o popstate fecha
    else closeRef.current()
  }

  function onPointerDown(e) {
    // Visto antes de prender o ponteiro: depois disso o alvo passa a ser a caixa.
    downOnImage.current = !!imgRef.current?.contains(e.target)
    e.currentTarget.setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    moved.current = false
    const pts = [...pointers.current.values()]
    if (pts.length === 2) {
      gesture.current = { kind: 'pinch', d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), start: viewRef.current }
      moved.current = true
    } else if (pts.length === 1) {
      gesture.current = { kind: 'pan', x: e.clientX, y: e.clientY, start: viewRef.current }
    }
  }

  function onPointerMove(e) {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture.current
    if (!g || !imgRef.current) return
    const m = measure()
    if (g.kind === 'pinch') {
      const pts = [...pointers.current.values()]
      if (pts.length < 2) return
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      const mid = { clientX: (pts[0].x + pts[1].x) / 2, clientY: (pts[0].y + pts[1].y) / 2 }
      set(zoomAt(g.start, clampScale(g.start.s * (d / g.d)), fromCenter(m, mid), m.box))
    } else if (g.kind === 'pan') {
      const dx = e.clientX - g.x
      const dy = e.clientY - g.y
      if (Math.hypot(dx, dy) > 6) moved.current = true
      if (g.start.s > 1) set(clampPan({ x: g.start.x + dx, y: g.start.y + dy, s: g.start.s }, m.box))
    }
  }

  function onPointerUp(e) {
    const wasTap = gesture.current?.kind === 'pan' && !moved.current && pointers.current.size === 1
    pointers.current.delete(e.pointerId)
    // Um dedo levantado a meio do pinçar: o outro passa a arrastar dali.
    if (pointers.current.size === 1) {
      const [p] = [...pointers.current.values()]
      gesture.current = { kind: 'pan', x: p.x, y: p.y, start: viewRef.current }
      return
    }
    gesture.current = null
    if (!wasTap || !imgRef.current) return
    const tap = { t: e.timeStamp, x: e.clientX, y: e.clientY }
    if (isDoubleTap(lastTap.current, tap)) {
      lastTap.current = null
      const m = measure()
      set(doubleTap(viewRef.current, fromCenter(m, e), m.box))
      return
    }
    lastTap.current = tap
    // Um toque fora da imagem, sem estar aproximada, fecha.
    if (viewRef.current.s <= 1.05 && !downOnImage.current) close()
  }

  function onPointerCancel(e) {
    pointers.current.delete(e.pointerId)
    gesture.current = null
  }

  // No computador, a roda do rato (ou dois dedos no trackpad) aproxima.
  function onWheel(e) {
    if (!imgRef.current) return
    const m = measure()
    set(zoomAt(viewRef.current, viewRef.current.s * Math.exp(-e.deltaY / 300), fromCenter(m, e), m.box))
  }

  if (!url) return null
  return createPortal(
    <div ref={boxRef} role="dialog" aria-modal="true" aria-label={alt || undefined}
      className="fixed inset-0 z-50 select-none overflow-hidden bg-black/90 animate-fade-in"
      style={{ touchAction: 'none' }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel} onWheel={onWheel}>
      {/* O animate-pop fica na caixa: a animação usa transform e prende-o
          (fill both), o que travaria a aproximação na imagem. */}
      <div className="flex h-full w-full items-center justify-center animate-pop">
        <img ref={imgRef} src={url} alt={alt} draggable={false}
          className="max-h-full max-w-full object-contain"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`, transformOrigin: 'center', cursor: view.s > 1.05 ? 'grab' : 'zoom-in' }} />
      </div>
      <button type="button" aria-label={t('ui.close')}
        onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}
        onClick={close}
        // Fundo escuro (e não o branco a 10 % da foto de perfil): por cima de um
        // cartaz claro aproximado, o X branco desaparecia.
        className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-colors duration-fast hover:bg-black/70"
        style={{ marginTop: 'env(safe-area-inset-top)' }}>
        <X size={22} />
      </button>
    </div>,
    document.body
  )
}
