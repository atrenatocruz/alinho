# Landing Page for alinho Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public marketing landing page at `/` that logged-out visitors see instead of being redirected straight to `/login`, explaining what alinho is and offering clear sign-in/sign-up entry points.

**Architecture:** One new self-contained page component (`src/pages/Landing.jsx`, following this codebase's convention of single-file pages with inline sub-components, e.g. `Login.jsx`, `Layout.jsx`) rendered directly by `App.jsx` for the `/` route when there's no logged-in user, replacing the current `ProtectedRoute` redirect-to-login behavior for that one route only. All CTAs link to the existing `/login` page rather than embedding new auth logic.

**Tech Stack:** React 18, React Router 6, TailwindCSS 3 (existing `ink`/`lime` design tokens in `src/index.css`), `lucide-react` icons. No new dependencies.

## Global Constraints

- All UI copy is in Portuguese (pt-PT), matching the rest of the app.
- No new npm dependencies — reuse `lucide-react`, React Router, and existing Tailwind config only.
- Reuse existing design tokens/classes only (`ink-*`, `lime-*`, `canvas`, `surface`, `line`, `muted`, `.btn-primary`, `.card`, `rounded-card`, `rounded-ctrl`, `shadow-card`/`shadow-lift`, `font-display`/`font-sans`/`font-mono`, `animate-fade-up`/`animate-fade-in`) — no new tokens, fonts, or component classes.
- No self-serve "create your own organization/group" flow in the copy — it doesn't exist in the backend (only `join_organization` by invite slug or auto-joining the single default org).
- No embedded auth form on the landing page — all sign-in/sign-up CTAs link to `/login` (optionally `?mode=signup`).
- No real product screenshots — illustrative mockups built from the app's own UI classes.
- No changes to `Home`, `Rankings`, `Admin`, or any other authenticated page, and no changes to `Layout.jsx`'s nav/header.
- This project has no automated test suite (no Jest/Vitest/RTL configured, no `*.test.*` files anywhere) — verification steps in this plan are manual, via `npm run dev` and a browser, matching the codebase's existing convention.

---

### Task 1: `Login.jsx` — support `?mode=signup`

**Files:**
- Modify: `src/pages/Login.jsx:8-14`

**Interfaces:**
- Consumes: nothing new.
- Produces: `/login?mode=signup` now opens with the signup tab pre-selected (query param read once on mount via lazy `useState` initializer). `/login` with no param still defaults to the login tab, unchanged. Later tasks (Landing page CTAs) rely on this query param.

- [ ] **Step 1: Move `useSearchParams()` above the `mode` state and read the initial tab from it**

In `src/pages/Login.jsx`, replace lines 8–14:

```jsx
export default function Login() {
  const [mode, setMode] = useState('login') // 'login' or 'signup'
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { signUp, signIn, signInWithGoogle, signInAsAdmin, updateProfile } = useAuth()
```

with:

```jsx
export default function Login() {
  const [searchParams] = useSearchParams()
  // Landing page's "Criar conta" CTA links to /login?mode=signup so it
  // lands directly on the signup tab instead of the login tab.
  const [mode, setMode] = useState(() => (searchParams.get('mode') === 'signup' ? 'signup' : 'login'))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const { signUp, signIn, signInWithGoogle, signInAsAdmin, updateProfile } = useAuth()
```

- [ ] **Step 2: Manually verify both tab defaults**

Run: `npm run dev`, then in a browser:
- Visit `http://localhost:5173/login?mode=signup` → the "Criar Conta" tab should be active (dark `bg-ink-900` pill) immediately on load, with the signup form showing.
- Visit `http://localhost:5173/login` (no param) → the "Entrar" tab should be active on load, same as before this change.
- Click between the two tabs manually to confirm switching still works either way.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Login.jsx
git commit -m "feat: support ?mode=signup query param on /login"
```

---

### Task 2: Wire `/` routing to branch on auth state, with a placeholder Landing page

**Files:**
- Create: `src/pages/Landing.jsx`
- Modify: `src/App.jsx:1-18` (imports), `src/App.jsx:104-113` (the `/` route)

**Interfaces:**
- Consumes: `user` from `useAuth()` — already destructured in `AppRoutes()` at `src/App.jsx:90` (`const { user, loading: authLoading } = useAuth()`), no new hook needed.
- Produces: `Landing` default-exported component from `src/pages/Landing.jsx`, rendered by `App.jsx` at `/` whenever there is no logged-in `user`. Later tasks (3–5) fill in `Landing`'s actual content — this task only establishes the file and the routing branch so every later task is previewable through the real `/` URL.

- [ ] **Step 1: Create a placeholder `Landing.jsx`**

Create `src/pages/Landing.jsx`:

```jsx
export default function Landing() {
  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center">
      <p className="text-ink-900">Landing page placeholder</p>
    </div>
  )
}
```

- [ ] **Step 2: Import `Landing` in `App.jsx`**

In `src/App.jsx`, after line 6 (`import Login from './pages/Login'`), add:

```jsx
import Landing from './pages/Landing'
```

- [ ] **Step 3: Branch the `/` route on auth state instead of using `ProtectedRoute`**

In `src/App.jsx`, replace the `/` route (currently lines 104–113):

```jsx
      <Route
        path="/"
        element={
          <ProtectedRoute showSplash={showSplash}>
            <Layout>
              <Home />
            </Layout>
          </ProtectedRoute>
        }
      />
```

with:

```jsx
      <Route
        path="/"
        element={
          showSplash ? (
            <SplashScreen />
          ) : user ? (
            <Layout>
              <Home />
            </Layout>
          ) : (
            <Landing />
          )
        }
      />
```

- [ ] **Step 4: Manually verify the routing branch**

Run: `npm run dev`, then in a browser:
- Open a private/incognito window (guarantees no session) and visit `http://localhost:5173/` → should show "Landing page placeholder", and must NOT redirect to `/login`.
- In that same private window, visit `http://localhost:5173/rankings` (a `MemberRoute`-guarded page) → should still redirect to `/login` as before — confirms only `/` changed behavior.
- In your normal logged-in browser session, visit `http://localhost:5173/` → should still show the normal Home page (Jogos list) inside the standard `Layout` with the bottom nav, exactly as before this change.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx src/pages/Landing.jsx
git commit -m "feat: route logged-out visitors at / to a new Landing page"
```

---

### Task 3: `Landing.jsx` — Nav + Hero section

**Files:**
- Modify: `src/pages/Landing.jsx` (replace entire placeholder file)

**Interfaces:**
- Consumes: `Wordmark` named export from `src/components/Layout.jsx` (`export function Wordmark({ className = '', variant = 'dark' })`).
- Produces: `Nav` and `Hero` (and `HeroMockCard`) local components used by the page's default export. Task 4 and 5 append further sections after `Hero` inside the same returned JSX — they do not depend on `Nav`/`Hero`/`HeroMockCard`'s internals, only on `Landing.jsx` existing with this shape.

- [ ] **Step 1: Replace `src/pages/Landing.jsx` with the Nav + Hero implementation**

```jsx
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, MapPin, Lock } from 'lucide-react'
import { Wordmark } from '../components/Layout'

// Sticky nav — transparent over the hero, solidifies once scrolled past it,
// matching Layout.jsx's header treatment for logged-in pages.
function Nav() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={`sticky top-0 z-20 transition-colors duration-base ${
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
            to="/login"
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
            to="/login?mode=signup"
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
        <MapPin size={15} className="shrink-0" /> Padel Clube da Cidade
      </p>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-3 border-t border-line">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex -space-x-2">
            {['J', 'M', 'A', 'S'].map((letter, i) => (
              <div
                key={letter}
                style={{ zIndex: 4 - i }}
                className="w-9 h-9 text-sm rounded-full flex items-center justify-center shrink-0 font-extrabold bg-ink-700 text-white ring-2 ring-surface"
              >
                {letter}
              </div>
            ))}
          </div>
          <span className="text-sm font-extrabold text-ink-900 tabular-nums">
            4<span className="text-muted font-normal">/4</span>
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
            Sem mais grupos de WhatsApp perdidos ou folhas de cálculo. Cria
            mixes, junta o grupo e acompanha o ranking — tudo num só sítio.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 mt-8">
            {/* Both CTAs need inline-flex + centering utilities explicitly —
                min-h-[48px] and vertical padding have no effect on the
                default `display: inline` a Link/<a> renders as. */}
            <Link
              to="/login?mode=signup"
              className="btn-primary inline-flex items-center justify-center"
            >
              Criar conta
            </Link>
            <Link
              to="/login"
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

export default function Landing() {
  return (
    <div className="min-h-screen bg-canvas">
      <Nav />
      <Hero />
    </div>
  )
}
```

- [ ] **Step 2: Manually verify Nav + Hero**

Run: `npm run dev`, visit `http://localhost:5173/` in a private/incognito window:
- Nav shows the wordmark, "Entrar" link, and (at desktop width) a "Criar conta" button; scroll down a few pixels and confirm the nav background solidifies to dark.
- Hero shows the headline, subhead, tilted mockup card, and two CTA buttons — both must render as proper full-height, centered buttons (not squashed inline text), confirming the `inline-flex items-center justify-center` fix on the Link elements took effect.
- Click "Criar conta" → lands on `/login?mode=signup` with the signup tab active. Click "Já tenho conta" → lands on `/login` with the login tab active.
- Resize the browser to ~375px width: hero stacks to a single column, the "Criar conta" nav button disappears (only "Entrar" remains), CTA buttons stack full-width.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Landing.jsx
git commit -m "feat: add Nav and Hero sections to the Landing page"
```

---

### Task 4: `Landing.jsx` — Features grid

**Files:**
- Modify: `src/pages/Landing.jsx`

**Interfaces:**
- Consumes: `Landing.jsx` as left by Task 3 (imports, `Nav`, `HeroMockCard`, `Hero`, and the default-exported `Landing` component returning `<Nav /><Hero /></>`).
- Produces: `Features` local component, appended into `Landing`'s returned JSX after `<Hero />`. Task 5 appends further sections after `<Features />`.

- [ ] **Step 1: Add feature icons to the existing lucide-react import**

In `src/pages/Landing.jsx`, replace the lucide-react import line:

```jsx
import { CheckCircle2, MapPin, Lock } from 'lucide-react'
```

with:

```jsx
import { CheckCircle2, MapPin, Lock, Calendar, Trophy, Users, MessageCircle } from 'lucide-react'
```

- [ ] **Step 2: Add the `PadelIcon` import**

Directly below the `Wordmark` import line, add:

```jsx
import PadelIcon from '../components/icons/PadelIcon'
```

- [ ] **Step 3: Add the features data, `FeatureCard`, and `Features` section**

Insert this block after the `Hero` function and before `export default function Landing()`:

```jsx
const FEATURES = [
  {
    icon: Calendar,
    title: 'Jogos',
    description: 'Cria mixes com data, hora e local. Entra sozinho ou com o teu parceiro — o resto o grupo trata.',
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
    description: 'Cria um mix só por convite, para quando não é preciso o grupo todo.',
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
          <h2 className="text-3xl text-ink-900">Tudo o que o grupo precisa, numa só app</h2>
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
```

- [ ] **Step 4: Render `Features` in the page**

Replace the `Landing` default export:

```jsx
export default function Landing() {
  return (
    <div className="min-h-screen bg-canvas">
      <Nav />
      <Hero />
    </div>
  )
}
```

with:

```jsx
export default function Landing() {
  return (
    <div className="min-h-screen bg-canvas">
      <Nav />
      <Hero />
      <Features />
    </div>
  )
}
```

- [ ] **Step 5: Manually verify the Features section**

Run: `npm run dev`, visit `http://localhost:5173/` in a private window, scroll to the features grid:
- All 6 cards render with the correct icon, title, and description (Jogos, Rankings, Comunidade, Clubes, Jogos privados, Bot do WhatsApp), including the custom `PadelIcon` on the Clubes card rendering in the same lime tint as the lucide icons.
- At desktop width the grid shows 3 columns, at tablet width 2 columns, at mobile width (~375px) 1 column.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Landing.jsx
git commit -m "feat: add Features grid to the Landing page"
```

---

### Task 5: `Landing.jsx` — How it works, closing CTA, footer

**Files:**
- Modify: `src/pages/Landing.jsx`

**Interfaces:**
- Consumes: `Landing.jsx` as left by Task 4.
- Produces: `HowItWorks`, `ClosingCta`, `Footer` local components, appended into `Landing`'s returned JSX after `<Features />`. This is the final content task — after this, `Landing.jsx`'s content is complete.

- [ ] **Step 1: Add the steps data and `HowItWorks` section**

Insert this block after `Features` and before `export default function Landing()`:

```jsx
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
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 lg:gap-5">
          {STEPS.map((step, i) => (
            <div key={step.number} className="relative">
              {i < STEPS.length - 1 && (
                <div
                  className="hidden lg:block absolute top-6 left-[calc(50%+28px)] right-[calc(-50%+28px)] h-px border-t-2 border-dashed border-line"
                  aria-hidden="true"
                />
              )}
              <div className="relative w-12 h-12 rounded-full bg-ink-900 text-lime-400 font-mono font-extrabold text-lg flex items-center justify-center mb-4 mx-auto lg:mx-0">
                {step.number}
              </div>
              <h3 className="text-lg text-ink-900 mb-1.5 text-center lg:text-left">{step.title}</h3>
              <p className="text-sm text-muted text-center lg:text-left">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Add `ClosingCta` and `Footer` sections**

Insert this block after `HowItWorks` and before `export default function Landing()`:

```jsx
function ClosingCta() {
  return (
    <section className="bg-ink-900 py-16 px-5 text-center">
      <div className="max-w-lg mx-auto">
        <h2 className="text-3xl text-white mb-6">Pronto para organizar o próximo mix?</h2>
        <Link
          to="/login?mode=signup"
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
  return (
    <footer className="bg-canvas py-10 px-5 border-t border-line">
      <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <Wordmark variant="light" />
        <div className="flex items-center gap-6">
          <Link to="/login" className="text-ink-700 font-extrabold text-sm hover:underline">
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
```

- [ ] **Step 3: Render the new sections in the page**

Replace the `Landing` default export:

```jsx
export default function Landing() {
  return (
    <div className="min-h-screen bg-canvas">
      <Nav />
      <Hero />
      <Features />
    </div>
  )
}
```

with:

```jsx
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
```

- [ ] **Step 4: Manually verify the new sections**

Run: `npm run dev`, visit `http://localhost:5173/` in a private window, scroll to the bottom:
- "How it works" shows 3 numbered steps; at desktop width a dashed connector line appears between them, hidden at mobile width.
- The closing dark CTA band shows the headline and a working "Criar conta" button → `/login?mode=signup` with the signup tab active.
- The footer shows the dark wordmark variant readable on the light background (not invisible white-on-white), plus working "Entrar" (→ `/login`) and "Instruções" (→ `/instrucoes`) links, and the correct current year in the copyright line.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Landing.jsx
git commit -m "feat: add How it works, closing CTA, and footer to the Landing page"
```

---

### Task 6: Final integration QA

**Files:** none (verification only — no code changes).

**Interfaces:**
- Consumes: the complete `Landing.jsx` from Tasks 3–5 and the routing from Task 2.
- Produces: nothing new — confirms the finished feature matches the spec's Testing section end to end.

- [ ] **Step 1: Production build check**

Run: `npm run build`
Expected: build completes with no errors or warnings about `Landing.jsx`, `Login.jsx`, or `App.jsx`.

- [ ] **Step 2: Full manual click-through (logged out)**

In a private/incognito window with `npm run dev` running:
- Visit `/` → Landing page renders (Nav, Hero, Features, How it works, Closing CTA, Footer), no redirect to `/login`.
- Click every CTA on the page (nav "Entrar", nav "Criar conta", hero "Criar conta", hero "Já tenho conta", closing band "Criar conta", footer "Entrar", footer "Instruções") and confirm each lands on the right destination with the right tab pre-selected where applicable.
- Directly visit a guarded route, e.g. `/rankings` or `/perfil`, while still logged out → still redirects to `/login` as before (confirms no other route's guard behavior changed).

- [ ] **Step 3: Full manual click-through (logged in)**

In your normal logged-in browser session:
- Visit `/` → shows the normal Home page (Jogos list) inside `Layout` with the bottom nav, unchanged from before this feature.

- [ ] **Step 4: Responsive + reduced-motion check**

- Resize the browser through mobile (~375px), tablet (~768px), and desktop (~1280px) widths on `/` (logged out) and confirm no horizontal overflow and that the Features grid and How-it-works steps reflow as designed (1 → 2 → 3 columns; connector lines only at desktop width).
- In your OS/browser settings, enable "reduce motion", reload `/` (logged out), and confirm the page still renders correctly with animations simply skipped (no broken/invisible content — `animate-fade-up` already has a `prefers-reduced-motion` override in `src/index.css`).

No commit for this task — it verifies work already committed in Tasks 1–5.
