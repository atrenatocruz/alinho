import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { BackBar, PrimaryButton, LoadErrorState } from '../components/ui'
import RaqueteCard, { formatPrice, specPills } from '../components/raquete/RaqueteCard'
import { loadMyPick, mergePickWithCatalog } from '../lib/raquete'

/* «As tuas 3 raquetes» (spec docs/superpowers/specs/2026-10-27-escolher-raquete-design.md,
   mockup v2 ecrã 3). Sem resultado guardado, vai direto às perguntas. O preço,
   a foto e o stock vêm do catálogo de hoje (mergePickWithCatalog). Cada cartão
   abre a ficha completa numa folha de baixo. */
export default function RaqueteResultado() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [items, setItems] = useState(null)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(null)

  useEffect(() => {
    let stale = false
    loadMyPick()
      .then((res) => {
        if (stale) return
        if (!res) navigate('/perfil/raquete/perguntas', { replace: true })
        else setItems(mergePickWithCatalog(res.pick, res.rackets))
      })
      .catch(() => { if (!stale) setFailed(true) })
    return () => { stale = true }
  }, [navigate])

  if (failed) return <LoadErrorState title={t('raquete.err_generic')} />
  if (!items) return null

  const anySoldOut = items.some((x) => x.soldOut)

  return (
    <div className="space-y-3 pb-6">
      <BackBar onBack={() => navigate('/perfil')} title={t('raquete.title')} />
      <div>
        <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted">{t('raquete.kicker')}</p>
        <h1 className="font-display text-[28px] font-extrabold leading-tight text-ink-900">{t('raquete.title')}</h1>
      </div>

      {anySoldOut && <p className="rounded-ctrl bg-amber-50 p-3 text-[13px] text-ink-900">{t('raquete.sold_out_hint')}</p>}

      {items.map((item, i) => (
        <RaqueteCard key={item.id} item={item} featured={i === 0 && item.best} onOpen={() => setOpen(item)} />
      ))}

      <p className="px-1 text-[11px] text-muted">{t('raquete.footer')}</p>

      <PrimaryButton variant="ghost" className="w-full" onClick={() => navigate('/perfil/raquete/perguntas')}>
        {t('raquete.redo')}
      </PrimaryButton>

      {open && <RaqueteFolha item={open} t={t} lang={i18n.language} onClose={() => setOpen(null)} />}
    </div>
  )
}

// A ficha completa, numa folha de baixo que rola (as fichas podem ser longas).
function RaqueteFolha({ item, t, lang, onClose }) {
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
        <p id="raquete-folha-title" className="font-display text-[20px] font-extrabold leading-tight text-ink-900">{item.racket?.name ?? ''}</p>
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
          <RaqueteFicha item={item} t={t} lang={lang} />
        </div>
        <div className="mt-4 shrink-0 space-y-2.5">
          {!item.soldOut && item.racket?.url && (
            <a href={item.racket.url} target="_blank" rel="noopener noreferrer" className="flex min-h-[48px] w-full items-center justify-center rounded-ctrl bg-lime-400 px-4 text-base font-extrabold text-ink-900 shadow-card active:bg-lime-600">
              {t('raquete.buy')}
            </a>
          )}
          <PrimaryButton variant="ghost" className="w-full" onClick={onClose}>{t('raquete.close')}</PrimaryButton>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function RaqueteFicha({ item, t, lang }) {
  const r = item.racket
  const s = r?.specs ?? {}
  const none = t('raquete.not_stated')
  const rows = [
    [t('raquete.spec_shape'), s.shape ? t(`raquete.shape_${s.shape}`) : none],
    [t('raquete.spec_balance'), s.balance ? t(`raquete.balance_${s.balance}`) : none],
    [t('raquete.spec_weight'), s.weight ?? none],
    [t('raquete.spec_profile'), s.profile_mm ? `${s.profile_mm} mm` : none],
    [t('raquete.spec_hardness'), item.hardness || none],
    [t('raquete.spec_sweet_spot'), item.sweet_spot || none],
  ]
  return (
    <div className="space-y-3 text-left">
      <div className="flex items-center gap-3">
        {r?.image_url && <img src={r.image_url} alt="" className="h-24 w-24 rounded-ctrl bg-ink-50 object-contain" />}
        <p className="font-display text-xl font-black text-ink-900">
          {item.soldOut ? t('raquete.sold_out') : formatPrice(r.price, lang)}
        </p>
      </div>
      {item.why && (
        <div>
          <p className="text-sm font-extrabold text-ink-900">{t('raquete.why')}</p>
          <p className="text-sm text-muted">{item.why}</p>
        </div>
      )}
      <dl className="grid grid-cols-2 gap-1.5 rounded-ctrl bg-ink-50 p-3 text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k}><dt className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted">{k}</dt><dd className="font-extrabold text-ink-900">{v}</dd></div>
        ))}
      </dl>
      {[['pros', item.pros], ['cons', item.cons]].map(([k, list]) => (list?.length ? (
        <div key={k}>
          <p className="text-sm font-extrabold text-ink-900">{t(`raquete.${k}`)}</p>
          <ul className="list-disc pl-5 text-sm text-muted">{list.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      ) : null))}
    </div>
  )
}
