import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { SiteHeader, SiteFooter, usePageTop } from '../components/site/SiteChrome'
import { SITE_EYEBROW, SITE_H2, SITE_LEAD } from '../components/site/SiteWays'
import { PartnerCard, usePublicPartners } from '../components/site/PartnerCards'
import { PartnersForBrands } from './Plans'
import { useFeatureFlag } from '../lib/useFeatureFlag'

/* alinho.pt/parceiros — os parceiros do alinho.pt (design-handoff/2026-10-18-
   parceiros-primeiro, ecrã 5; aprovado pelo Francisco a 18 out). Um cartão por
   parceiro, lido da base. A entrada do site mostra um resumo desta página
   (PartnersSection, no Landing).
   No fim, «Para marcas e lojas», que era o separador Parceiros dos Planos
   (2026-10-28-site-paginas-sem-separadores; sai o tracejado «O teu negócio
   aqui?»). /planos#parceiros e o tracejado da entrada vêm a #marcas.
   Com o interruptor «parceiros» desligado, ou sem linha, a página mostra só o
   «Para marcas e lojas»: os parceiros ainda não se mostram. */
export default function Parceiros() {
  usePageTop()
  const { t } = useTranslation()
  const { hash } = useLocation()
  const { on, loading } = useFeatureFlag('parceiros')
  const partners = usePublicPartners(on)
  // Com #marcas, desce ao «Para marcas e lojas» quando a página já tem tudo.
  useEffect(() => {
    if (hash !== '#marcas' || loading || (on && partners === null)) return
    document.getElementById('marcas')?.scrollIntoView({ block: 'start' })
  }, [hash, loading, on, partners])
  if (loading) return <div className="min-h-screen bg-[#F7F7F4]" />
  return (
    <div className="min-h-screen bg-[#F7F7F4]">
      <SiteHeader />
      {on && (
        <section className="bg-[#F7F7F4] pb-16 pt-10 lg:pb-[70px] lg:pt-16">
          <div className="mx-auto max-w-[1200px] px-5 lg:px-10">
            <p className={`${SITE_EYEBROW} text-[#5B6068]`}>{t('partners.eyebrow')}</p>
            <h1 className={`${SITE_H2} mt-3 max-w-[16ch]`}>{t('partners.title')}</h1>
            <p className={SITE_LEAD}>{t('partners.lead')}</p>
            <div className="mt-8 grid gap-[18px] [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
              {(partners || []).map((p) => <PartnerCard key={p.id || p.slug} p={p} />)}
            </div>
          </div>
        </section>
      )}
      {/* scroll-margin: o cabeçalho preso não tapa o início da secção. */}
      <section id="marcas" className="scroll-mt-[var(--site-head,0px)] border-t border-[#E2E3DE] bg-white pb-20 pt-11 lg:pb-20 lg:pt-[70px]">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-10">
          <PartnersForBrands />
        </div>
      </section>
      <SiteFooter />
    </div>
  )
}
