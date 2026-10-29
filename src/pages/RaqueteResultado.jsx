import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { BackBar, PrimaryButton, LoadErrorState } from '../components/ui'
import RaqueteCard, { BestRaqueteCard, RaqueteFicha, RaqueteName } from '../components/raquete/RaqueteCard'
import { loadMyPick, mergePickWithCatalog } from '../lib/raquete'
import { fitSentence } from '../lib/raqueteView'

/* «As tuas 3 raquetes» (design-handoff/2026-10-27-raquete, aprovado pelo
   Francisco a 27 out). Sem resultado guardado, vai direto às perguntas. O
   preço, a foto e o stock vêm do catálogo de hoje (mergePickWithCatalog). Por
   baixo do título, para que jogo; a melhor com tudo; as outras duas abrem a
   mesma ficha numa folha de baixo. */
export default function RaqueteResultado() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [items, setItems] = useState(null)
  const [answers, setAnswers] = useState(null)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(null)

  useEffect(() => {
    let stale = false
    loadMyPick()
      .then((res) => {
        if (stale) return
        if (!res) navigate('/perfil/raquete/perguntas', { replace: true })
        else {
          setItems(mergePickWithCatalog(res.pick, res.rackets))
          setAnswers(res.pick.answers ?? null)
        }
      })
      .catch(() => { if (!stale) setFailed(true) })
    return () => { stale = true }
  }, [navigate])

  if (failed) return <LoadErrorState title={t('raquete.err_generic')} />
  if (!items) return null

  const anySoldOut = items.some((x) => x.soldOut)
  const fit = fitSentence(answers, t, i18n.language)
  const [best, ...others] = items

  return (
    <div className="space-y-3 pb-6">
      <BackBar onBack={() => navigate('/perfil')} title={t('raquete.title')} />
      <div>
        <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted">{t('raquete.kicker')}</p>
        <h1 className="font-display text-[28px] font-extrabold leading-tight text-ink-900">{t('raquete.title')}</h1>
        {fit && <p className="mt-1 text-[14px] leading-snug text-ink-700">{fit}</p>}
      </div>

      {anySoldOut && <p className="rounded-ctrl bg-amber-50 p-3 text-[13px] text-ink-900">{t('raquete.sold_out_hint')}</p>}

      {best && <BestRaqueteCard item={best} />}
      {others.map((item) => <RaqueteCard key={item.id} item={item} onOpen={() => setOpen(item)} />)}

      <p className="px-1 text-[12px] leading-snug text-muted">{t('raquete.footer')}</p>

      <PrimaryButton variant="ghost" className="w-full" onClick={() => navigate('/perfil/raquete/perguntas')}>
        {t('raquete.redo')}
      </PrimaryButton>

      {open && <RaqueteFolha item={open} t={t} onClose={() => setOpen(null)} />}
    </div>
  )
}

// A ficha completa, numa folha de baixo que rola (as fichas podem ser longas).
function RaqueteFolha({ item, t, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 animate-fade-in sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="raquete-folha-title"
        className="flex max-h-[88dvh] w-full max-w-md flex-col rounded-t-[24px] bg-white px-5 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+20px)] shadow-lift sm:rounded-[24px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-9 shrink-0 rounded-full bg-ink-200" />
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          <div className="flex items-center gap-3">
            <span className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-ctrl bg-[#F4F5F1]">
              {item.racket?.image_url && <img src={item.racket.image_url} alt="" className="h-full w-full object-contain p-2 mix-blend-multiply" />}
            </span>
            <span id="raquete-folha-title" className="min-w-0"><RaqueteName racket={item.racket} /></span>
          </div>
          <RaqueteFicha item={item} />
        </div>
        <PrimaryButton variant="ghost" className="mt-3 w-full shrink-0" onClick={onClose}>{t('raquete.close')}</PrimaryButton>
      </div>
    </div>,
    document.body,
  )
}
