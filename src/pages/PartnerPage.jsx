import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useFeatureFlag } from '../lib/useFeatureFlag'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Clock, Instagram, Share2, Phone, Mail, Globe } from 'lucide-react'
import GlassBar, { GLASS_ROUND, useUnderBar } from '../components/GlassBar'
import KindHero from '../components/KindHero'
import LocationOpenWith from '../components/LocationOpenWith'
import { EmptyState } from '../components/ui'
import { useGoBack } from '../lib/useGoBack'
import { sharePageLink } from '../lib/shareImage'
import { getPartner, prizeMedal } from '../lib/partners'
import { appHref } from '../lib/native'

/* A página do parceiro (design-handoff/2026-10-18-parceiros-primeiro, SPEC-UX
   ponto 3, aprovado pelo Francisco a 18 out): a mesma estrutura da página do
   clube (R5). A capa com «‹» e partilhar (sem ♡), o logótipo, o nome e
   «Parceiro do alinho · <cidade>», a frase, as linhas da morada, do horário e
   do Instagram, e «Prémios deste mês» (o ranking do mês na zona). Sem sessão,
   o Guard leva ao login e volta (PO, 18 out). Os dados são do Dev 3 (get_partner). */

function PartnerLogo({ partner }) {
  if (partner.logo_url) return <img src={partner.logo_url} alt="" className="h-[58px] w-[58px] shrink-0 rounded-[28%] object-cover" />
  // Provisório: as iniciais no quadrado preto, como um clube sem logótipo.
  // «RM Terapias» → «RM»: uma sigla no início fica como está.
  const words = String(partner.name || '?').split(/\s+/).filter(Boolean)
  const initials = /^[A-Z0-9]{2,3}$/.test(words[0] || '') ? words[0] : words.slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  return <span className="flex h-[58px] w-[58px] shrink-0 items-center justify-center rounded-[28%] bg-ink-900 font-display text-xl font-extrabold text-lime-400">{initials}</span>
}

function PartnerBody() {
  const { t, i18n } = useTranslation()
  const { slug } = useParams()
  const navigate = useNavigate()
  const goBack = useGoBack('/')
  const [partner, setPartner] = useState(undefined) // undefined = a carregar; null = não existe
  useEffect(() => {
    let alive = true
    setPartner(undefined)
    getPartner(slug).then((p) => { if (alive) setPartner(p) }).catch((e) => { console.error('Error loading partner:', e); if (alive) setPartner(null) })
    return () => { alive = false }
  }, [slug])

  const coverRef = useRef(null)
  const nameRef = useRef(null)
  const rowRef = useRef(null)
  const under = useUnderBar(nameRef, rowRef, [], { lastLine: true })
  const firstUnder = useUnderBar(nameRef, rowRef)
  const coverGone = useUnderBar(coverRef, rowRef, [], { edge: 'bottom' })
  // Tudo o que é parceiros fica atrás do interruptor «parceiros» (PO, 18 out):
  // o dev vai para o main sem aviso.
  const flag = useFeatureFlag('parceiros')

  if (flag.loading) return <div className="h-60" aria-hidden="true" />
  if (!flag.on) return <Navigate to="/" replace />
  if (partner === undefined) return <div className="h-60" aria-hidden="true" />
  if (!partner) {
    return <EmptyState pose="triste" title={t('partner.not_found_title')} subtitle={t('partner.not_found_body')} />
  }

  const loc = i18n.language?.startsWith('en') ? 'en-GB' : 'pt-PT'
  const month = partner.prize_month ? new Date(`${String(partner.prize_month).slice(0, 10)}T12:00:00`) : new Date()
  const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0)
  const endLabel = `${monthEnd.getDate()} ${t('partner.of')} ${monthEnd.toLocaleDateString(loc, { month: 'long' })}`
  const prizes = [...(partner.prizes || [])].sort((a, b) => a.place - b.place)
  const district = partner.prize_district || partner.district
  const phones = partner.phones || []
  // Antes do acordo começar (prizes_from no futuro) não há prémios: diz-se a partir de quando.
  const from = partner.prizes_from ? new Date(`${String(partner.prizes_from).slice(0, 10)}T12:00:00`) : null
  const soon = prizes.length === 0 && from && from > new Date()
  const row = 'press flex min-h-[56px] items-center gap-3 px-3.5 py-2.5'

  return (
    <div className="space-y-5 pb-6">
      {/* O topo, como o do clube (R5): a capa a toda a largura e o cartão branco a subir por cima. */}
      <div className="-mx-4 -mt-6">
        <GlassBar anchorRef={coverRef} rowRef={rowRef} filled={under || firstUnder} strip={coverGone} showTitle={under} title={partner.name}
          left={<button type="button" onClick={goBack} aria-label={t('common.back')} className={GLASS_ROUND}><ChevronLeft size={22} /></button>}
          right={<button type="button" onClick={() => sharePageLink({ title: partner.name, url: appHref() })} aria-label={t('ui.share')} className={GLASS_ROUND}><Share2 size={18} /></button>} />
        <div ref={coverRef}>
          {/* A fachada é a foto real (ficha da RM, 21 out): já não leva «Imagem ilustrativa». */}
          <KindHero kind="club" src={partner.cover_url} alt="" className="relative h-44" imgClassName="object-[50%_12%]" />
        </div>
        <div className="relative -mt-5 rounded-t-[22px] bg-white px-4 pb-4">
          <div className="flex items-end gap-3.5">
            <span className="-mt-7 rounded-[28%] bg-white p-[3px]"><PartnerLogo partner={partner} /></span>
            <div className="min-w-0 flex-1 pt-3">
              <h1 ref={nameRef} className={`font-display text-2xl font-extrabold leading-tight text-ink-900 [overflow-wrap:anywhere] transition-opacity duration-fast ${under ? 'opacity-0' : 'opacity-100'}`}>{partner.name}</h1>
            </div>
          </div>
          {/* O tipo diz logo o que é o parceiro (UX, 22 out): «Massagens & Tratamentos · Almada»; sem tipo, só a cidade. */}
          <p className="mt-1 text-sm text-muted">{[partner.kind_label, partner.city].filter(Boolean).join(' · ')}</p>
          {partner.tagline && <p className="mt-3 text-[15px] leading-snug text-ink-700">{partner.tagline}</p>}

          {/* A morada (abre o mapa), o horário e o Instagram, em linhas. */}
          <div className="mt-4 divide-y divide-line overflow-hidden rounded-[16px] border border-line">
            {partner.address && <LocationOpenWith location={partner.address} surface="white" className="!rounded-none" />}
            {partner.hours && (
              <div className={`${row} !cursor-default`}>
                <Clock size={18} className="shrink-0 text-ink-700" />
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-[14px] font-bold text-ink-900">{partner.hours}</span>
                  {phones.length > 0
                    ? <span className="block text-[12.5px] text-muted">{t('partner.hours_hint_phone')}</span>
                    : partner.instagram_url && <span className="block text-[12.5px] text-muted">{t('partner.hours_hint')}</span>}
                </span>
              </div>
            )}
            {/* Os telefones, o email e o site (ficha da RM, Dev 3, 21 out). */}
            {phones.map((ph) => (
              <a key={ph} href={`tel:${ph.replace(/\s+/g, '')}`} className={row}>
                <Phone size={18} className="shrink-0 text-ink-700" />
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-[14px] font-bold text-ink-900 tabular-nums">{ph}</span>
                  <span className="block text-[12.5px] text-muted">{t('partner.call')}</span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-ink-500" />
              </a>
            ))}
            {partner.email && (
              <a href={`mailto:${partner.email}`} className={row}>
                <Mail size={18} className="shrink-0 text-ink-700" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-[14px] font-bold text-ink-900">{partner.email}</span>
                  <span className="block text-[12.5px] text-muted">{t('partner.send_email')}</span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-ink-500" />
              </a>
            )}
            {partner.website_url && (
              <a href={partner.website_url} target="_blank" rel="noopener noreferrer" className={row}>
                <Globe size={18} className="shrink-0 text-ink-700" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-[14px] font-bold text-ink-900">{partner.website_url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</span>
                  <span className="block text-[12.5px] text-muted">{t('partner.open_site')}</span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-ink-500" />
              </a>
            )}
            {partner.instagram_url && (
              <a href={partner.instagram_url} target="_blank" rel="noopener noreferrer" className={row}>
                <Instagram size={18} className="shrink-0 text-ink-700" />
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-[14px] font-bold text-ink-900">{t('partner.instagram_of', { name: partner.name })}</span>
                  <span className="block text-[12.5px] text-muted">{t('partner.open_instagram')}</span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-ink-500" />
              </a>
            )}
          </div>
        </div>
      </div>

      {prizes.length > 0 && (
        <section>
          <h2 className="font-display text-[22px] font-extrabold leading-tight text-ink-900">{t('partner.prizes_title')}</h2>
          <p className="mt-0.5 text-[13px] text-muted">{[t('partner.prizes_where'), t('partner.scale_all'), district, t('partner.ends', { date: endLabel })].filter(Boolean).join(' · ')}</p>
          <div className="mt-3 overflow-hidden rounded-card bg-white shadow-[0_1px_2px_rgba(17,17,17,0.06)]">
            {prizes.map((p) => (
              <div key={p.place} className="flex items-center gap-3 border-b border-line px-3.5 py-3">
                <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#F4F5F1] text-[17px]">{prizeMedal(p.place)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-[15px] font-extrabold text-ink-900">{t('partner.place', { place: p.place })}</span>
                  {p.description && <span className="block text-[12.5px] text-muted">{p.description}</span>}
                </span>
                <span className="w-[52px] shrink-0 text-right font-display text-[16px] font-black text-ink-900 tabular-nums">−{p.discount_pct}%</span>
              </div>
            ))}
            <p className="px-3.5 py-3 text-[13px] text-muted">{t('partner.prizes_note')}</p>
          </div>
          <button type="button" onClick={() => navigate('/rankings', { state: { tab: 'do-mes', scope: `district:${district}`, scale: 'all' } })}
            className="mt-4 flex min-h-[52px] w-full items-center justify-center rounded-ctrl bg-ink-900 font-extrabold text-white">
            {t('partner.see_ranking')}
          </button>
        </section>
      )}
      {soon && (
        <section>
          <h2 className="font-display text-[22px] font-extrabold leading-tight text-ink-900">{t('partner.prizes_soon_title')}</h2>
          <p className="mt-1 rounded-card bg-white px-3.5 py-3 text-[14px] leading-snug text-ink-700 shadow-[0_1px_2px_rgba(17,17,17,0.06)]">
            {t('partner.prizes_soon_body', { month: from.toLocaleDateString(loc, { month: 'long' }), district, name: partner.name })}
          </p>
        </section>
      )}
    </div>
  )
}

export default PartnerBody
