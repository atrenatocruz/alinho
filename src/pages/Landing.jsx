import { useState, useEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, MapPin, Lock, Calendar, Trophy, Users, MessageCircle } from 'lucide-react'
import { Wordmark } from '../components/Layout'
import PadelIcon from '../components/icons/PadelIcon'
import i18n from '../lib/i18n'

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

// Fires once, the first time the ref'd element enters the viewport — drives
// the .reveal / .reveal-visible transition (src/index.css) instead of a
// mount-time animation, so below-the-fold sections come alive as the visitor
// scrolls to them rather than animating uselessly offscreen on page load.
function useReveal() {
  const ref = useRef(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.2 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, visible]
}

// One-shot count from `start` to `target` on mount — used on the hero mock
// card so the player count visibly fills in, a small concrete stand-in for
// the real-time updates the copy promises. Skips straight to `target` under
// prefers-reduced-motion.
function useCountUp(target, start) {
  const [value, setValue] = useState(start)
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(target)
      return
    }
    let current = start
    const id = setInterval(() => {
      current += 1
      setValue(current)
      if (current >= target) clearInterval(id)
    }, 220)
    return () => clearInterval(id)
  }, [target, start])
  return value
}

// Builds the /login href, preserving ?org=<slug> from the current URL (the
// invite-link mechanism — see Home.jsx / Login.jsx) so landing-page CTAs
// don't silently drop it for logged-out visitors landing on `/?org=...`.
function useLoginHref() {
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

// Fixed nav — floats transparently over the hero, solidifies once scrolled
// past it, matching Layout.jsx's header treatment for logged-in pages.
function Nav() {
  const { t } = useTranslation()
  const [scrolled, setScrolled] = useState(false)
  const loginHref = useLoginHref()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={`fixed top-0 inset-x-0 z-20 transition-colors duration-base ${
        scrolled
          ? 'bg-ink-900/95 backdrop-blur-xl border-b border-white/5 supports-[backdrop-filter]:bg-ink-900/85'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-5xl mx-auto px-5 h-16 flex items-center justify-between">
        <Link to="/" className="leading-none">
          <Wordmark />
        </Link>
        <div className="flex items-center gap-4">
          <LanguageToggle className="text-white/80 hover:text-white" />
          <Link
            to={loginHref()}
            className="inline-flex items-center min-h-[44px] px-1 text-white/80 hover:text-white font-extrabold text-sm transition-colors duration-fast"
          >
            {t('landing.login_link')}
          </Link>
          {/* Hidden on narrow mobile to avoid crowding — the hero below
              already carries a full-size "Criar conta" CTA. */}
          {/* `.btn-primary` only ever styles real <button> elements elsewhere
              in this codebase (see src/components/ui.jsx)
              — it relies on min-h-[48px], which has no effect on the default
              `display: inline` a Link/<a> renders as. inline-flex + centering
              utilities are required here so the link actually sizes and
              centers like a button. */}
          <Link
            to={loginHref('signup')}
            className="btn-primary hidden sm:inline-flex items-center justify-center"
          >
            {t('landing.signup_link')}
          </Link>
        </div>
      </div>
    </header>
  )
}

// Illustrative mockup of a real game card (same visual grammar as
// MixCard in src/components/ui.jsx) — hardcoded content, no live data,
// no screenshot asset needed.
function HeroMockCard() {
  const { t } = useTranslation()
  const players = useCountUp(8, 5)
  return (
    <div className="card w-full max-w-sm shadow-lift" style={{ transform: 'rotate(-3deg)' }}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-widest text-ink-700">{t('landing.saturday')}</p>
          <p className="text-2xl text-ink-900 leading-tight">18:00</p>
        </div>
        <span className="inline-flex items-center gap-1.5 bg-lime-400 text-ink-900 text-xs font-extrabold px-3 py-1.5 rounded-full">
          <CheckCircle2 size={14} /> {t('landing.joined_badge')}
        </span>
      </div>

      <h3 className="text-lg text-ink-900 leading-snug mb-1">{t('landing.hero_card_title')}</h3>
      <p className="flex items-center gap-1.5 text-muted text-sm mb-4">
        <MapPin size={15} className="shrink-0" /> {t('landing.hero_card_location')}
      </p>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-3 border-t border-line">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex -space-x-2">
            {/* 8 players spelling "ALINHOPT" — a small branding wink in the
                illustrative mockup, not real data. */}
            {['A', 'L', 'I', 'N', 'H', 'O', 'P', 'T'].map((letter, i, letters) => (
              <div
                key={letter}
                style={{ zIndex: letters.length - i }}
                className="w-9 h-9 text-sm rounded-full flex items-center justify-center shrink-0 font-extrabold bg-ink-700 text-white ring-2 ring-surface"
              >
                {letter}
              </div>
            ))}
          </div>
          <span className="text-sm font-extrabold text-ink-900 tabular-nums">
            {players}<span className="text-muted font-normal">{t('landing.hero_card_players')}</span>
          </span>
        </div>
        <span className="ml-auto inline-flex items-center gap-1.5 bg-ok/10 text-ok text-[11px] font-extrabold px-2.5 py-1 rounded-full">
          <Lock size={13} className="shrink-0" /> {t('landing.hero_card_status')}
        </span>
      </div>
    </div>
  )
}

function Hero() {
  const { t } = useTranslation()
  const loginHref = useLoginHref()
  return (
    <section className="relative bg-ink-900 overflow-hidden">
      {/* Court lines + dashed net-line motif, evolved from Login.jsx's hero */}
      <svg
        viewBox="0 0 800 500"
        className="absolute inset-0 w-full h-full text-white/[0.05]"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <rect x="60" y="-60" width="680" height="600" rx="24" stroke="currentColor" strokeWidth="3" fill="none" />
        <line x1="400" y1="-60" x2="400" y2="540" stroke="currentColor" strokeWidth="3" />
        <line x1="60" y1="240" x2="740" y2="240" stroke="currentColor" strokeWidth="3" strokeDasharray="10 12" />
      </svg>

      <div className="relative max-w-5xl mx-auto px-5 pt-20 pb-24 lg:pt-28 lg:pb-32 lg:flex lg:items-center lg:gap-12">
        <div className="lg:flex-1 animate-fade-up">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl text-white leading-tight max-w-xl">
            {t('landing.hero_title')}
          </h1>
          <p className="text-ink-200 text-lg mt-5 max-w-md">
            {t('landing.hero_description')}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 mt-8">
            {/* Both CTAs need inline-flex + centering utilities explicitly —
                min-h-[48px] and vertical padding have no effect on the
                default `display: inline` a Link/<a> renders as. */}
            <Link
              to={loginHref('signup')}
              className="btn-primary inline-flex items-center justify-center"
            >
              {t('landing.signup_link')}
            </Link>
            <Link
              to={loginHref()}
              className="inline-flex items-center justify-center font-extrabold py-3.5 px-6 rounded-ctrl min-h-[48px] text-base
                         border border-white/20 text-white hover:bg-white/10
                         transition-all duration-fast active:scale-[0.98]"
            >
              {t('landing.already_account_link')}
            </Link>
          </div>
        </div>

        <div className="mt-14 lg:mt-0 lg:flex-1 flex justify-center animate-fade-up">
          <HeroMockCard />
        </div>
      </div>
    </section>
  )
}

// WhatsApp bot gets its own spotlighted tile below (see Features) — it's
// alinho's real differentiator per PRODUCT.md's Positioning (meet players in
// the chat thread they already use), not just another item in a grid.
// Translation keys are resolved in Features component, not here
const OTHER_FEATURES = [
  {
    icon: Calendar,
    titleKey: 'landing.feature_games_title',
    descriptionKey: 'landing.feature_games_description',
  },
  {
    icon: Trophy,
    titleKey: 'landing.feature_rankings_title',
    descriptionKey: 'landing.feature_rankings_description',
  },
  {
    icon: Users,
    titleKey: 'landing.feature_community_title',
    descriptionKey: 'landing.feature_community_description',
  },
  {
    icon: PadelIcon,
    titleKey: 'landing.feature_clubs_title',
    descriptionKey: 'landing.feature_clubs_description',
  },
  {
    icon: Lock,
    titleKey: 'landing.feature_private_games_title',
    descriptionKey: 'landing.feature_private_games_description',
  },
]

// Shows the actual mechanism instead of describing it: a bot prompt and the
// one-word reply that's alinho's real differentiator (PRODUCT.md Positioning).
// Plays once, staggered, the first time the tile scrolls into view.
function WhatsAppDemo({ visible }) {
  const { t } = useTranslation()
  const reveal = (delayMs) => ({
    transitionDelay: `${delayMs}ms`,
  })
  return (
    <div className="mt-6 space-y-2" aria-hidden="true">
      <div
        className={`reveal ${visible ? 'reveal-visible' : ''} max-w-[85%] rounded-ctrl rounded-bl-sm bg-white/10 text-ink-200 text-xs px-3 py-2`}
        style={reveal(0)}
      >
        {t('landing.whatsapp_demo_prompt')}
      </div>
      <div
        className={`reveal ${visible ? 'reveal-visible' : ''} max-w-[45%] ml-auto rounded-ctrl rounded-br-sm bg-[#25D366] text-ink-900 text-xs font-extrabold px-3 py-2 text-center`}
        style={reveal(500)}
      >
        {t('landing.whatsapp_demo_reply')}
      </div>
      <div
        className={`reveal ${visible ? 'reveal-visible' : ''} flex items-center gap-1.5 text-[11px] text-lime-400 font-extrabold pt-1`}
        style={reveal(950)}
      >
        <CheckCircle2 size={12} /> {t('landing.whatsapp_demo_confirmation')}
      </div>
    </div>
  )
}

function FeatureRow({ icon: Icon, titleKey, descriptionKey }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-start gap-4 py-5 first:pt-0">
      <div className="w-10 h-10 shrink-0 rounded-full bg-lime-400/15 text-lime-600 flex items-center justify-center">
        <Icon size={18} />
      </div>
      <div>
        <h3 className="text-base font-semibold text-ink-900 mb-0.5">{t(titleKey)}</h3>
        <p className="text-sm text-muted">{t(descriptionKey)}</p>
      </div>
    </div>
  )
}

// One spotlighted tile (the real differentiator, per PRODUCT.md) beside a
// plain divided list for the rest — deliberately not six identical cards.
function Features() {
  const { t } = useTranslation()
  const [whatsappRef, whatsappVisible] = useReveal()
  return (
    <section className="bg-canvas py-20 px-5">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-3xl text-ink-900 max-w-lg mb-12">{t('landing.features_heading')}</h2>
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-x-10 gap-y-8">
          <div ref={whatsappRef} className="lg:col-span-2 rounded-card bg-ink-900 p-7 flex flex-col justify-between min-h-[240px]">
            <div>
              <div className="w-11 h-11 rounded-full bg-[#25D366]/15 text-[#25D366] flex items-center justify-center mb-5">
                <MessageCircle size={20} />
              </div>
              <h3 className="text-xl text-white mb-2">{t('landing.whatsapp_bot_title')}</h3>
              <p className="text-ink-200 text-sm leading-relaxed">
                {t('landing.whatsapp_bot_description')}
              </p>
              <WhatsAppDemo visible={whatsappVisible} />
            </div>
          </div>
          <div className="lg:col-span-3 divide-y divide-line border-t border-line lg:border-t-0">
            {OTHER_FEATURES.map((f) => (
              <FeatureRow key={f.titleKey} {...f} />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

const STEPS = [
  {
    number: '1',
    titleKey: 'landing.step_1_title',
    descriptionKey: 'landing.step_1_description',
  },
  {
    number: '2',
    titleKey: 'landing.step_2_title',
    descriptionKey: 'landing.step_2_description',
  },
  {
    number: '3',
    titleKey: 'landing.step_3_title',
    descriptionKey: 'landing.step_3_description',
  },
]

function HowItWorks() {
  const { t } = useTranslation()
  return (
    <section className="bg-surface py-20 px-5">
      <div className="max-w-5xl mx-auto">
        <div className="text-center max-w-lg mx-auto mb-12">
          <h2 className="text-3xl text-ink-900">{t('landing.steps_heading')}</h2>
        </div>
        <div className="relative grid grid-cols-1 lg:grid-cols-3 gap-8 lg:gap-5">
          {/* One dashed line spanning from the first circle's center to the
              last circle's center, painted BEHIND the step circles (it's
              the first child, so DOM/paint order puts every later sibling
              on top) — their opaque bg-ink-900 masks the line where it
              passes under them, giving a continuous "through the circles"
              look without fragile per-gap calc() math tied to column width. */}
          <div
            className="hidden lg:block absolute top-6 h-px border-t-2 border-dashed border-line"
            style={{ left: 'calc(100% / 6)', right: 'calc(100% / 6)' }}
            aria-hidden="true"
          />
          {STEPS.map((step) => (
            <div key={step.number} className="relative">
              <div className="relative w-12 h-12 rounded-full bg-ink-900 text-lime-400 font-mono font-extrabold text-lg flex items-center justify-center mb-4 mx-auto">
                {step.number}
              </div>
              <h3 className="text-lg text-ink-900 mb-1.5 text-center">{t(step.titleKey)}</h3>
              <p className="text-sm text-muted text-center">{t(step.descriptionKey)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function ClosingCta() {
  const { t } = useTranslation()
  const loginHref = useLoginHref()
  return (
    <section className="bg-ink-900 py-16 px-5 text-center">
      <div className="max-w-lg mx-auto">
        <h2 className="text-3xl text-white mb-6">{t('landing.closing_cta_heading')}</h2>
        <Link
          to={loginHref('signup')}
          className="btn-primary inline-flex items-center justify-center"
        >
          {t('landing.signup_link')}
        </Link>
      </div>
    </section>
  )
}

function Footer() {
  const { t } = useTranslation()
  const year = new Date().getFullYear()
  const loginHref = useLoginHref()
  return (
    <footer className="bg-canvas py-10 px-5 border-t border-line">
      <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <Wordmark variant="light" />
        <div className="flex items-center gap-6">
          <Link to={loginHref()} className="inline-flex items-center min-h-[44px] px-1 text-ink-700 font-extrabold text-sm hover:underline">
            {t('landing.login_link')}
          </Link>
          <Link to="/instrucoes" className="inline-flex items-center min-h-[44px] px-1 text-ink-700 font-extrabold text-sm hover:underline">
            {t('landing.instructions_link')}
          </Link>
          <Link to="/termos" className="inline-flex items-center min-h-[44px] px-1 text-ink-700 font-extrabold text-sm hover:underline">
            {t('landing.terms_link')}
          </Link>
          <Link to="/privacidade" className="inline-flex items-center min-h-[44px] px-1 text-ink-700 font-extrabold text-sm hover:underline">
            {t('landing.privacy_link')}
          </Link>
        </div>
        <p className="text-muted text-xs">&copy; {year} alinho</p>
      </div>
    </footer>
  )
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-canvas">
      <Nav />
      <Hero />
      <Features />
      <HowItWorks />
      <ClosingCta />
      <Footer />
    </div>
  )
}
