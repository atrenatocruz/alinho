import { Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { SiteHeader, SiteFooter, usePageTop } from '../components/site/SiteChrome'
import { SITE_EYEBROW, SITE_H2, SITE_LEAD } from '../components/site/SiteWays'
import { PartnerCard, YourBusinessCard, usePublicPartners } from '../components/site/PartnerCards'
import { useFeatureFlag } from '../lib/useFeatureFlag'

/* alinho.pt/parceiros — os parceiros do alinho.pt (design-handoff/2026-10-18-
   parceiros-primeiro, ecrã 5; aprovado pelo Francisco a 18 out). Um cartão por
   parceiro, lido da base, e um tracejado «O teu negócio aqui?». A entrada do
   site mostra um resumo desta página (PartnersSection, no Landing).
   Atrás do interruptor «parceiros» (PO, 18 out): desligado, ou sem linha, a
   página leva ao separador Parceiros dos Planos, para quem quer ser parceiro
   (SPEC 2026-10-18-site-planos-professores-parceiros, ponto 6). */
export default function Parceiros() {
  usePageTop()
  const { t } = useTranslation()
  const { on, loading } = useFeatureFlag('parceiros')
  const partners = usePublicPartners(on)
  if (loading) return <div className="min-h-screen bg-[#F7F7F4]" />
  if (!on) return <Navigate to="/planos#parceiros" replace />
  return (
    <div className="min-h-screen bg-[#F7F7F4]">
      <SiteHeader />
      <section className="bg-[#F7F7F4] pb-16 pt-10 lg:pb-[70px] lg:pt-16">
        <div className="mx-auto max-w-[1200px] px-5 lg:px-10">
          <p className={`${SITE_EYEBROW} text-[#5B6068]`}>{t('partners.eyebrow')}</p>
          <h1 className={`${SITE_H2} mt-3 max-w-[16ch]`}>{t('partners.title')}</h1>
          <p className={SITE_LEAD}>{t('partners.lead')}</p>
          <div className="mt-8 grid gap-[18px] [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
            {(partners || []).map((p) => <PartnerCard key={p.id || p.slug} p={p} />)}
            <YourBusinessCard />
          </div>
        </div>
      </section>
      <SiteFooter />
    </div>
  )
}
