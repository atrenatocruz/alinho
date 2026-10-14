import { useTranslation } from 'react-i18next'
import { Nav, Footer, usePageTop } from './Landing'
import { founderNames, POLICY_VERSION, SUPPORT_EMAIL, mailtoLink, whatsappContactLink } from '../lib/contacts'
import { formatDate } from '../lib/formatDate'

/* alinho.pt/termos — página mais fácil de ler (design-handoff/2026-10-13-
   termos-de-servico, SPEC do UX; aprovada pelo Francisco a 14 out). Topo
   creme como no «Como funciona», «Em poucas palavras» (o único cartão),
   índice com saltos, as 12 secções numeradas em texto corrido, «Tens alguma
   dúvida?» e o rodapé do site. O texto legal é o da BA, palavra a palavra. */

// Order here is the order sections render in — matches
// terms.section_<key>_title / terms.section_<key>_body in pt.json/en.json.
// Cada secção tem como âncora a sua chave (#ranking, #account, …).
const SECTIONS = [
  'intro', 'pilot', 'responsibilities', 'admins', 'ranking', 'prizes',
  'whatsapp', 'account', 'liability', 'changes', 'law', 'contact',
]
const SUMMARY = [1, 2, 3, 4, 5, 6]

// Visto num círculo: lima sobre preto no resumo, preto sobre lima na lista.
function Check({ dark }) {
  return (
    <span aria-hidden="true" className={`absolute left-0 top-[2px] flex h-[21px] w-[21px] items-center justify-center rounded-full ${dark ? 'bg-ink-900' : 'bg-lime-400'}`}>
      <span className={`mb-[3px] h-[9px] w-[5px] rotate-45 border-b-2 border-r-2 ${dark ? 'border-lime-400' : 'border-ink-900'}`} />
    </span>
  )
}

export default function TermsOfService() {
  usePageTop()
  const { t, i18n } = useTranslation()
  const date = formatDate(`${POLICY_VERSION}T12:00:00`, i18n.language, { day: 'numeric', month: 'long', year: 'numeric' })
  const kicker = 'font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted'
  return (
    <div className="min-h-screen bg-white">
      <Nav />
      <header className="bg-[#F7F7F4]">
        <div className="mx-auto max-w-[760px] px-5 pt-24 pb-10 sm:pt-28 sm:pb-14">
          <p className={kicker}>{t('terms.updated_kicker', { date })}</p>
          <h1 className="mt-2.5 text-[40px] font-black leading-[1.05] tracking-[-0.03em] text-ink-900 sm:text-[56px]">{t('terms.title')}</h1>
          <p className="mt-2.5 text-[17px] leading-normal text-ink-700">{t('terms.lead')}</p>
        </div>
      </header>

      <main className="mx-auto max-w-[760px] px-5">
        <div className="relative -mt-5 rounded-[22px] bg-[#F4F8DC] px-[22px] pt-[22px] pb-[18px]">
          <h2 className="mb-3.5 text-xl font-extrabold leading-tight text-ink-900">{t('terms.summary_title')}</h2>
          <ul className="grid gap-[11px]">
            {SUMMARY.map((i) => (
              <li key={i} className="relative pl-8 text-[15.5px] font-medium leading-[1.45] text-ink-900">
                <Check dark />{t(`terms.summary_${i}`)}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[13px] leading-snug text-muted">{t('terms.summary_note')}</p>
        </div>

        <nav id="indice" aria-label={t('terms.toc')} className="mt-9 scroll-mt-20">
          <p className={kicker}>{t('terms.toc')}</p>
          {/* No computador, 2 colunas lidas de cima para baixo (1–6, 7–12). */}
          <ol className="mt-2.5 md:columns-2 md:gap-7">
            {SECTIONS.map((key, i) => (
              <li key={key} className="break-inside-avoid">
                <a href={`#${key}`} className="flex items-baseline gap-3 border-b border-line py-2.5 text-[15px] font-semibold leading-snug text-ink-900">
                  <span className="w-5 flex-none font-mono text-xs font-medium text-muted">{i + 1}</span>
                  {t(`terms.section_${key}_title`)}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="mt-4">
          {SECTIONS.map((key, i) => {
            // Um texto com várias linhas é uma lista (as responsabilidades).
            const lines = t(`terms.section_${key}_body`).split(/\n/)
            return (
              <section key={key} id={key} className={`scroll-mt-20 pt-[30px] pb-[22px] ${i ? 'border-t border-line' : ''}`}>
                <h2 className="mb-2.5 text-[22px] font-extrabold leading-tight tracking-[-0.015em] text-ink-900">
                  <span className="mr-1 align-[2px] font-mono text-sm font-medium text-muted">{i + 1}.</span> {t(`terms.section_${key}_title`)}
                </h2>
                {lines.length > 1 ? (
                  <ul className="mt-1 mb-3 grid max-w-[65ch] gap-2.5">
                    {lines.map((line) => (
                      <li key={line} className="relative pl-8 text-base leading-[1.65] text-ink-700"><Check />{line}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mb-3 max-w-[65ch] text-base leading-[1.65] text-ink-700">{lines[0]}</p>
                )}
                {/* Quem gere o alinho até haver empresa (13 out). */}
                {key === 'intro' && (
                  <p className="mb-3 max-w-[65ch] text-base leading-[1.65] text-ink-700">{t('terms.intro_founders', { names: founderNames(i18n.language), email: SUPPORT_EMAIL })}</p>
                )}
                <a href="#indice" className="inline-block font-mono text-xs font-medium tracking-[0.06em] text-muted hover:text-ink-900">↑ {t('terms.back_to_toc')}</a>
              </section>
            )
          })}
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
      <Footer />
    </div>
  )
}
