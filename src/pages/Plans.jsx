import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Mail, MessageCircle } from 'lucide-react'
import { Nav, Footer, PlansGrid, usePageTop } from './Landing'
import { SITE_H2, SITE_ILL } from '../components/site/SiteWays'
import { mailtoLink, whatsappContactLink, SUPPORT_EMAIL_READY } from '../lib/contacts'

/* Página «Planos» (Trello #327; desenho de 24 set). Desde 18 out
   (design-handoff/2026-10-18-site-planos-professores-parceiros, aprovado pelo
   Francisco; textos do Marketing, versão A, sem preço) tem três separadores:
   «Grupos e clubes | Professores | Parceiros», presos por baixo do cabeçalho
   ao descer («Esse tab tem de ficar no topo quando fazemos scroll»).

   - Abre em «Grupos e clubes»; /planos#professores e /planos#parceiros abrem
     logo o separador certo.
   - Ao trocar de separador mais abaixo, a página volta ao início do conteúdo,
     por baixo da barra.
   - Os contactos vivem em src/lib/contacts.js, num sítio só. */

const TABS = [
  { key: 'grupos', label: 'plans.tab_groups' },
  { key: 'professores', label: 'plans.tab_teachers' },
  { key: 'parceiros', label: 'plans.tab_partners' },
]

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
      <p className="max-w-[760px] rounded-[16px] bg-[#F4F8DC] px-[18px] py-3.5 font-display text-[16px] font-bold leading-[1.4] text-[#3F6212]">
        {t('plans.free_group_line')}
      </p>
      <div className="mt-[18px]"><PlansGrid /></div>
      <p className="mx-auto mt-5 max-w-[56ch] text-center text-[13px] text-[#5B6068]">{t('landing.pricing_footnote')}</p>
      {/* «Quem escreve escolhe» (Francisco, 25 set): os dois iguais, com contorno. */}
      <ContactCard className="mt-[26px]" dark={false} title={t('plans.club_title')}
        text={t(SUPPORT_EMAIL_READY ? 'plans.club_text' : 'plans.club_text_whatsapp')}
        waText={t('plans.whatsapp_text')} emailSubject={t('plans.email_subject')} note={t('plans.human_reply')} />
    </>
  )
}

// Professores: no telemóvel a imagem vem logo a seguir à frase de topo; no
// computador fica à direita, ao lado de tudo.
function Teachers() {
  const { t } = useTranslation()
  return (
    <div className="grid items-start lg:grid-cols-[1.1fr_.9fr] lg:gap-x-[60px] lg:[grid-template-areas:'a_s'_'b_s'] [grid-template-areas:'a'_'s'_'b']">
      <div className="[grid-area:a]">
        <h2 className={SITE_H2}>{t('plans.teachers_title')}</h2>
        <p className={PANE_LEAD}>{t('plans.teachers_lead')}</p>
      </div>
      <div className="mt-6 rounded-[24px] bg-[#F1F2EE] p-[22px] text-center [grid-area:s] lg:mt-0">
        <img src="/planos/professor-cartao.webp" alt={t('plans.teachers_shot_alt')} width="740" height="360" loading="lazy"
          className="mx-auto block w-full max-w-[400px] rounded-[18px] shadow-[0_10px_30px_-18px_rgba(0,0,0,.35)]" />
        <p className={SITE_ILL}>{t('plans.teachers_shot_caption')}</p>
      </div>
      <div className="[grid-area:b]">
        <p className={INTRO}>{t('plans.teachers_intro')}</p>
        <Features prefix="plans.teachers" count={5} />
        <ContactCard className="mt-[26px]" title={t('plans.teachers_cta_title')} text={t('plans.teachers_cta_text')}
          waText={t('plans.teachers_whatsapp_text')} emailSubject={t('plans.teachers_email_subject')} />
      </div>
    </div>
  )
}

// Parceiros: sem imagem de ecrã (não há ecrã de parceiro na app). O cartão
// de contacto fica à direita no computador.
function Partners() {
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

export default function Plans() {
  const { t } = useTranslation()
  const { hash } = useLocation()
  const topRef = useRef(null)
  usePageTop()
  const fromHash = (h) => (TABS.some((x) => `#${x.key}` === h) ? h.slice(1) : 'grupos')
  const [tab, setTab] = useState(() => fromHash(hash))
  // Mais abaixo, trocar de separador volta ao início do conteúdo (por baixo
  // da barra presa); lá em cima, não mexe. O endereço acompanha, sem passar
  // pelo router (que levaria a página ao topo).
  const pending = useRef(false)
  useLayoutEffect(() => {
    if (!pending.current) return
    pending.current = false
    const top = topRef.current?.offsetHeight || 0
    if (window.scrollY > top) window.scrollTo(0, top)
  }, [tab])
  // Um link para /planos#parceiros (o rodapé) com a página já aberta: troca
  // de separador e sobe ao início do conteúdo.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    pending.current = true
    setTab(fromHash(hash))
  }, [hash]) // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (key) => {
    if (key === tab) return
    pending.current = true
    setTab(key)
    window.history.replaceState(window.history.state, '', key === 'grupos' ? window.location.pathname : `#${key}`)
    // O cabeçalho sublinha Clubes ou Professores pelo separador (site, 28 out).
    window.dispatchEvent(new Event('site:tab'))
  }

  return (
    <div className="min-h-screen bg-white">
      <Nav />
      <section ref={topRef} className="bg-[#F7F7F4]">
        <div className="mx-auto max-w-[1200px] px-4 pb-[18px] pt-9 sm:px-10 lg:pt-[70px]">
          <h1 className="font-display text-[44px] font-black leading-none tracking-[-.035em] text-ink-900 lg:text-[76px]">{t('plans.title_site')}</h1>
          <p className="mt-[18px] max-w-[46ch] text-[17px] leading-[1.5] text-[#2A2E35] lg:text-[21px]">{t('plans.site_lead')}</p>
        </div>
      </section>
      {/* Os separadores do site (opção C, Francisco, 19 out — SPEC ponto 7):
          só as palavras, com o traço lima por baixo da escolhida, como o menu
          do topo e o índice da Ajuda. Numa barra branca a 97% presa por baixo
          do cabeçalho; no telemóvel desliza se não couber. */}
      <div className="sticky z-[15] border-b border-[#E6E7E3] bg-white" style={{ top: 'var(--site-head, 0px)' }}>
        <div role="tablist" aria-label={t('plans.tabs_label')}
          className="mx-auto flex max-w-[1200px] gap-6 overflow-x-auto px-4 [scrollbar-width:none] sm:gap-10 sm:px-10 [&::-webkit-scrollbar]:hidden">
          {TABS.map((x) => (
            <button key={x.key} type="button" role="tab" aria-selected={tab === x.key} onClick={() => pick(x.key)}
              className={`flex-none whitespace-nowrap border-b-[3px] pb-[13px] pt-[15px] font-display text-[16px] font-extrabold leading-none sm:pb-4 sm:pt-[18px] sm:text-[20px] ${
                tab === x.key ? 'border-lime-400 text-[#040404]' : 'border-transparent text-[#7B818C]'}`}>
              {t(x.label)}
            </button>
          ))}
        </div>
      </div>
      <main className="mx-auto max-w-[1200px] px-4 pb-20 pt-8 sm:px-10" role="tabpanel">
        {tab === 'grupos' && <Groups />}
        {tab === 'professores' && <Teachers />}
        {tab === 'parceiros' && <Partners />}
      </main>
      <Footer />
    </div>
  )
}
