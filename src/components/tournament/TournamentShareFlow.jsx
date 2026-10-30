// O fluxo de partilhar do torneio (SPEC-torneio.md, «O fluxo»):
//   1. «↗ Partilhar resultado» (quem chama)
//   2. «Juntar uma foto?» — Tirar foto agora · Escolher da galeria · Sem foto
//      (a foto fica só no telemóvel: não vai para a app)
//   3. Pré-visualização (com a foto ajustável: arrastar posiciona, pinça/
//      roda do rato/slider faz zoom — Ruben, 30 out) + «Texto» + «Partilhar»
// O QR saiu das partilhas a 30 out (Ruben: «não faz sentido»).
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Camera, Image as ImageIcon } from 'lucide-react'
import TournamentShareCard, { PHOTO_H, T_CARD_H, T_CARD_W, bakeCircle, bakePhoto, bakeImageUrl } from './TournamentShareCard'
import { readLocalPhoto, shareFilename, shareOrSaveImage } from '../../lib/shareImage'

const PREVIEW_SCALE = 0.62

/* #622 (vencedores em todos os jogos), tudo opcional: `shareTitle`, `org` e
   `children` (passam ao cartão) e `fallbackImage` (a imagem do mix, que
   entra no lugar da foto quando se escolhe «Sem foto»). */
export default function TournamentShareFlow({ tournament, variant, data, text, filenameParts = [], onClose,
  shareTitle = null, org = null, fallbackImage = null, children = null }) {
  const { t } = useTranslation()
  const [step, setStep] = useState('photo') // 'photo' | 'preview'
  const [photo, setPhoto] = useState(null) // a foto já cozida (bakePhoto)
  // O ajuste da foto (Ruben, 30 out): a original fica em `raw` e coze-se de
  // novo a cada gesto — o cartão continua a receber píxeis prontos, que é o
  // que o WebKit rasteriza sem estragar.
  const [raw, setRaw] = useState(null)
  const [adj, setAdj] = useState({ zoom: 1, ox: 0.5, oy: 0.5 })
  const [caption, setCaption] = useState(text || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const cardRef = useRef(null)
  // O clube por baixo do logótipo, como nos outros cartões (#622, UX 12
  // out): o logótipo num círculo (ou as iniciais), o nome e, pequeno,
  // «<torneio> · <categoria>». Quem passa `org` (o mix) manda no seu.
  const [clubLogo, setClubLogo] = useState(null)
  useEffect(() => {
    if (org || !tournament?.club_logo_url) return undefined
    let alive = true
    bakeCircle(tournament.club_logo_url).then((v) => { if (alive) setClubLogo(v) })
    return () => { alive = false }
  }, [org, tournament?.club_logo_url])
  const cardOrg = org || (tournament?.club_name ? {
    name: tournament.club_name,
    logo: clubLogo,
    initials: tournament.club_name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase(),
    sub: data?.orgSub || tournament.name || '',
  } : null)
  const cameraRef = useRef(null)
  const galleryRef = useRef(null)

  // A imagem do mix, já cortada como a foto, para o «Sem foto».
  const [fallback, setFallback] = useState(null)
  useEffect(() => {
    let alive = true
    bakeImageUrl(fallbackImage).then((v) => { if (alive) setFallback(v) })
    return () => { alive = false }
  }, [fallbackImage])

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true); setError('')
    try {
      const read = await readLocalPhoto(file)
      const start = { zoom: 1, ox: 0.5, oy: 0.5 }
      setRaw(read.dataUrl)
      setAdj(start)
      setPhoto(await bakePhoto(read.dataUrl, start))
      setStep('preview')
    } catch (err) {
      console.error('Error reading the photo:', err)
      setError(t('tshare.photo_error'))
    } finally { setBusy(false) }
  }

  // Coze de novo quando o ajuste muda (o canvas é barato; o último ganha).
  useEffect(() => {
    if (!raw) return undefined
    let alive = true
    bakePhoto(raw, adj).then((v) => { if (alive) setPhoto(v) }).catch(() => {})
    return () => { alive = false }
  }, [raw, adj])

  // Gestos sobre a zona da foto no preview: 1 dedo arrasta (posição), 2
  // dedos pinçam (zoom); no computador, a roda do rato também faz zoom.
  const pointers = useRef(new Map())
  const pinchStart = useRef(null)
  const clamp01 = (v) => Math.min(Math.max(v, 0), 1)
  const clampZoom = (v) => Math.min(Math.max(v, 1), 3)
  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinchStart.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: adj.zoom }
    }
  }
  const onPointerMove = (e) => {
    const prev = pointers.current.get(e.pointerId)
    if (!prev) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      setAdj((v) => ({ ...v, zoom: clampZoom(pinchStart.current.zoom * (dist / pinchStart.current.dist)) }))
    } else if (pointers.current.size === 1) {
      // 150 px de arrasto percorrem a folga toda — previsível a qualquer zoom.
      setAdj((v) => ({ ...v, ox: clamp01(v.ox - (e.clientX - prev.x) / 150), oy: clamp01(v.oy - (e.clientY - prev.y) / 150) }))
    }
  }
  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinchStart.current = null
  }
  const onWheel = (e) => {
    e.preventDefault()
    setAdj((v) => ({ ...v, zoom: clampZoom(v.zoom * (e.deltaY < 0 ? 1.06 : 1 / 1.06)) }))
  }

  const share = async () => {
    setBusy(true); setError(''); setSaved(false)
    try {
      const blob = await cardRef.current.exportPng()
      const out = await shareOrSaveImage(blob, { filename: shareFilename(...filenameParts), title: shareTitle ?? tournament?.name ?? '', text: caption })
      if (out === 'saved') setSaved(true)
      // Enviado pela folha de partilha: fecha e volta à página de onde se veio
      // (#742). Se fechou a folha sem enviar, fica para tentar outra vez.
      if (out === 'shared') { onClose(); return }
    } catch (err) {
      console.error('Error sharing the card:', err)
      setError(t('tshare.share_error'))
    } finally { setBusy(false) }
  }

  const inputs = (
    <>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
      <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
    </>
  )

  if (step === 'photo') {
    // A janela de baixo da app (como a ConfirmSheet), com os três botões do
    // desenho: Tirar foto agora (preto) · Escolher da galeria · Sem foto.
    return createPortal(
      <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 animate-fade-in sm:items-center sm:p-4" onClick={() => { if (!busy) onClose() }}>
        <div role="dialog" aria-modal="true" aria-labelledby="share-photo-title"
          className="w-full max-w-md rounded-t-[24px] bg-white px-5 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+20px)] shadow-lift sm:rounded-[24px]"
          onClick={(e) => e.stopPropagation()}>
          <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-ink-200" />
          <p id="share-photo-title" className="text-[20px] font-extrabold leading-tight text-ink-900">{t('tshare.photo_title')}</p>
          <p className="mt-2 text-[15px] leading-snug text-ink-500">{t('tshare.photo_body')}</p>
          {inputs}
          <div className="mt-4 space-y-2">
            <button type="button" disabled={busy} onClick={() => cameraRef.current?.click()}
              className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-ctrl bg-ink-900 px-4 text-[15px] font-extrabold text-white disabled:opacity-40">
              <Camera size={18} /> {t('tshare.photo_camera')}
            </button>
            <button type="button" disabled={busy} onClick={() => galleryRef.current?.click()}
              className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-ctrl border-[1.5px] border-line bg-white px-4 text-[15px] font-extrabold text-ink-900 disabled:opacity-40">
              <ImageIcon size={18} /> {t('tshare.photo_gallery')}
            </button>
            <button type="button" disabled={busy} onClick={() => { setPhoto(null); setStep('preview') }}
              className="w-full min-h-[44px] px-4 text-[15px] font-extrabold text-ink-700 disabled:opacity-40">
              {t('tshare.photo_none')}
            </button>
            {error && <p className="text-sm font-extrabold text-danger">{error}</p>}
          </div>
        </div>
      </div>,
      document.body,
    )
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-canvas">
      <div className="mx-auto max-w-lg space-y-4 px-4 pb-10 pt-4">
        <button type="button" onClick={() => setStep('photo')} className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-extrabold text-ink-700">
          <ArrowLeft size={20} /> {t('common.back')}
        </button>
        <h2 className="text-3xl text-ink-900">{t('tshare.preview_title')}</h2>
        {/* O cartão a sério, reduzido só no ecrã: o que se exporta é o de 360 × 640. */}
        <div className="relative mx-auto overflow-hidden rounded-[14px] shadow-lift" style={{ width: T_CARD_W * PREVIEW_SCALE, height: T_CARD_H * PREVIEW_SCALE }}>
          <div style={{ transform: `scale(${PREVIEW_SCALE})`, transformOrigin: 'top left' }}>
            <TournamentShareCard ref={cardRef} variant={variant} data={data} photo={photo || fallback} org={cardOrg}>{children}</TournamentShareCard>
          </div>
          {/* A zona da foto aceita gestos (só com foto escolhida). */}
          {raw && photo && (
            <div className="absolute left-0 top-0 w-full cursor-move touch-none"
              style={{ height: PHOTO_H * PREVIEW_SCALE }}
              onPointerDown={onPointerDown} onPointerMove={onPointerMove}
              onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onWheel={onWheel} />
          )}
        </div>
        {raw && photo && (
          <div className="mx-auto" style={{ width: T_CARD_W * PREVIEW_SCALE }}>
            <p className="text-center text-xs text-muted">{t('tshare.adjust_hint')}</p>
            <input type="range" min="1" max="3" step="0.05" value={adj.zoom}
              aria-label={t('tshare.zoom_label')}
              onChange={(e) => setAdj((v) => ({ ...v, zoom: Number(e.target.value) }))}
              className="mt-1.5 w-full accent-ink-900" />
          </div>
        )}
        <div>
          <p className="mb-2 text-sm font-medium text-gray-700">{t('tshare.text_label')}</p>
          <textarea rows={4} value={caption} onChange={(e) => setCaption(e.target.value)} className="input-field" />
        </div>
        {error && <p className="rounded-ctrl border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-extrabold text-danger">{error}</p>}
        <div>
          <button type="button" onClick={share} disabled={busy} className="btn-primary w-full disabled:opacity-40">
            {t('tshare.share')}
          </button>
          <p className="mt-1.5 text-center text-xs text-muted">{saved ? t('tshare.saved_hint') : t('tshare.share_hint')}</p>
        </div>
      </div>
    </div>,
    document.body,
  )
}
