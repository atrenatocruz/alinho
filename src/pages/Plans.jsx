import { Navigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Mail, MessageCircle } from 'lucide-react'
import { Nav, Footer, PlansGrid, usePageTop } from './Landing'
import { SITE_H2, SITE_ILL } from '../components/site/SiteWays'
import { mailtoLink, whatsappContactLink, SUPPORT_EMAIL_READY } from '../lib/contacts'

/* Página «Grupos e clubes» em /planos (Trello #327; desenho de 24 set).
   Desde 28 out (design-handoff/2026-10-28-site-paginas-sem-separadores,
   aprovado pelo Francisco) já não tem separadores: cada porta do menu abre a
   sua página. Os Professores vivem em /professores e o «Para marcas e lojas»
   no fim de /parceiros; os links antigos /planos#professores e
   /planos#parceiros levam lá. As secções vivem aqui e as outras páginas
   importam-nas. Os contactos vivem em src/lib/contacts.js, num sítio só. */

const BTN = 'inline-flex w-full items-center justify-center gap-2 rounded-[16px] px-4 py-[18px] font-display text-[17px] font-extrabold leading-none'
const BTN_DARK = `${BTN} bg-ink-900 text-white`
const BTN_OUT = `${BTN} border-[1.5px] border-[#CFD2D7] bg-white text-ink-900`

// O cartão branco de contacto: título, frase e os dois botões empilhados.
function ContactCard({ title, text, waText, emailSubject, dark = true, note, className = '' }) {
  const { t } = useTranslation()
  return (
    <div className={`max-w-[520px] rounded-[22px] border border-[#E2E3DE] bg-white p-[22px] ${className}`}>
      <h3 className="font-display text-[24px] font-black leading-tight tracking-[-.02em] text-ink-900">{title}</h3>
      <p className="mt-1.5 text-[15.5px] leading-[1.5] text-[#2A2E35]">{text}</p>
      <div className="mt-4 flex flex-col gap-3">
        <a href={whatsappContactLink(waText)} target="_blank" rel="noopener noreferrer" className={dark ? BTN_DARK : BTN_OUT}>
          <MessageCircle size={18} /> {t('landing.organizers_whatsapp')}
        </a>
        {SUPPORT_EMAIL_READY && (
          <a href={mailtoLink(emailSubject)} className={BTN_OUT}>
            <Mail size={18} /> {t('plans.email')}
          </a>
        )}
      </div>
      {note && <p className="mt-3 text-sm text-[#5B6068]">{note}</p>}
    </div>
  )
}

// Os pontos de Professores e de Parceiros: título a negrito e uma frase.
function Features({ prefix, count }) {
  const { t } = useTranslation()
  return (
    <div className="mt-1 flex flex-col gap-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          <h4 className="font-display text-[18px] font-extrabold leading-tight text-ink-900">{t(`${prefix}_f${i + 1}_title`)}</h4>
          <p className="mt-1 text-[15.5px] leading-[1.5] text-[#2A2E35]">{t(`${prefix}_f${i + 1}_text`)}</p>
        </div>
      ))}
    </div>
  )
}

const PANE_LEAD = 'mt-4 max-w-[44ch] text-[17px] leading-[1.5] text-[#2A2E35] lg:text-[19px]'
const INTRO = 'mb-3 mt-[30px] font-display text-[16px] font-bold leading-[1.45] text-ink-900'

function Groups() {
  const { t } = useTranslation()
  return (
    <>
      {/* A linha verde «Cada pessoa pode criar um grupo grátis» passou para a
          frase de cima (28 out). */}
      <PlansGrid />
      <p className="mx-auto mt-5 max-w-[56ch] text-center text-[13px] text-[#5B6068]">{t('landing.pricing_footnote')}</p>
      {/* «Quem escreve escolhe» (Francisco, 25 set): os dois iguais, com contorno. */}
      <ContactCard className="mt-[26px]" dark={false} title={t('plans.club_title')}
        text={t(SUPPORT_EMAIL_READY ? 'plans.club_text' : 'plans.club_text_whatsapp')}
        waText={t('plans.whatsapp_text')} emailSubject={t('plans.email_subject')} note={t('plans.human_reply')} />
    </>
  )
}

// Professores (página /professores): o título e a frase ficam no topo da
// página; no telemóvel a imagem vem primeiro e, no computador, à direita.
export function Teachers() {
  const { t } = useTranslation()
  return (
    <div className="grid items-start lg:grid-cols-[1.1fr_.9fr] lg:gap-x-[60px] lg:[grid-template-areas:'b_s'] [grid-template-areas:'s'_'b']">
      <div className="rounded-[24px] bg-[#F1F2EE] p-[22px] text-center [grid-area:s]">
        <img src="/planos/professor-cartao.webp" alt={t('plans.teachers_shot_alt')} width="740" height="360" loading="lazy"
          className="mx-auto block w-full max-w-[400px] rounded-[18px] shadow-[0_10px_30px_-18px_rgba(0,0,0,.35)]" />
        <p className={SITE_ILL}>{t('plans.teachers_shot_caption')}</p>
      </div>
      <div className="[grid-area:b]">
        <p className={`${INTRO} lg:mt-0`}>{t('plans.teachers_intro')}</p>
        <Features prefix="plans.teachers" count={5} />
        <ContactCard className="mt-[26px]" title={t('plans.teachers_cta_title')} text={t('plans.teachers_cta_text')}
          waText={t('plans.teachers_whatsapp_text')} emailSubject={t('plans.teachers_email_subject')} />
      </div>
    </div>
  )
}

// «Para marcas e lojas», no fim de /parceiros: sem imagem de ecrã. O cartão
// de contacto fica à direita no computador.
export function PartnersForBrands() {
  const { t } = useTranslation()
  return (
    <div className="grid items-start lg:grid-cols-[1.1fr_.9fr] lg:gap-x-[60px]">
      <div>
        <span className="mb-3.5 inline-block rounded-full bg-ink-900 px-[11px] py-[7px] font-mono text-[12px] font-medium uppercase leading-none tracking-[.1em] text-lime-400">
          {t('plans.partners_badge')}
        </span>
        <h2 className={SITE_H2}>{t('plans.partners_title')}</h2>
        <p className={PANE_LEAD}>{t('plans.partners_lead')}</p>
        <p className="mt-3 text-[15px] leading-[1.4] text-[#5B6068]">{t('plans.partners_note')}</p>
        <p className={INTRO}>{t('plans.partners_intro')}</p>
        <Features prefix="plans.partners" count={3} />
      </div>
      <ContactCard className="mt-[26px] lg:mt-0" title={t('plans.partners_cta_title')} text={t('plans.partners_cta_text')}
        waText={t('partners.whatsapp_text')} emailSubject={t('plans.partners_email_subject')} />
    </div>
  )
}

/** O topo creme das páginas do site: título grande e a frase. */
export function SiteTop({ title, lead }) {
  return (
    <section className="bg-[#F7F7F4]">
      <div className="mx-auto max-w-[1200px] px-4 pb-[18px] pt-9 sm:px-10 lg:pt-[70px]">
        <h1 className="font-display text-[44px] font-black leading-none tracking-[-.035em] text-ink-900 lg:text-[76px]">{title}</h1>
        <p className="mt-[18px] max-w-[52ch] text-[17px] leading-[1.5] text-[#2A2E35] lg:text-[21px]">{lead}</p>
      </div>
    </section>
  )
}

export default function Plans() {
  const { t } = useTranslation()
  const { hash } = useLocation()
  usePageTop()
  // Os links antigos dos separadores levam às páginas novas.
  if (hash === '#professores') return <Navigate to="/professores" replace />
  if (hash === '#parceiros') return <Navigate to="/parceiros#marcas" replace />
  return (
    <div className="min-h-screen bg-white">
      <Nav />
      <SiteTop title={t('plans.tab_groups')} lead={t('plans.groups_lead')} />
      <main className="mx-auto max-w-[1200px] px-4 pb-20 pt-8 sm:px-10">
        <Groups />
      </main>
      <Footer />
    </div>
  )
}
