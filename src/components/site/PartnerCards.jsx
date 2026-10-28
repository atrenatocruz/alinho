import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'

/* Os cartões dos parceiros do site: a página alinho.pt/parceiros e o resumo
   na entrada (design-handoff/2026-10-18-parceiros-primeiro, ecrã 5, e
   2026-10-28-site-menu-e-parceiros, ponto 4). Um desenho só para manter. */

/** Os parceiros ativos, lidos da base (list_partners, aberto a quem não tem
 *  conta). null enquanto carrega; [] sem parceiros ou com erro. Só pede com
 *  `on` (o interruptor «parceiros»). */
export function usePublicPartners(on) {
  const [partners, setPartners] = useState(null)
  useEffect(() => {
    if (!on) return undefined
    let alive = true
    supabase.rpc('list_partners').then(({ data, error }) => {
      if (!alive) return
      if (error) console.error('Error loading partners:', error)
      setPartners(Array.isArray(data) ? data : [])
    })
    return () => { alive = false }
  }, [on])
  return partners
}

/** «1.º 15% · 2.º 10% · 3.º 5%», pela ordem do pódio. */
function prizeList(t, prizes) {
  return [...prizes].sort((a, b) => a.place - b.place)
    .map((p) => t('partners.site_prize_item', { place: p.place, pct: p.discount_pct })).join(' · ')
}

export function PartnerCard({ p, className = '' }) {
  const { t, i18n } = useTranslation()
  const prizes = p.prizes || []
  const district = p.prize_district || p.district
  // Antes do acordo começar diz-se a partir de quando, como na app, mesmo que
  // os prémios já estejam escritos (o list_partners devolve-os; QA, 28 out).
  const from = p.prizes_from ? new Date(`${String(p.prizes_from).slice(0, 10)}T12:00:00`) : null
  const prizeText = from && from > new Date()
    ? t('partners.card_upcoming', { month: from.toLocaleDateString(i18n.language, { month: 'long' }), district, name: p.name })
    : prizes.length ? t('partners.site_prizes', { district, list: prizeList(t, prizes) }) : null
  const initials = p.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div className={`overflow-hidden rounded-[22px] border border-[#E2E3DE] bg-white ${className}`}>
      {p.cover_url
        ? <img src={p.cover_url} alt="" width="920" height="394" loading="lazy" className="block h-[150px] w-full object-cover" />
        : <div className="h-[150px] bg-[#E8EAE3]" />}
      <div className="px-[18px] pb-5 pt-[18px]">
        {p.logo_url
          ? <img src={p.logo_url} alt="" width="52" height="52" className="relative -mt-11 block h-[52px] w-[52px] rounded-[14px] border-[3px] border-white bg-white object-cover" />
          : <span className="relative -mt-11 grid h-[52px] w-[52px] place-items-center rounded-[14px] border-[3px] border-white bg-ink-900 font-display text-[18px] font-black text-lime-400">{initials}</span>}
        <h3 className="mt-2.5 font-display text-[19px] font-extrabold leading-tight text-ink-900">{p.name}</h3>
        <p className="mt-1 font-mono text-[12px] font-medium uppercase tracking-[.1em] text-[#5B6068]">{[p.kind_label, p.city].filter(Boolean).join(' · ')}</p>
        {p.tagline && <p className="mt-2.5 text-[15px] leading-[1.5] text-[#2A2E35]">{p.tagline}</p>}
        {prizeText && (
          <p className="mt-3 rounded-[14px] bg-[#F4F8DC] px-3.5 py-3 font-display text-[14.5px] font-bold leading-[1.4] text-[#3F6212]">
            <span aria-hidden="true">🎁 </span>{prizeText}
          </p>
        )}
        {/* A página do parceiro na app: sem sessão vai ao login e volta. */}
        <Link to={`/parceiro/${p.slug}`} className="mt-3 inline-block font-display text-[15px] font-extrabold text-ink-900">{t('partners.see_in_app')}</Link>
      </div>
    </div>
  )
}

/** O tracejado «O teu negócio aqui?», para quem quer ser parceiro: o separador
 *  Parceiros dos Planos, com os contactos (PO, 19 out). */
export function YourBusinessCard({ className = '' }) {
  const { t } = useTranslation()
  return (
    <div className={`place-items-center rounded-[22px] border-[1.5px] border-dashed border-[#CFD2D7] p-[30px] text-center text-[#5B6068] ${className || 'grid'}`}>
      <div>
        <b className="mb-1.5 block font-display text-[18px] font-extrabold text-ink-900">{t('partners.your_business')}</b>
        {t('partners.your_business_text')}
        <br />
        <Link to="/planos#parceiros" className="mt-1 inline-block font-display text-[15px] font-extrabold text-ink-900">{t('partners.talk_to_us')}</Link>
      </div>
    </div>
  )
}
