import { useTranslation } from 'react-i18next'
import { SiteHeader, SiteFooter, usePageTop } from '../components/site/SiteChrome'
import { founderNames, PLAN_SELLER, POLICY_VERSION, SUPPORT_EMAIL, mailtoLink, whatsappContactLink } from '../lib/contacts'
import { formatDate } from '../lib/formatDate'
import { useFeatureFlag } from '../lib/useFeatureFlag'

/* alinho.pt/privacidade — o mesmo arranjo dos Termos (site arrumado,
   aprovado pelo Francisco a 17 out): topo creme, «Em poucas palavras» (o
   único cartão; 6 pontos aprovados pela BA a 14 out — o 2.º e o 6.º são
   texto dela, design-handoff/2026-10-13-privacidade-responsaveis/
   CORRECAO-TELEMOVEL.md), o índice com saltos, as 11 secções numeradas em
   texto corrido, «Tens alguma dúvida?» e o rodapé do site. O texto legal
   não muda. */

// A ordem em que as secções aparecem — privacy.section_<key>_title / _body.
// «partners» (Parceiros e publicidade) entra com os parceiros (BA, 18 out).
const SECTIONS = [
  'intro', 'data_collected', 'purpose', 'visibility', 'sharing', 'partners',
  'cookies', 'retention', 'rights', 'changes', 'controller', 'contact',
]
const SUMMARY = [1, 2, 3, 4, 5, 6]
// «Pagamentos e faturas» entra a seguir a «Com quem partilhamos dados», só
// com o interruptor «vendedor_planos» (Finanças e PO, 29 out).
const withBilling = (on) => (on ? SECTIONS.flatMap((k) => (k === 'sharing' ? [k, 'billing'] : [k])) : SECTIONS)

// O visto num círculo, como nos Termos: lima sobre preto no resumo.
function Check() {
  return (
    <span aria-hidden="true" className="absolute left-0 top-[2px] flex h-[21px] w-[21px] items-center justify-center rounded-full bg-ink-900">
      <span className="mb-[3px] h-[9px] w-[5px] rotate-45 border-b-2 border-r-2 border-lime-400" />
    </span>
  )
}

export default function PrivacyPolicy() {
  usePageTop()
  const { t, i18n } = useTranslation()
  const date = formatDate(`${POLICY_VERSION}T12:00:00`, i18n.language, { day: 'numeric', month: 'long', year: 'numeric' })
  const sections = withBilling(useFeatureFlag('vendedor_planos').on)
  const kicker = 'font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted'
  const body = (key) => t(`privacy.section_${key}_body`, { names: founderNames(i18n.language), email: SUPPORT_EMAIL, seller: PLAN_SELLER })
  return (
    <div className="min-h-screen bg-white">
      <SiteHeader />
      <header className="bg-[#F7F7F4]">
        <div className="mx-auto max-w-[760px] px-5 pt-8 pb-10 sm:pt-12 sm:pb-14">
          <p className={kicker}>{t('terms.updated_kicker', { date })}</p>
          <h1 className="mt-2.5 text-[40px] font-black leading-[1.05] tracking-[-0.03em] text-ink-900 sm:text-[56px]">{t('privacy.title')}</h1>
          <p className="mt-2.5 text-[17px] leading-normal text-ink-700">{t('privacy.lead')}</p>
        </div>
      </header>

      <main className="mx-auto max-w-[760px] px-5">
        <div className="relative -mt-5 rounded-[22px] bg-[#F4F8DC] px-[22px] pt-[22px] pb-[18px]">
          <h2 className="mb-3.5 text-xl font-extrabold leading-tight text-ink-900">{t('terms.summary_title')}</h2>
          <ul className="grid gap-[11px]">
            {SUMMARY.map((i) => (
              <li key={i} className="relative pl-8 text-[15.5px] font-medium leading-[1.45] text-ink-900">
                <Check />{t(`privacy.summary_${i}`)}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[13px] leading-snug text-muted">{t('terms.summary_note')}</p>
        </div>

        <nav id="indice" aria-label={t('terms.toc')} className="mt-9 scroll-mt-32">
          <p className={kicker}>{t('terms.toc')}</p>
          <ol className="mt-2.5 md:columns-2 md:gap-7">
            {sections.map((key, i) => (
              <li key={key} className="break-inside-avoid">
                <a href={`#${key}`} className="flex items-baseline gap-3 border-b border-line py-2.5 text-[15px] font-semibold leading-snug text-ink-900">
                  <span className="w-5 flex-none font-mono text-xs font-medium text-muted">{i + 1}</span>
                  {t(`privacy.section_${key}_title`)}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="mt-4">
          {sections.map((key, i) => (
            <section key={key} id={key} className={`scroll-mt-32 pt-[30px] pb-[22px] ${i ? 'border-t border-line' : ''}`}>
              <h2 className="mb-2.5 text-[22px] font-extrabold leading-tight tracking-[-0.015em] text-ink-900">
                <span className="mr-1 align-[2px] font-mono text-sm font-medium text-muted">{i + 1}.</span> {t(`privacy.section_${key}_title`)}
              </h2>
              {body(key).split(/\n+/).map((para) => (
                <p key={para} className="mb-3 max-w-[65ch] text-base leading-[1.65] text-ink-700">{para}</p>
              ))}
              <a href="#indice" className="inline-block font-mono text-xs font-medium tracking-[0.06em] text-muted hover:text-ink-900">↑ {t('terms.back_to_toc')}</a>
            </section>
          ))}
        </div>

        <div className="mt-5 mb-10 rounded-[22px] bg-[#F7F7F4] px-[22px] py-6">
          <h2 className="mb-1.5 text-[22px] font-extrabold leading-tight text-ink-900">{t('terms.help_title')}</h2>
          <p className="mb-4 text-muted">{t('terms.help_body')}</p>
          <div className="flex max-w-[360px] flex-col gap-2.5">
            <a href={mailtoLink()} className="rounded-[14px] bg-ink-900 p-3.5 text-center text-[15px] font-extrabold text-white">{SUPPORT_EMAIL}</a>
            <a href={whatsappContactLink()} target="_blank" rel="noopener noreferrer"
              className="rounded-[14px] border-[1.5px] border-[#CFD2D7] bg-white p-3.5 text-center text-[15px] font-extrabold text-ink-900">{t('terms.help_whatsapp')}</a>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
