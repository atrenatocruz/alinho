import { useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2, MapPin, Lock, Calendar, Trophy, Users, MessageCircle } from 'lucide-react'
import { Wordmark } from '../components/Layout'
import PadelIcon from '../components/icons/PadelIcon'

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
          <Link
            to={loginHref()}
            className="text-white/80 hover:text-white font-extrabold text-sm transition-colors duration-fast"
          >
            Entrar
          </Link>
          {/* Hidden on narrow mobile to avoid crowding — the hero below
              already carries a full-size "Criar conta" CTA. */}
          {/* `.btn-primary` only ever styles real <button> elements elsewhere
              in this codebase (see src/pages/Admin.jsx, src/components/ui.jsx)
              — it relies on min-h-[48px], which has no effect on the default
              `display: inline` a Link/<a> renders as. inline-flex + centering
              utilities are required here so the link actually sizes and
              centers like a button. */}
          <Link
            to={loginHref('signup')}
            className="btn-primary hidden sm:inline-flex items-center justify-center"
          >
            Criar conta
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
  return (
    <div className="card w-full max-w-sm shadow-lift" style={{ transform: 'rotate(-3deg)' }}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-widest text-ink-700">Sábado</p>
          <p className="text-2xl text-ink-900 leading-tight">18:00</p>
        </div>
        <span className="inline-flex items-center gap-1.5 bg-lime-400 text-ink-900 text-xs font-extrabold px-3 py-1.5 rounded-full">
          <CheckCircle2 size={14} /> Inscrito
        </span>
      </div>

      <h3 className="text-lg text-ink-900 leading-snug mb-1">Mix de sábado</h3>
      <p className="flex items-center gap-1.5 text-muted text-sm mb-4">
        <MapPin size={15} className="shrink-0" /> Alinho Padel Club
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
            8<span className="text-muted font-normal">/8</span>
          </span>
        </div>
        <span className="ml-auto inline-flex items-center gap-1.5 bg-ok/10 text-ok text-[11px] font-extrabold px-2.5 py-1 rounded-full">
          <Lock size={13} className="shrink-0" /> Mix fechado — campo reservado
        </span>
      </div>
    </div>
  )
}

function Hero() {
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
            Os teus jogos de padel, finalmente organizados.
          </h1>
          <p className="text-ink-200 text-lg mt-5 max-w-md">
            Sem mais folhas de cálculo ou resultados perdidos. Cria jogos,
            junta-te a mixs e acompanha o ranking — tudo num só sítio.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 mt-8">
            {/* Both CTAs need inline-flex + centering utilities explicitly —
                min-h-[48px] and vertical padding have no effect on the
                default `display: inline` a Link/<a> renders as. */}
            <Link
              to={loginHref('signup')}
              className="btn-primary inline-flex items-center justify-center"
            >
              Criar conta
            </Link>
            <Link
              to={loginHref()}
              className="inline-flex items-center justify-center font-extrabold py-3.5 px-6 rounded-ctrl min-h-[48px] text-base
                         border border-white/20 text-white hover:bg-white/10
                         transition-all duration-fast active:scale-[0.98]"
            >
              Já tenho conta
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

const FEATURES = [
  {
    icon: Calendar,
    title: 'Jogos',
    description: 'Cria jogos com data, hora e local. Entra sozinho ou com o teu parceiro — o resto o grupo trata.',
  },
  {
    icon: Trophy,
    title: 'Rankings',
    description: 'Vitórias, taxa de vitória e pontos calculados automaticamente a cada resultado submetido.',
  },
  {
    icon: Users,
    title: 'Comunidade',
    description: 'Vê quem está no grupo, o nível de cada jogador e quem já jogaste antes.',
  },
  {
    icon: PadelIcon,
    title: 'Clubes',
    description: 'Informação dos clubes onde o grupo costuma jogar, tudo num só lugar.',
  },
  {
    icon: Lock,
    title: 'Jogos privados',
    description: 'Cria um jogo só por convite, para quando não é preciso o grupo todo.',
  },
  {
    icon: MessageCircle,
    title: 'Bot do WhatsApp',
    description: 'Responde "In" ou "Out" no grupo do WhatsApp para entrar ou sair de um mix, sem abrir a app.',
  },
]

function FeatureCard({ icon: Icon, title, description }) {
  return (
    <div className="card">
      <div className="w-11 h-11 rounded-full bg-lime-400/15 text-lime-600 flex items-center justify-center mb-4">
        <Icon size={20} />
      </div>
      <h3 className="text-lg text-ink-900 mb-1.5">{title}</h3>
      <p className="text-sm text-muted">{description}</p>
    </div>
  )
}

function Features() {
  return (
    <section className="bg-canvas py-20 px-5">
      <div className="max-w-5xl mx-auto">
        <div className="text-center max-w-lg mx-auto mb-12">
          <p className="font-mono text-xs font-extrabold uppercase tracking-widest text-ink-700 mb-3">
            O que a app faz
          </p>
          <h2 className="text-3xl text-ink-900">Tudo o que um grupo precisa, numa só app</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f) => (
            <FeatureCard key={f.title} {...f} />
          ))}
        </div>
      </div>
    </section>
  )
}

const STEPS = [
  {
    number: '1',
    title: 'Cria a tua conta',
    description: 'Regista-te com o Google ou com o teu email — leva menos de um minuto.',
  },
  {
    number: '2',
    title: 'Junta-te a um mix',
    description: 'Entra num jogo aberto sozinho ou com parceiro. Ou cria um, se fores admin do grupo.',
  },
  {
    number: '3',
    title: 'Acompanha os resultados',
    description: 'Submete o resultado no fim e vê o ranking do grupo atualizar-se na hora.',
  },
]

function HowItWorks() {
  return (
    <section className="bg-surface py-20 px-5">
      <div className="max-w-5xl mx-auto">
        <div className="text-center max-w-lg mx-auto mb-12">
          <p className="font-mono text-xs font-extrabold uppercase tracking-widest text-ink-700 mb-3">
            Como funciona
          </p>
          <h2 className="text-3xl text-ink-900">Três passos e estás em jogo</h2>
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
              <h3 className="text-lg text-ink-900 mb-1.5 text-center">{step.title}</h3>
              <p className="text-sm text-muted text-center">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function ClosingCta() {
  const loginHref = useLoginHref()
  return (
    <section className="bg-ink-900 py-16 px-5 text-center">
      <div className="max-w-lg mx-auto">
        <h2 className="text-3xl text-white mb-6">Pronto para alinhar no próximo mix?</h2>
        <Link
          to={loginHref('signup')}
          className="btn-primary inline-flex items-center justify-center"
        >
          Criar conta
        </Link>
      </div>
    </section>
  )
}

function Footer() {
  const year = new Date().getFullYear()
  const loginHref = useLoginHref()
  return (
    <footer className="bg-canvas py-10 px-5 border-t border-line">
      <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <Wordmark variant="light" />
        <div className="flex items-center gap-6">
          <Link to={loginHref()} className="text-ink-700 font-extrabold text-sm hover:underline">
            Entrar
          </Link>
          <Link to="/instrucoes" className="text-ink-700 font-extrabold text-sm hover:underline">
            Instruções
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
