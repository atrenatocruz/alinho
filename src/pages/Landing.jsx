import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Check, ChevronRight, Mail, MessageCircle } from 'lucide-react'
import { MedalGrid, Highlights, SITE_DARK } from '../components/site/MedalShowcase'
import { SiteHeader, SiteFooter, useLoginHref, usePageTop } from '../components/site/SiteChrome'
import { WaysSection, BotSection, SITE_EYEBROW, SITE_H2, SITE_LEAD, SITE_ILL } from '../components/site/SiteWays'
import { mailtoLink, whatsappContactLink, SUPPORT_EMAIL_READY } from '../lib/contacts'
import { PartnerCard, YourBusinessCard, usePublicPartners } from '../components/site/PartnerCards'
import { useFeatureFlag } from '../lib/useFeatureFlag'
import { formatCurrency } from '../lib/formatDate'

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
    // No computador, o «Criar conta» à vista ao abrir (Francisco, 22 out;
    // design-handoff/2026-10-22-entrada-site-primeiro-ecra): o texto começa em
    // cima, alinhado com o topo do telemóvel, e a secção sobe 40 px. Os
    // tamanhos e o telemóvel no ecrã pequeno ficam iguais.
    <section className="overflow-hidden bg-[#F7F7F4] pb-12 pt-10 lg:pb-[100px] lg:pt-10">
      <div className="mx-auto grid max-w-[1200px] items-center gap-10 px-5 lg:grid-cols-2 lg:items-start lg:gap-20 lg:px-10">
        <div className="animate-fade-up lg:pt-6">
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

/* «Parceiros do alinho.pt», logo a seguir ao ranking, que é o que dá os
   prémios (design-handoff/2026-10-28-site-menu-e-parceiros, ponto 4; Francisco,
   28 out): um resumo da /parceiros, com os mesmos cartões. Com mais parceiros,
   no telemóvel ficam lado a lado e deslizam; o tracejado «O teu negócio aqui?»
   só no computador. Só com o interruptor «parceiros» ligado. */
function PartnersSection() {
  const { t } = useTranslation()
  const { on } = useFeatureFlag('parceiros')
  const partners = usePublicPartners(on)
  if (!on || !partners?.length) return null
  return (
    <section className="bg-[#F7F7F4] py-16 lg:py-[90px]">
      <div className="mx-auto max-w-[1200px] px-5 lg:px-10">
        <p className={`${SITE_EYEBROW} text-[#5B6068]`}>{t('partners.eyebrow')}</p>
        <h2 className={`${SITE_H2} mt-3 max-w-[16ch]`}>{t('partners.title')}</h2>
        <p className={SITE_LEAD}>{t('partners.lead')}</p>
        <div className="no-scrollbar -mx-5 mt-8 flex snap-x gap-[18px] overflow-x-auto px-5 sm:mx-0 sm:grid sm:overflow-visible sm:px-0 sm:[grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
          {partners.map((p) => (
            <PartnerCard key={p.id || p.slug} p={p} className={`snap-start sm:w-auto ${partners.length > 1 ? 'w-[min(320px,85%)] shrink-0' : 'w-full'}`} />
          ))}
          <YourBusinessCard className="hidden sm:grid" />
        </div>
        <Link to="/parceiros" className="mt-6 inline-block font-display text-[16px] font-extrabold text-ink-900 underline underline-offset-4">{t('partners.see_all')}</Link>
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
//
// Desde 29 out (#739, design-handoff/2026-10-29-planos-de-clube/SPEC-PAGINA.md,
// aprovado pelo Francisco): os grupos (Free, Squad, Community) e os clubes
// (Club e Club Premium «em breve») em separado, e o cartão com a faixa de cor
// e o Alino em cima. `features` são as chaves inteiras das linhas.
export const PLANS = [
  // Todos os grupos têm jogos do grupo (Francisco, 21 out); o Squad herda-os
  // em «Tudo o que o Free tem».
  { key: 'free', name: 'Free', kind: 'groups', band: '#E9F5C2', pose: 'ola',
    features: ['landing.plan_free_f1', 'landing.plan_free_f2', 'landing.plan_free_f3', 'landing.plan_free_f4'] },
  { key: 'plus', name: 'Squad', kind: 'groups', band: '#C5DF00', pose: 'polegar',
    features: ['landing.plan_plus_f1', 'landing.plan_plus_f2', 'landing.plan_plus_f3'] },
  { key: 'pro', name: 'Community', kind: 'groups', band: '#040404', dark: true, pose: 'telemovel',
    features: ['landing.plan_pro_f1', 'landing.plan_pro_f2', 'landing.plan_pro_f3', 'landing.plan_pro_f4',
      'landing.plan_community_tournaments_league', 'landing.plan_pro_f7'] },
  // O Club é para clubes com campos; as reservas e os pagamentos passam ao
  // Club Premium, que ainda não abriu (29 out).
  { key: 'club', name: 'Club', kind: 'clubs', band: '#1F2A1A', dark: true, pose: 'trofeu',
    features: ['landing.plan_club_f1', 'landing.plan_club_f5', 'landing.plan_club_f2'] },
  { key: 'premium', name: 'Club Premium', kind: 'clubs', band: '#F4F5F1', soon: true, pose: 'a-espreitar',
    features: ['landing.plan_premium_f1', 'landing.plan_premium_f2', 'landing.plan_premium_f3', 'landing.plan_premium_f4'] },
]
export const GROUP_PLANS = PLANS.filter((p) => p.kind === 'groups')
export const CLUB_PLANS = PLANS.filter((p) => p.kind === 'clubs')

// O preço por ano, para a linha «ou … por ano» (os de plan_prices; o do mês
// fica no texto landing.plan_*_price).
export const PLAN_YEARLY = { plus: 49.9, pro: 149.9, club: 199.9 }

// As medidas do site e, com `compact`, as da app (SPEC-PAGINA, ponto 3).
const SIZES = {
  site: { band: 'h-[158px] px-[22px] pt-5', name: 'text-[30px]', lead: 'max-w-[58%] text-[14px]', alino: 150, trophy: 160,
    body: 'px-[22px] pb-[22px] pt-5', price: 'text-[40px]', soonPrice: 'text-[22px]', line: 'text-[14.5px]' },
  app: { band: 'h-[118px] px-[18px] pt-4', name: 'text-[24px]', lead: 'max-w-[62%] text-[13px]', alino: 118, trophy: 116,
    body: 'px-[18px] pb-[18px] pt-4', price: 'text-[32px]', soonPrice: 'text-[18px]', line: 'text-[13.5px]' },
}

function SoonPill() {
  const { t } = useTranslation()
  return (
    <span className="inline-block shrink-0 rounded-full border border-[#CFD2D7] bg-white px-2 py-[3px] font-sans text-[10.5px] font-extrabold leading-none tracking-normal text-ink-700">
      {t('landing.pricing_soon')}
    </span>
  )
}

/** O cartão de um plano. `compact`: as medidas da app. `chip`: a pastilha
 *  lima na faixa, no lugar da frase («O teu plano», «Pedido enviado…»).
 *  `mine`: contorno preto. `extra`: por baixo do preço (o «pago até» da app).
 *  `children`: os botões da app (que pode não ter nenhum); no site, os do site. */
export function PlanCard({ plan, compact = false, chip = null, mine = false, extra = null, children = null }) {
  const { t, i18n } = useTranslation()
  const loginHref = useLoginHref()
  const s = SIZES[compact ? 'app' : 'site']
  const trophy = plan.pose === 'trofeu'
  const frame = mine ? 'border-[2.5px] border-ink-900' : plan.soon ? 'border-[1.5px] border-dashed border-[#CFD2D7]' : 'border border-[#E5E6E1]'
  return (
    <div className={`flex h-full flex-col overflow-hidden bg-white ${compact ? 'rounded-[20px]' : 'rounded-[22px]'} ${frame}`}>
      <div className={`relative shrink-0 overflow-hidden ${s.band} ${plan.soon ? 'border-b-[1.5px] border-dashed border-[#CFD2D7]' : ''}`} style={{ backgroundColor: plan.band }}>
        <h3 className={`relative z-[1] flex items-center gap-2 font-display font-black leading-none tracking-[-.02em] ${s.name} ${plan.dark ? 'text-white' : 'text-ink-900'}`}>
          {plan.name}
        </h3>
        {chip ? (
          // Na faixa lima do Squad, a pastilha lima não se via: lá vai branca.
          <span className={`relative z-[1] mt-2 inline-block rounded-full px-2.5 py-1 text-xs font-extrabold text-ink-900 ${plan.key === 'plus' ? 'bg-white' : 'bg-lime-400'}`}>{chip}</span>
        ) : (
          <p className={`relative z-[1] mt-2 font-semibold leading-snug ${s.lead} ${plan.dark ? 'text-[#D4D7CF]' : 'text-ink-900'}`}>{t(`landing.plan_${plan.key}_for`)}</p>
        )}
        {/* O Alino encostado ao fundo da faixa e cortado por ela; o da taça
            mais para dentro e sem descer, para a taça não ficar cortada. O do
            Club Premium mais para fora, cortado também à direita, para o nome
            ficar a 8 px ou mais da fita (UX, 1 nov). */}
        <img src={`/alino/alino-${plan.pose}${compact ? '' : '@2x'}.webp`} srcSet={compact ? `/alino/alino-${plan.pose}@2x.webp 2x` : undefined}
          alt="" aria-hidden="true" loading="lazy" decoding="async" draggable={false}
          className="pointer-events-none absolute select-none"
          style={{ height: trophy ? s.trophy : s.alino, width: 'auto', right: trophy ? (compact ? 12 : 14) : plan.soon && !compact ? -50 : -6, bottom: trophy ? 0 : (compact ? -10 : -14) }} />
      </div>
      <div className={`flex flex-1 flex-col ${s.body}`}>
        {plan.soon ? (
          <p className="flex items-center gap-2">
            <span className={`font-display font-extrabold leading-tight text-[#4B5563] ${s.soonPrice}`}>{t('landing.plan_premium_price')}</span>
            {/* Sempre aqui, no site e na app: ao lado do nome tocava no Alino (UX, 1 nov). */}
            <SoonPill />
          </p>
        ) : (
          <>
            <p className="flex items-baseline gap-1">
              <span className={`font-display font-black leading-none tabular-nums tracking-[-.02em] text-ink-900 ${s.price}`}>{t(`landing.plan_${plan.key}_price`)}</span>
              {plan.key !== 'free' && <span className="text-[15px] text-[#6B7079]">{t('landing.pricing_per_month')}</span>}
            </p>
            <p className="mt-1.5 text-[13.5px] text-[#4B5563]">
              {plan.key === 'free' ? t('landing.plan_free_forever') : t('landing.pricing_per_year', { price: formatCurrency(PLAN_YEARLY[plan.key], i18n.language) })}
            </p>
          </>
        )}
        {extra}
        <ul className={`mt-4 space-y-2.5 border-t border-[#EEEFEA] pt-4 ${compact ? '' : 'flex-1'}`}>
          {plan.features.map((key) => (
            <li key={key} className={`flex items-start gap-2.5 font-medium leading-snug ${s.line} ${plan.soon ? 'text-[#4B5563]' : 'text-ink-900'}`}>
              <span className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${plan.soon ? 'bg-[#E5E7E1] text-[#6B7079]' : 'bg-lime-400 text-ink-900'}`}>
                <Check size={12} strokeWidth={3.5} />
              </span>
              {t(key)}
            </li>
          ))}
        </ul>
        {compact ? children : !plan.soon && (
          <div className="mt-6">
            {plan.key === 'free' ? (
              <Link to={loginHref('signup')} className={`${PRIMARY_CTA} w-full inline-flex items-center justify-center`}>
                {t('landing.plan_free_cta')}
              </Link>
            ) : (
              <p className="flex min-h-[48px] items-center justify-center rounded-ctrl border border-dashed border-line text-sm font-extrabold text-muted">
                {t('landing.pricing_paid_soon')}
              </p>
            )}
          </div>
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

// Lado a lado só quando o nome não chega ao Alino (8 px de folga; UX, 1 nov),
// e nunca um cartão sozinho numa fila: os dois dos clubes a partir de 768 px;
// os três dos grupos a partir de 1100 px e, até lá, um por baixo do outro,
// centrados e com 520 px no máximo, para a faixa não esticar.
export function PlansGrid({ plans = GROUP_PLANS }) {
  if (plans.length > 2) {
    return (
      <div className="grid grid-cols-1 gap-4 min-[1100px]:grid-cols-3">
        {plans.map((plan) => (
          <div key={plan.key} className="mx-auto w-full max-w-[520px] min-[1100px]:max-w-none">
            <PlanCard plan={plan} />
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:max-w-[800px]">
      {plans.map((plan) => <PlanCard key={plan.key} plan={plan} />)}
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
      <PartnersSection />
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
