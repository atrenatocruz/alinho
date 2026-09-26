import { useState, useEffect, useLayoutEffect } from 'react'
import { Link, useSearchParams, useNavigationType } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Trophy, Shuffle, ChevronRight, Mail, MessageCircle } from 'lucide-react'
import { Wordmark } from '../components/Layout'
import i18n from '../lib/i18n'
import { mailtoLink, whatsappContactLink, SUPPORT_EMAIL_READY } from '../lib/contacts'

/* alinho.pt antes de entrar (Trello #327) — desenho APROVADO pelo Francisco
   a 24 set: design-handoff/2026-09-24-alinho-pt-antes-de-entrar/SPEC.md e
   prints/10-FINAL-aprovada.png.

   Para o jogador que chega por um clube ou por um evento — qualquer um. Uma
   só ação: «Criar conta». Topo branco com o telemóvel, uma secção por tipo
   com a cor do tipo (como na app), fim e rodapé em preto.

   Regra do PRODUCT.md: nada de testemunhos, números, pessoas ou clubes
   reais. O telemóvel mostra a conta de EXEMPLO do modo de teste, com
   «Imagem ilustrativa» (decisão do Francisco, 25 set). */

// Same pattern as Layout.jsx's header toggle, minus the profile persistence
// (there's no profile yet on this pre-auth page) — just the instant UI flip
// plus a localStorage write so the choice survives a reload and carries
// forward into the account once the visitor signs in (see AuthContext's
// loadProfile reconciliation).
function toggleLanguage() {
  const next = i18n.language === 'en' ? 'pt' : 'en'
  i18n.changeLanguage(next)
  try {
    localStorage.setItem('preferredLanguage', next)
  } catch {
    // ignore — best-effort persistence
  }
}

function LanguageToggle({ className = '' }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={toggleLanguage}
      title={t('layout.toggle_language')}
      className={`inline-flex items-center justify-center min-h-[44px] min-w-[44px] font-extrabold text-xs transition-colors duration-fast ${className}`}
    >
      {i18n.language === 'en' ? 'PT' : 'EN'}
    </button>
  )
}

// Builds the /login href, preserving ?org=<slug> from the current URL (the
// invite-link mechanism — see Home.jsx / Login.jsx) so landing-page CTAs
// don't silently drop it for logged-out visitors landing on `/?org=...`.
/* Estas páginas vivem fora do Layout, que é quem põe as outras no topo.
   Sem isto, «Ver os planos» abria a página Planos lá em baixo, onde estava o
   dedo — parecia que os planos não existiam (Francisco, 26 set). Ao voltar
   atrás, o browser devolve a posição de antes. */
export function usePageTop() {
  const navigationType = useNavigationType()
  useLayoutEffect(() => {
    if (navigationType !== 'POP') window.scrollTo(0, 0)
  }, [navigationType])
}

/* O lima escuro é o «passar o rato». Num telemóvel fica preso no botão que
   estava debaixo do dedo e parecia desativado (Francisco, 26 set). Sem rato,
   fica o lima de sempre. */
export const PRIMARY_CTA = 'btn-primary [@media(hover:none)]:hover:bg-lime-400'

export function useLoginHref() {
  const [params] = useSearchParams()
  const org = params.get('org')
  return (mode) => {
    const q = new URLSearchParams()
    if (mode) q.set('mode', mode)
    if (org) q.set('org', org)
    const s = q.toString()
    return s ? `/login?${s}` : '/login'
  }
}

// O menu por cima do topo branco: transparente em cima, branco ao descer.
// O «Planos» leva à página própria (antes saltava para #planos).
export function Nav() {
  const { t } = useTranslation()
  const [scrolled, setScrolled] = useState(false)
  const loginHref = useLoginHref()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const link = 'inline-flex items-center min-h-[44px] px-1 text-ink-700 hover:text-ink-900 font-extrabold text-sm transition-colors duration-fast'
  return (
    <header
      className={`fixed top-0 inset-x-0 z-20 transition-colors duration-base ${
        scrolled ? 'bg-[#F7F7F4]/95 backdrop-blur-xl border-b border-line' : 'bg-transparent'
      }`}
    >
      <div className="max-w-5xl mx-auto px-5 h-16 flex items-center justify-between">
        <Link to="/" className="leading-none">
          <Wordmark variant="light" />
        </Link>
        <div className="flex items-center gap-4">
          <LanguageToggle className="text-ink-700 hover:text-ink-900" />
          <Link to="/planos" className={link} onClick={() => { if (window.location.pathname === '/planos') window.scrollTo(0, 0) }}>{t('landing.pricing_nav_link')}</Link>
          <Link to={loginHref()} className={link}>{t('landing.login_link')}</Link>
        </div>
      </div>
    </header>
  )
}

// O telemóvel do topo, cortado em baixo pela secção seguinte: a Home da
// conta de EXEMPLO (Jogador Alinho, Clube Exemplo) — nunca uma conta real,
// nem com nomes desfocados (Francisco, 25 set).
function PhoneShot() {
  const { t } = useTranslation()
  return (
    <div className="relative mx-auto w-[280px] sm:w-[300px]">
      <div className="h-[440px] sm:h-[480px] overflow-hidden">
        <div className="relative rounded-[46px] bg-ink-900 p-[10px] shadow-[0_30px_60px_-20px_rgba(4,4,4,0.45)]">
          <div className="overflow-hidden rounded-[36px] bg-white">
            {/* Barra de estado: a ilha fica por cima dela e não tapa a Home
                (o print de exemplo não tem barra de estado). */}
            <div className="relative flex h-[40px] items-center justify-between px-6 text-[12px] font-extrabold text-ink-900" aria-hidden="true">
              <span>9:41</span>
              <span className="absolute left-1/2 top-[8px] h-[24px] w-[88px] -translate-x-1/2 rounded-full bg-ink-900" />
              <span className="tracking-widest">•••</span>
            </div>
            <img
              src="/landing/home-exemplo.webp"
              alt={t('landing.phone_alt')}
              width="640"
              height="1386"
              className="block w-full"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function Hero() {
  const { t } = useTranslation()
  const loginHref = useLoginHref()
  return (
    <section className="bg-[#F7F7F4] overflow-hidden">
      <div className="max-w-5xl mx-auto px-5 pt-24 lg:pt-32 lg:flex lg:items-end lg:gap-12">
        <div className="lg:flex-1 lg:pb-24 animate-fade-up">
          <h1 className="text-[40px] sm:text-5xl lg:text-6xl text-ink-900 leading-[1.05] max-w-xl">
            {t('landing.hero_title')}
          </h1>
          <p className="text-ink-700 text-lg mt-5 max-w-md">{t('landing.hero_description')}</p>
          <div className="flex flex-col sm:flex-row gap-3 mt-8 max-w-md">
            {/* inline-flex + centragem: num <a>, min-h e padding não fazem nada
                sem eles. «Criar conta» é a única coisa lima do ecrã. */}
            <Link to={loginHref('signup')} className={`${PRIMARY_CTA} inline-flex items-center justify-center sm:flex-1`}>
              {t('landing.signup_link')}
            </Link>
            <Link
              to={loginHref()}
              className="inline-flex items-center justify-center font-extrabold py-3.5 px-6 rounded-ctrl min-h-[48px] text-base
                         border border-ink-200 bg-white text-ink-900 hover:bg-ink-50 sm:flex-1
                         transition-all duration-fast active:scale-[0.98]"
            >
              {t('landing.already_account_link')}
            </Link>
          </div>
          <p className="text-sm text-muted mt-3 max-w-md text-center sm:text-left">{t('landing.free_google')}</p>
        </div>
        <div className="mt-10 lg:mt-0 lg:flex-1 animate-fade-up">
          <PhoneShot />
          <p className="text-center text-[11px] text-muted py-2">{t('landing.illustrative')}</p>
        </div>
      </div>
    </section>
  )
}

// Uma secção por ponto, com a cor do tipo como na app e uma letra grande a
// espreitar ao fundo (SPEC, «Aspeto»).
function Point({ bg, eyebrowClass, eyebrow, title, text, back, children }) {
  return (
    <section className={`relative overflow-hidden ${bg}`}>
      {back && (
        <div aria-hidden="true" className="pointer-events-none absolute -right-4 bottom-0 select-none leading-none">
          {back}
        </div>
      )}
      <div className="relative max-w-5xl mx-auto px-5 py-14 lg:py-20 lg:flex lg:items-center lg:gap-12">
        <div className="lg:flex-1">
          <p className={`font-mono text-[12px] font-bold uppercase tracking-widest ${eyebrowClass}`}>{eyebrow}</p>
          <h2 className="text-3xl lg:text-4xl text-ink-900 mt-2 max-w-md">{title}</h2>
          <p className="text-ink-700 mt-3 max-w-md">{text}</p>
        </div>
        <div className="mt-6 lg:mt-0 lg:flex-1 max-w-sm">{children}</div>
      </div>
    </section>
  )
}

function LevelPoint() {
  const { t } = useTranslation()
  return (
    <Point
      bg="bg-[#F4F8DC]"
      eyebrowClass="text-[#5B6B00]"
      eyebrow={t('landing.level_eyebrow')}
      title={t('landing.level_title')}
      text={t('landing.level_text')}
      back={<span className="font-display text-[170px] font-extrabold text-ink-900/[0.07]">M4</span>}
    >
      {/* Só a etiqueta, sem números (SPEC, «Exemplos»). */}
      <div className="inline-flex items-center gap-3 rounded-card bg-white px-4 py-3 shadow-card">
        <span className="rounded-lg bg-ink-900 px-2.5 py-1.5 font-mono text-lg font-extrabold text-lime-400">M4</span>
        <span>
          <b className="block text-sm text-ink-900">{t('landing.level_chip_title')}</b>
          <span className="block text-xs text-muted">{t('landing.level_chip_text')}</span>
        </span>
      </div>
    </Point>
  )
}

function TournamentPoint() {
  const { t } = useTranslation()
  return (
    <Point
      bg="bg-[#E9E7FB]"
      eyebrowClass="text-[#4338A8]"
      eyebrow={t('landing.tour_eyebrow')}
      title={t('landing.tour_title')}
      text={t('landing.tour_text')}
      back={<Trophy size={170} strokeWidth={1.2} className="text-[#4338A8]/10" />}
    >
      <div className="rounded-card border-2 border-[#C9C3F3] bg-[#E9E7FB] p-4 shadow-card">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-extrabold text-[#4338A8]">
            <Trophy size={13} /> {t('agenda.kind_tournament')}
          </span>
          <span className="rounded-full bg-white px-2.5 py-1 text-xs font-extrabold text-[#4338A8]">{t('landing.tour_card_state')}</span>
        </div>
        <p className="mt-2 font-display text-lg font-extrabold text-ink-900">{t('landing.tour_card_title')}</p>
        <p className="text-xs text-muted">{t('landing.tour_card_sub')}</p>
      </div>
    </Point>
  )
}

function MixPoint() {
  const { t } = useTranslation()
  return (
    <Point
      bg="bg-[#FBE7DE]"
      eyebrowClass="text-[#9A3A17]"
      eyebrow={t('landing.mix_eyebrow')}
      title={t('landing.mix_title')}
      text={t('landing.mix_text')}
      back={<Shuffle size={170} strokeWidth={1.2} className="text-[#9A3A17]/10" />}
    >
      {/* A conversa no grupo — o mecanismo mostrado, não descrito. */}
      <div className="space-y-2" aria-hidden="true">
        <div className="max-w-[80%] rounded-ctrl rounded-bl-sm bg-white px-3 py-2 text-sm text-ink-900 shadow-card">
          {t('landing.whatsapp_demo_prompt')}
        </div>
        <div className="ml-auto max-w-[40%] rounded-ctrl rounded-br-sm bg-[#25D366] px-3 py-2 text-center text-sm font-extrabold text-ink-900">
          {t('landing.whatsapp_demo_reply')}
        </div>
        <p className="flex items-center justify-end gap-1.5 text-xs font-extrabold text-ok">
          <CheckCircle2 size={13} /> {t('landing.whatsapp_demo_confirmation')}
        </p>
      </div>
    </Point>
  )
}

/* A faixa de quem organiza, com o contacto (reparos de 26 set, aprovados
   pelo Francisco): os planos e o WhatsApp, e o Email ao lado quando a caixa
   existir (#572). Os contactos vêm do contacts.js, como na página Planos. */
function OrganizersBar() {
  const { t } = useTranslation()
  const contact = 'inline-flex flex-1 items-center justify-center gap-2 min-h-[48px] rounded-ctrl px-4 font-extrabold border border-ink-900 bg-white text-ink-900 hover:bg-ink-50'
  return (
    <section className="bg-white border-y border-line">
      <div className="max-w-5xl mx-auto px-5 py-8">
        <div className="max-w-md">
          <h2 className="text-2xl text-ink-900">{t('landing.organizers_text')}</h2>
          <p className="text-ink-700 mt-1">{t('landing.organizers_contact_text')}</p>
          <div className="mt-4 flex gap-3">
            {SUPPORT_EMAIL_READY && (
              <a href={mailtoLink(t('plans.email_subject'))} className={contact}>
                <Mail size={18} /> {t('plans.email')}
              </a>
            )}
            <a href={whatsappContactLink(t('plans.whatsapp_text'))} target="_blank" rel="noopener noreferrer" className={contact}>
              <MessageCircle size={18} /> {t('landing.organizers_whatsapp')}
            </a>
          </div>
          <Link to="/planos" className="mt-3 inline-flex items-center gap-1 min-h-[44px] text-sm font-extrabold text-ink-900 hover:underline">
            {t('landing.organizers_link')} <ChevronRight size={16} />
          </Link>
        </div>
      </div>
    </section>
  )
}

// Planos (nomes fechados 15 set 2026 — Free/Squad/Community/Club; chaves
// internas free/plus/pro/club, as mesmas de organizations.plan_tier). Ainda
// não há subscrições: só o Free tem botão, os pagos dizem "em breve". O que
// não existe no produto vai marcado "em breve" — nada de "mais escolhido" ou
// outros sinais inventados (PRODUCT.md). Preços de lançamento, por validar.
export const PLANS = [
  { key: 'free', name: 'Free', features: [['f1'], ['f2'], ['f3']] },
  { key: 'plus', name: 'Squad', features: [['f1'], ['f2'], ['f3']] },
  // Torneios já existem; a liga ainda não (Francisco, 25 set; Trello #538).
  { key: 'pro', name: 'Community', highlight: true, features: [['f1'], ['f2'], ['f3'], ['f4'], ['f5'], ['f6', 'soon']] },
  { key: 'club', name: 'Club', features: [['f1'], ['f2', 'soon'], ['f3', 'soon'], ['f4', 'soon']] },
]

export function PlanCard({ plan }) {
  const { t } = useTranslation()
  const loginHref = useLoginHref()
  const dark = plan.highlight
  return (
    <div className={`rounded-card p-6 flex flex-col ${dark ? 'bg-ink-900 text-white' : 'bg-surface border border-line'}`}>
      <h3 className={`text-xl ${dark ? 'text-white' : 'text-ink-900'}`}>{plan.name}</h3>
      <p className={`text-sm mt-1 ${dark ? 'text-ink-200' : 'text-muted'}`}>{t(`landing.plan_${plan.key}_for`)}</p>
      <p className="mt-5 flex items-baseline gap-1">
        <span className={`text-3xl font-extrabold tabular-nums ${dark ? 'text-white' : 'text-ink-900'}`}>{t(`landing.plan_${plan.key}_price`)}</span>
        {plan.key !== 'free' && (
          <span className={`text-sm ${dark ? 'text-ink-200' : 'text-muted'}`}>{t('landing.pricing_per_month')}</span>
        )}
      </p>
      <ul className="mt-5 space-y-2.5 flex-1">
        {plan.features.map(([f, soon]) => (
          <li key={f} className={`flex items-start gap-2 text-sm ${soon ? (dark ? 'text-ink-200' : 'text-muted') : (dark ? 'text-white' : 'text-ink-900')}`}>
            <CheckCircle2 size={16} className={`shrink-0 mt-0.5 ${soon ? 'opacity-40' : (dark ? 'text-lime-400' : 'text-lime-600')}`} />
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
              {t(`landing.plan_${plan.key}_${f}`)}
              {soon && (
                <span className={`rounded-full px-1.5 py-px text-[10px] leading-[14px] font-extrabold ${dark ? 'bg-white/10 text-ink-200' : 'bg-canvas border border-line text-ink-700'}`}>
                  {t('landing.pricing_soon')}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-6">
        {plan.key === 'free' ? (
          <Link to={loginHref('signup')} className={`${PRIMARY_CTA} w-full inline-flex items-center justify-center`}>
            {t('landing.plan_free_cta')}
          </Link>
        ) : (
          <p className={`min-h-[48px] flex items-center justify-center rounded-ctrl text-sm font-extrabold border border-dashed ${dark ? 'border-white/20 text-ink-200' : 'border-line text-muted'}`}>
            {t('landing.pricing_paid_soon')}
          </p>
        )}
      </div>
    </div>
  )
}

// ── PREÇOS NA PÁGINA PRINCIPAL ────────────────────────────────────────────
// Os planos e os preços ficam só em /planos; aqui fica a faixa «Ver os
// planos ›» (Francisco, 26 set: «se não gostarem a gente volta a alterar»).
// Para os voltar a mostrar aqui, basta passar isto a true.
const SHOW_PRICES_ON_HOME = false

export function PlansGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {PLANS.map((plan) => <PlanCard key={plan.key} plan={plan} />)}
    </div>
  )
}

function Pricing() {
  const { t } = useTranslation()
  return (
    <section id="planos" className="bg-canvas py-16 px-5 scroll-mt-16">
      <div className="max-w-5xl mx-auto">
        <div className="text-center max-w-lg mx-auto mb-10">
          <h2 className="text-3xl text-ink-900">{t('landing.pricing_heading')}</h2>
          <p className="text-muted mt-3">{t('landing.pricing_intro')}</p>
        </div>
        <PlansGrid />
        <p className="text-xs text-muted text-center mt-8 max-w-lg mx-auto">{t('landing.pricing_footnote')}</p>
      </div>
    </section>
  )
}

function ClosingCta() {
  const { t } = useTranslation()
  const loginHref = useLoginHref()
  return (
    <section className="bg-ink-900 pt-16 pb-12 px-5 text-center">
      <div className="max-w-lg mx-auto">
        <h2 className="text-3xl text-white mb-6">{t('landing.closing_cta_heading')}</h2>
        <Link to={loginHref('signup')} className={`${PRIMARY_CTA} inline-flex w-full sm:w-auto items-center justify-center`}>
          {t('landing.signup_link')}
        </Link>
        <p className="text-sm text-ink-200 mt-3">{t('landing.free_google')}</p>
      </div>
    </section>
  )
}

// Rodapé em preto, colado ao fim (Night Court).
export function Footer() {
  const { t } = useTranslation()
  const year = new Date().getFullYear()
  const loginHref = useLoginHref()
  const link = 'inline-flex items-center min-h-[44px] px-1 text-white/80 hover:text-white font-extrabold text-sm'
  return (
    <footer className="bg-ink-900 border-t border-white/10 py-6 px-5">
      <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
        <div className="flex flex-wrap items-center justify-center gap-x-5">
          <Link to={loginHref()} className={link}>{t('landing.login_link')}</Link>
          <Link to="/instrucoes" className={link}>{t('landing.instructions_link')}</Link>
          <Link to="/termos" className={link}>{t('landing.terms_link')}</Link>
          <Link to="/privacidade" className={link}>{t('landing.privacy_link')}</Link>
        </div>
        <p className="text-white/50 text-xs">&copy; {year} alinho</p>
      </div>
    </footer>
  )
}

export default function Landing() {
  usePageTop()
  return (
    <div className="min-h-screen bg-[#F7F7F4]">
      <Nav />
      <Hero />
      <LevelPoint />
      <TournamentPoint />
      <MixPoint />
      {/* Espaço guardado (SPEC, ponto 5): «Já se joga na alinho», só com
          clubes e só com autorização escrita de cada um. Não aparece até lá. */}
      <OrganizersBar />
      {SHOW_PRICES_ON_HOME && <Pricing />}
      <ClosingCta />
      <Footer />
    </div>
  )
}
