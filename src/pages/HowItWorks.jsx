import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ChevronDown, Shuffle, Trophy } from 'lucide-react'
import { Nav, Footer, useLoginHref, usePageTop, PRIMARY_CTA } from './Landing'
import { whatsappContactLink } from '../lib/contacts'

/* alinho.pt/como-funciona (Trello #619) — design-handoff/2026-10-10-site-
   como-funciona, aprovado pelo Francisco a 10 out. Textos do Marketing
   (TEXTOS.md, aprovados). Telemóvel primeiro, com o aspeto da landing de 24
   set: topo branco quente, uma secção por tipo com a cor do tipo, quem
   organiza em branco, perguntas frequentes e o fim em preto.

   Só o que está na app; nada de números, pessoas ou clubes reais. As imagens
   são da conta de exemplo do modo de teste, com «Imagem ilustrativa». */

// **In** → In a negrito (o que se escreve no WhatsApp).
const bold = (text) => text.split('**').map((part, i) => (i % 2 ? <b key={i} className="font-extrabold text-ink-900">{part}</b> : part))

function Points({ prefix, n }) {
  const { t } = useTranslation()
  return (
    <div className="mt-5 space-y-5">
      {Array.from({ length: n }, (_, i) => i + 1).map((i) => (
        <div key={i}>
          <h3 className="text-lg text-ink-900">{t(`${prefix}_p${i}_t`)}</h3>
          <p className="mt-1 text-ink-700 leading-relaxed">{bold(t(`${prefix}_p${i}_b`))}</p>
        </div>
      ))}
    </div>
  )
}

// A imagem num telemóvel escuro, cortada em baixo, com «Imagem ilustrativa».
function Phone({ src }) {
  const { t } = useTranslation()
  return (
    <div className="mt-8">
      <div className="mx-auto w-[220px] h-[330px] overflow-hidden">
        <div className="rounded-[34px] bg-ink-900 p-[8px] shadow-[0_24px_48px_-18px_rgba(4,4,4,0.45)]">
          <img src={src} alt="" width="540" height="1169" loading="lazy" className="block w-full rounded-[27px]" />
        </div>
      </div>
      <p className="text-center text-[11px] text-muted py-2">{t('hiw.illustrative')}</p>
    </div>
  )
}

function Section({ id, bg, eyebrowClass, prefix, n, back, image, children }) {
  const { t } = useTranslation()
  return (
    <section id={id} className={`relative overflow-hidden scroll-mt-16 ${bg}`}>
      {back && <div aria-hidden="true" className="pointer-events-none absolute -right-4 top-6 select-none leading-none">{back}</div>}
      <div className="relative max-w-2xl mx-auto px-5 py-14">
        <p className={`font-mono text-[12px] font-bold uppercase tracking-widest ${eyebrowClass}`}>{t(`${prefix}_eyebrow`)}</p>
        <h2 className="text-3xl lg:text-4xl text-ink-900 mt-2">{t(`${prefix}_title`)}</h2>
        <Points prefix={prefix} n={n} />
        {image && <Phone src={image} />}
        {children}
      </div>
    </section>
  )
}

function Faq() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(1)
  return (
    <section className="bg-white">
      <div className="max-w-2xl mx-auto px-5 pb-14">
        <h2 className="text-3xl text-ink-900">{t('hiw.faq_title')}</h2>
        <div className="mt-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="border-b border-line">
              <button type="button" onClick={() => setOpen(open === i ? 0 : i)} aria-expanded={open === i}
                className="flex w-full min-h-[52px] items-center justify-between gap-3 py-3 text-left font-extrabold text-ink-900">
                {t(`hiw.faq_q${i}`)}
                <ChevronDown size={18} className={`shrink-0 text-ink-700 transition-transform duration-fast ${open === i ? 'rotate-180' : ''}`} />
              </button>
              {open === i && (
                <div className="pb-4 text-ink-700 leading-relaxed">
                  <p>{bold(t(`hiw.faq_a${i}`))}</p>
                  {i === 5 && (
                    <a href={whatsappContactLink(t('plans.whatsapp_text'))} target="_blank" rel="noopener noreferrer"
                      className="mt-2 inline-flex min-h-[44px] items-center font-extrabold text-ink-900 underline underline-offset-2">
                      {t('hiw.faq_whatsapp')}
                    </a>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export default function HowItWorks() {
  usePageTop()
  const { t } = useTranslation()
  const loginHref = useLoginHref()
  const jump = 'flex w-full min-h-[52px] items-center justify-between rounded-ctrl border border-ink-200 bg-white px-4 font-extrabold text-ink-900 hover:bg-ink-50'
  return (
    <div className="min-h-screen bg-[#F7F7F4]">
      <Nav />
      <section className="bg-[#F7F7F4]">
        <div className="max-w-2xl mx-auto px-5 pt-24 pb-12">
          <h1 className="text-[40px] sm:text-5xl text-ink-900 leading-[1.05]">{t('hiw.title')}</h1>
          <p className="text-ink-700 text-lg mt-4">{t('hiw.intro')}</p>
          {/* Dois saltos empilhados, a toda a largura (SPEC, ponto 2). */}
          <div className="mt-7 flex flex-col gap-3">
            <a href="#para-quem-joga" className={jump}>{t('hiw.jump_play')} <ArrowDown size={18} /></a>
            <a href="#para-quem-organiza" className={jump}>{t('hiw.jump_org')} <ArrowDown size={18} /></a>
          </div>
        </div>
      </section>

      <Section id="para-quem-joga" bg="bg-[#FBE7DE]" eyebrowClass="text-[#9A3A17]" prefix="hiw.mix" n={3}
        back={<Shuffle size={150} strokeWidth={1.2} className="text-[#9A3A17]/10" />} image="/como-funciona/mix.webp" />
      <Section bg="bg-[#F4F8DC]" eyebrowClass="text-[#5B6B00]" prefix="hiw.level" n={3}
        back={<span className="font-display text-[150px] font-extrabold text-ink-900/[0.07]">F3</span>} image="/como-funciona/perfil-nivel.webp" />
      <Section bg="bg-white" eyebrowClass="text-ink-500" prefix="hiw.others" n={2} image="/como-funciona/home.webp" />
      <Section bg="bg-[#E9E7FB]" eyebrowClass="text-[#4338A8]" prefix="hiw.tour" n={1}
        back={<Trophy size={150} strokeWidth={1.2} className="text-[#4338A8]/10" />} />
      <Section id="para-quem-organiza" bg="bg-white" eyebrowClass="text-ink-500" prefix="hiw.org" n={6} image="/como-funciona/gerir.webp">
        <div className="mt-8">
          <h3 className="text-lg text-ink-900">{t('hiw.org_p7_t')}</h3>
          <p className="mt-1 text-ink-700 leading-relaxed">{t('hiw.org_p7_b')}</p>
          <Link to="/planos" className="mt-1 inline-flex min-h-[44px] items-center font-extrabold text-ink-900 underline underline-offset-2">
            {t('hiw.org_plans_link')}
          </Link>
        </div>
      </Section>

      <Faq />

      {/* Fim preto: uma só ação lima, os botões empilhados. */}
      <section className="bg-ink-900 pt-14 pb-10 px-5">
        <div className="max-w-md mx-auto flex flex-col gap-3">
          <h2 className="text-3xl text-white mb-3">{t('hiw.end_title')}</h2>
          <Link to={loginHref('signup')} className={`${PRIMARY_CTA} inline-flex items-center justify-center`}>{t('landing.signup_link')}</Link>
          <Link to={loginHref()} className="inline-flex min-h-[48px] items-center justify-center rounded-ctrl border border-white/30 px-6 font-extrabold text-white hover:bg-white/10">
            {t('landing.already_account_link')}
          </Link>
          <Link to="/novidades" className="mt-1 inline-flex min-h-[44px] items-center justify-center font-extrabold text-lime-400 underline underline-offset-2">
            {t('hiw.end_news')}
          </Link>
        </div>
      </section>
      <Footer />
    </div>
  )
}
