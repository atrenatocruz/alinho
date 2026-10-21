import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, ChevronRight, Mail, MessageCircle } from 'lucide-react'
import { MedalGrid, Highlights, SITE_DARK } from '../components/site/MedalShowcase'
import { SiteHeader, SiteFooter, useLoginHref, usePageTop } from '../components/site/SiteChrome'
import { WaysSection, BotSection, SITE_EYEBROW, SITE_H2, SITE_LEAD, SITE_ILL } from '../components/site/SiteWays'
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

// O «Entrar» e os links do site vivem no cabeçalho comum (SiteChrome).
export { useLoginHref }

export { usePageTop }

/* O lima escuro é o «passar o rato». Num telemóvel fica preso no botão que
   estava debaixo do dedo e parecia desativado (Francisco, 26 set). Sem rato,
   fica o lima de sempre. */
export const PRIMARY_CTA = 'btn-primary [@media(hover:none)]:hover:bg-lime-400'

// O cabeçalho e o rodapé comuns do site (site arrumado, 17 out): os nomes
// antigos ficam, para as páginas que os importam daqui.
export const Nav = SiteHeader
export const Footer = SiteFooter

// Um telemóvel com uma imagem da app da conta de EXEMPLO (Jogador Alinho,
// Maré Alta) — nunca uma conta real, nem com nomes desfocados (Francisco,
// 25 set). No computador, 340 px (site arrumado, 17 out).
function Phone({ src, alt, w, h, small = false, cut = false }) {
  return (
    <div className={`relative mx-auto ${small ? 'w-[260px] lg:w-[300px]' : 'w-[280px] lg:w-[340px]'}`}>
      <div className={cut ? 'h-[440px] overflow-hidden lg:h-auto' : ''}>
        <div className="rounded-[46px] bg-[#0B0C0E] p-[10px] shadow-[0_30px_60px_-30px_rgba(17,17,17,0.45)] lg:rounded-[48px] lg:p-3">
          <img src={src} alt={alt} width={w} height={h} loading="lazy" decoding="async" className="block w-full rounded-[36px] lg:rounded-[37px]" />
        </div>
      </div>
    </div>
  )
}

// Os botões do site: empilhados, nunca lado a lado; 380 px no computador.
const BTN = 'inline-flex w-full items-center justify-center gap-2 rounded-[16px] px-4 py-[18px] font-display text-[17px] font-extrabold leading-none transition-transform duration-fast active:scale-[0.98]'

function Hero() {
  const { t } = useTranslation()
  const loginHref = useLoginHref()
  return (
    <section className="overflow-hidden bg-[#F7F7F4] pb-12 pt-10 lg:pb-[100px] lg:pt-20">
      <div className="mx-auto grid max-w-[1200px] items-center gap-10 px-5 lg:grid-cols-2 lg:gap-20 lg:px-10">
        <div className="animate-fade-up">
          <h1 className="font-display text-[40px] font-black leading-[1.02] tracking-[-.035em] text-ink-900 [text-wrap:balance] sm:text-[56px] lg:text-[76px] lg:leading-none">
            {t('landing.hero_title')}
          </h1>
          <p className={SITE_LEAD}>{t('landing.hero_description')}</p>
          {/* «Criar conta» é a única coisa lima do ecrã. */}
          <div className="mt-8 flex max-w-[380px] flex-col gap-3">
            <Link to={loginHref('signup')} className={`${BTN} bg-lime-400 text-ink-900`}>{t('landing.signup_link')}</Link>
            <Link to={loginHref()} className={`${BTN} border-[1.5px] border-[#CFD2D7] bg-white text-ink-900`}>{t('landing.already_account_link')}</Link>
          </div>
          <p className="mt-3 max-w-[380px] text-center text-sm text-[#5B6068]">{t('landing.free_google')}</p>
        </div>
        <div className="animate-fade-up">
          <Phone src="/landing/home-exemplo.webp" alt={t('landing.phone_alt')} w={640} h={1385} cut />
          <p className={SITE_ILL}>{t('landing.illustrative')}</p>
        </div>
      </div>
    </section>
  )
}

// Ranking e conquistas (12 out): o primeiro bloco a seguir ao topo, escuro
// como os cartões das conquistas na app, para as medalhas brilharem. Sem
// botões (só há um lima por ecrã).
function RankingPoint() {
  const { t } = useTranslation()
  return (
    <section className={`relative overflow-hidden ${SITE_DARK} py-16 lg:py-[110px]`}>
      <div className="relative mx-auto grid max-w-[1200px] items-center gap-10 px-5 lg:grid-cols-2 lg:gap-20 lg:px-10">
        <div>
          <p className={`${SITE_EYEBROW} text-lime-400`}>{t('landing.rank_eyebrow')}</p>
          <h2 className={`${SITE_H2} mt-3 !text-white`}>{t('landing.rank_title')}</h2>
          <p className={`${SITE_LEAD} !text-[#C9CDD3]`}>{t('landing.rank_text')}</p>
          <MedalGrid className="mt-8 lg:hidden" />
          <div className="mt-8 max-w-[460px]"><Highlights /></div>
        </div>
        <MedalGrid className="hidden w-full max-w-[520px] lg:ml-auto lg:block" />
      </div>
    </section>
  )
}

/* Quem organiza: o texto e os botões de um lado, o Gerir do outro. Os
   planos não se repetem (vivem em /planos): fica só «Ver os planos ›». Os
   contactos vêm do contacts.js, como na página Planos. */
function OrganizersBar() {
  const { t } = useTranslation()
  return (
    <section className="bg-white py-16 lg:py-[110px]">
      <div className="mx-auto grid max-w-[1200px] items-center gap-10 px-5 lg:grid-cols-2 lg:gap-20 lg:px-10">
        <div>
          <p className={`${SITE_EYEBROW} text-[#5B6068]`}>{t('landing.organizers_eyebrow')}</p>
          <h2 className={`${SITE_H2} mt-3`}>{t('landing.organizers_text')}</h2>
          {/* A mesma frase da linha verde-clara dos Planos (18 out). */}
          <p className="mt-4 inline-block rounded-[14px] bg-[#F4F8DC] px-3.5 py-2.5 font-display text-[15px] font-bold leading-snug text-[#3F6212]">{t('landing.organizers_free_pill')}</p>
          <p className={SITE_LEAD}>{t('landing.organizers_lead')}</p>
          <div className="mt-8 flex max-w-[380px] flex-col gap-3">
            <a href={whatsappContactLink(t('plans.whatsapp_text'))} target="_blank" rel="noopener noreferrer" className={`${BTN} bg-ink-900 text-white`}>
              <MessageCircle size={18} /> {t('landing.organizers_whatsapp')}
            </a>
            {SUPPORT_EMAIL_READY && (
              <a href={mailtoLink(t('plans.email_subject'))} className={`${BTN} border-[1.5px] border-[#CFD2D7] bg-white text-ink-900`}>
                <Mail size={18} /> {t('plans.email')}
              </a>
            )}
          </div>
          <Link to="/planos" className="mt-3 inline-flex min-h-[44px] items-center gap-1 text-sm font-bold text-ink-900">
            {t('landing.organizers_link')} <ChevronRight size={16} />
          </Link>
        </div>
        <div>
          <Phone src="/landing/gerir-exemplo.webp" alt={t('landing.gerir_alt')} w={540} h={1169} small />
          <p className={SITE_ILL}>{t('landing.illustrative')}</p>
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
  // Torneios e liga já existem (a liga entre clubes saiu no main de 16 out;
  // SPEC dos Planos, 18 out).
  { key: 'pro', name: 'Community', highlight: true, features: [['f1'], ['f2'], ['f3'], ['f4'], ['f5'], ['f6']] },
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
    <section className="bg-ink-900 px-5 pb-16 pt-16 text-center lg:pb-[90px] lg:pt-[110px]">
      <div className="mx-auto max-w-[1200px]">
        <h2 className={`${SITE_H2} !text-white`}>{t('landing.closing_cta_heading')}</h2>
        <div className="mx-auto mt-8 flex max-w-[380px] flex-col">
          <Link to={loginHref('signup')} className={`${BTN} bg-lime-400 text-ink-900`}>{t('landing.signup_link')}</Link>
        </div>
        <p className="mt-3 text-sm text-[#AEB3BB]">{t('landing.free_google')}</p>
      </div>
    </section>
  )
}

export default function Landing() {
  usePageTop()
  return (
    <div className="min-h-screen bg-[#F7F7F4]">
      <Nav />
      <Hero />
      <RankingPoint />
      <WaysSection />
      <BotSection />
      {/* Espaço guardado (SPEC, ponto 5): «Já se joga na alinho», só com
          clubes e só com autorização escrita de cada um. Não aparece até lá. */}
      <OrganizersBar />
      {SHOW_PRICES_ON_HOME && <Pricing />}
      <ClosingCta />
      <Footer />
    </div>
  )
}
