// O cartão de um parceiro na Home, no meio dos jogos de hoje (design-handoff/
// 2026-10-18-parceiros-primeiro, SPEC-UX ponto 1, proposta-v2): o logótipo,
// o nome e «Parceiro do alinho · <cidade>», a etiqueta «Parceiro», a imagem,
// os prémios do mês e «Ver o ranking do mês ›». Só para quem joga na zona do
// parceiro, no máximo um por dia (quem chama escolhe com pickPartnerOfDay).
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { DISTRICT_SCOPE, partnerInitials, sortedPrizes, topDiscount, upcomingMonth } from '../../lib/partners'

const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' }

export function PartnerLogo({ partner, size = 28 }) {
  return partner?.logo_url
    ? <img src={partner.logo_url} alt="" className="shrink-0 rounded-[7px] object-cover" style={{ width: size, height: size }} />
    : (
      <span className="flex shrink-0 items-center justify-center rounded-[7px] bg-ink-900 font-display font-black text-lime-400"
        style={{ width: size, height: size, fontSize: size * 0.36 }}>
        {partnerInitials(partner?.name)}
      </span>
    )
}

export default function PartnerCard({ partner }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const prizes = sortedPrizes(partner)
  const district = partner.prize_district || partner.district
  const open = () => navigate(`/parceiro/${partner.slug}`)
  const openRanking = (e) => {
    e.stopPropagation()
    navigate('/rankings', { state: { tab: 'do-mes', scope: district ? `${DISTRICT_SCOPE}${district}` : undefined, scale: 'all' } })
  }
  return (
    <article role="link" tabIndex={0} onClick={open} onKeyDown={(e) => { if (e.key === 'Enter') open() }}
      className="press cursor-pointer rounded-card border border-line bg-white p-3.5">
      <div className="flex items-center gap-2.5">
        <PartnerLogo partner={partner} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[10.5px] font-medium uppercase tracking-[.08em] text-ink-900">{partner.name}</p>
          <p className="truncate text-[12px] text-[#5B6068]">{t('partners.of_alinho', { city: partner.city || district || '' })}</p>
        </div>
        <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[11px] font-extrabold text-ink-900">{t('partners.tag')}</span>
      </div>
      {partner.cover_url && (
        <img src={partner.cover_url} alt="" className="mt-3 aspect-[16/10] w-full rounded-[12px] object-cover" loading="lazy" />
      )}
      {/* Antes de o acordo começar, sem prémios a prometer: só «A partir de
          novembro…», sem a lista dos lugares (UX, 22 out). */}
      {prizes.length ? (
        <p className="mt-3 text-[14px] leading-snug text-ink-900">
          <b className="font-extrabold">{t('partners.card_prizes_title', { pct: topDiscount(partner) })}</b>{' '}
          {t('partners.card_prizes_text', { count: prizes.length, district: district || '', name: partner.name })}
        </p>
      ) : (
        <p className="mt-3 text-[14px] leading-snug text-ink-900">
          {t('partners.card_upcoming', { month: upcomingMonth(partner, i18n.language), district: district || '', name: partner.name })}
        </p>
      )}
      <ul className="mt-2.5 divide-y divide-line">
        {prizes.map((p) => (
          <li key={p.place} className="flex items-center gap-3 py-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[#F4F5F1] text-[16px]" aria-hidden="true">{MEDAL[p.place]}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-extrabold text-ink-900">{t('partners.place', { place: p.place })}</span>
              {p.description && <span className="block truncate text-[12px] text-[#5B6068]">{p.description}</span>}
            </span>
            <span className="shrink-0 font-display text-[15px] font-black text-ink-900">−{p.discount_pct}%</span>
          </li>
        ))}
      </ul>
      <button type="button" onClick={openRanking} className="mt-1 inline-flex min-h-[40px] items-center text-[13.5px] font-extrabold text-ink-900">
        {t('partners.see_month_ranking')} ›
      </button>
    </article>
  )
}
