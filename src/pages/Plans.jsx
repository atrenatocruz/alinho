import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Mail, MessageCircle } from 'lucide-react'
import { Nav, Footer, PlansGrid, useLoginHref } from './Landing'
import { mailtoLink, whatsappContactLink, SUPPORT_EMAIL_READY } from '../lib/contacts'

/* Página «Planos» (Trello #327) — NOVA: antes o «Planos» do menu só saltava
   para #planos na página inicial. Desenho aprovado a 24 set
   (design-handoff/2026-09-24-alinho-pt-antes-de-entrar/SPEC.md).

   «Jogar é grátis. Os planos são para quem organiza.» Os 4 planos com o
   conteúdo de sempre, e «És um clube? Falar connosco» com as duas vias —
   quem escreve escolhe (Francisco, 25 set). Os contactos vivem em
   src/lib/contacts.js, num sítio só. */
export default function Plans() {
  const { t } = useTranslation()
  const loginHref = useLoginHref()
  const contact = 'inline-flex flex-1 items-center justify-center gap-2 min-h-[48px] rounded-ctrl px-4 font-extrabold'
  return (
    <div className="min-h-screen bg-[#F7F7F4]">
      <Nav />
      <main className="max-w-5xl mx-auto px-5 pt-24 pb-16">
        <h1 className="text-4xl lg:text-5xl text-ink-900 max-w-xl">{t('plans.title')}</h1>
        <p className="text-ink-700 text-lg mt-3 max-w-md">{t('plans.subtitle')}</p>

        <div className="mt-10">
          <PlansGrid />
          <p className="text-xs text-muted text-center mt-6 max-w-lg mx-auto">{t('landing.pricing_footnote')}</p>
        </div>

        <section className="mt-10 rounded-card bg-white border border-line p-6 max-w-xl">
          <h2 className="text-2xl text-ink-900">{t('plans.club_title')}</h2>
          <p className="text-ink-700 mt-1">{t(SUPPORT_EMAIL_READY ? 'plans.club_text' : 'plans.club_text_whatsapp')}</p>
          {/* «Quem escreve escolhe» (Francisco): os dois iguais, só com
              contorno. O verde do WhatsApp é uma cor fora da marca. */}
          <div className="mt-4 flex gap-3">
            {SUPPORT_EMAIL_READY && (
              <a href={mailtoLink(t('plans.email_subject'))} className={`${contact} border border-ink-900 bg-white text-ink-900 hover:bg-ink-50`}>
                <Mail size={18} /> {t('plans.email')}
              </a>
            )}
            <a href={whatsappContactLink(t('plans.whatsapp_text'))} target="_blank" rel="noopener noreferrer"
               className={`${contact} border border-ink-900 bg-white text-ink-900 hover:bg-ink-50`}>
              <MessageCircle size={18} /> {t('plans.whatsapp')}
            </a>
          </div>
          {/* Para ninguém estranhar o silêncio: o robô não responde a isto,
              responde uma pessoa (SPEC, «Contactos», 25 set). */}
          <p className="text-sm text-muted mt-3">{t('plans.human_reply')}</p>
        </section>

        <div className="mt-10 max-w-xl">
          <Link to={loginHref('signup')} className="btn-primary inline-flex w-full sm:w-auto items-center justify-center">
            {t('landing.plan_free_cta')}
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  )
}
