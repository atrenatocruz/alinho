// O fluxo de partilhar do torneio (SPEC-torneio.md, «O fluxo»):
//   1. «↗ Partilhar resultado» (quem chama)
//   2. «Juntar uma foto?» — Tirar foto agora · Escolher da galeria · Sem foto
//      (a foto fica só no telemóvel: não vai para a app)
//   3. Pré-visualização + «Texto (podes mudar)» + «Partilhar»
//   4. O QR leva à página do torneio, com a referência de quem partilhou.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Camera, Image as ImageIcon } from 'lucide-react'
import TournamentShareCard, { T_CARD_H, T_CARD_W, bakePhoto } from './TournamentShareCard'
import { qrDataUrl, readLocalPhoto, shareFilename, shareOrSaveImage } from '../../lib/shareImage'
import { tournamentUrl } from '../../lib/tournamentPublic'
import { useAuth } from '../../contexts/AuthContext'

const PREVIEW_SCALE = 0.62

export default function TournamentShareFlow({ tournament, variant, data, text, filenameParts = [], onClose }) {
  const { t } = useTranslation()
  const { profile } = useAuth()
  const [step, setStep] = useState('photo') // 'photo' | 'preview'
  const [photo, setPhoto] = useState(null)
  const [qr, setQr] = useState(null)
  const [caption, setCaption] = useState(text || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const cardRef = useRef(null)
  const cameraRef = useRef(null)
  const galleryRef = useRef(null)

  // O QR: a página do torneio, com a referência de quem partilhou.
  useEffect(() => {
    const url = `${tournamentUrl(tournament, window.location.origin)}${profile?.id ? `?ref=${profile.id}` : ''}`
    qrDataUrl(url, { size: 240 }).then(setQr).catch((err) => console.error('Error making the QR:', err))
  }, [tournament, profile?.id])

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true); setError('')
    try {
      const read = await readLocalPhoto(file)
      setPhoto(await bakePhoto(read.dataUrl))
      setStep('preview')
    } catch (err) {
      console.error('Error reading the photo:', err)
      setError(t('tshare.photo_error'))
    } finally { setBusy(false) }
  }

  const share = async () => {
    setBusy(true); setError(''); setSaved(false)
    try {
      const blob = await cardRef.current.exportPng()
      const out = await shareOrSaveImage(blob, { filename: shareFilename(...filenameParts), title: tournament?.name || '', text: caption })
      if (out === 'saved') setSaved(true)
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
        <div className="mx-auto overflow-hidden rounded-[14px] shadow-lift" style={{ width: T_CARD_W * PREVIEW_SCALE, height: T_CARD_H * PREVIEW_SCALE }}>
          <div style={{ transform: `scale(${PREVIEW_SCALE})`, transformOrigin: 'top left' }}>
            <TournamentShareCard ref={cardRef} variant={variant} data={data} photo={photo} qr={qr} />
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-gray-700">{t('tshare.text_label')}</p>
          <textarea rows={4} value={caption} onChange={(e) => setCaption(e.target.value)} className="input-field" />
        </div>
        {error && <p className="rounded-ctrl border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-extrabold text-danger">{error}</p>}
        <div>
          <button type="button" onClick={share} disabled={busy || !qr} className="btn-primary w-full disabled:opacity-40">
            {t('tshare.share')}
          </button>
          <p className="mt-1.5 text-center text-xs text-muted">{saved ? t('tshare.saved_hint') : t('tshare.share_hint')}</p>
        </div>
      </div>
    </div>,
    document.body,
  )
}
