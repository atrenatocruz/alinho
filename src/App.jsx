import { useState, useEffect, useRef, Suspense, lazy } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { WifiOff } from 'lucide-react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { PrimaryButton } from './components/ui'
import Layout, { Wordmark } from './components/Layout'
import SplashScreen from './components/SplashScreen'
import Login from './pages/Login'
import Landing from './pages/Landing'
import Home from './pages/Home'
import GameDetails from './pages/GameDetails'
import Rankings from './pages/Rankings'
import PlayerDetails from './pages/PlayerDetails'
import ClaimInvite from './pages/ClaimInvite'
import Profile from './pages/Profile'
import PersonalInfo from './pages/PersonalInfo'
import Comunidade from './pages/Comunidade'
import ClubProfile from './pages/ClubProfile'
import TeacherPage from './pages/TeacherPage'
import LessonPage from './pages/LessonPage'
import TournamentPage from './pages/TournamentPage'
import TournamentScorePage from './pages/TournamentScorePage'
import TournamentPrint from './pages/TournamentPrint'
import CookieConsentBanner from './components/CookieConsentBanner'
import ErrorBoundary from './components/ErrorBoundary'
import { safeInternalPath } from './lib/loginLinks'

// Route-level splitting (impeccable audit, P3 perf finding): these are all
// low-traffic relative to the routes above — admin-only, feature-flagged,
// first-run-only, or reference pages — so deferring them keeps the initial
// bundle lighter without adding a loading flash to any of the app's
// everyday screens. GerirClube alone pulls in @dnd-kit, only used there.
// Uma versao nova da app muda o nome do ficheiro de cada uma destas paginas.
// Quem tinha a app aberta continua a pedir o nome antigo, que ja nao existe
// - e o servidor responde com a pagina inicial em vez de um erro, por isso o
// import falha e o ecra fica em branco (medido no alinho.pt, 22 set 2026).
// Recarregar vai buscar os nomes novos. Uma vez so: se a falha for outra, o
// erro sobe para o ErrorBoundary em vez de ficar a recarregar em ciclo.
const RELOAD_KEY = 'reloadedForChunk'
const lazyPage = (importer) =>
  lazy(() =>
    importer().then(
      (mod) => {
        try { sessionStorage.removeItem(RELOAD_KEY) } catch { /* sem sessionStorage: segue */ }
        return mod
      },
      (error) => {
        let alreadyReloaded = true
        try {
          alreadyReloaded = sessionStorage.getItem(RELOAD_KEY) === '1'
          if (!alreadyReloaded) sessionStorage.setItem(RELOAD_KEY, '1')
        } catch {
          // Sem sessionStorage nao ha como saber se ja se recarregou, e
          // recarregar as cegas arrisca um ciclo: mostra-se o erro.
        }
        if (alreadyReloaded) throw error
        window.location.reload()
        return new Promise(() => {}) // a pagina esta a recarregar
      }
    )
  )

const ForgotPassword = lazyPage(() => import('./pages/ForgotPassword'))
const ResetPassword = lazyPage(() => import('./pages/ResetPassword'))
const PrivateMatches = lazyPage(() => import('./pages/PrivateMatches'))
const CreatePrivateMatch = lazyPage(() => import('./pages/CreatePrivateMatch'))
const JoinPrivateMatch = lazyPage(() => import('./pages/JoinPrivateMatch'))
const GroupMatches = lazyPage(() => import('./pages/GroupMatches'))
const CreateGroupMatch = lazyPage(() => import('./pages/CreateGroupMatch'))
const Gerir = lazyPage(() => import('./pages/Gerir'))
const GerirClube = lazyPage(() => import('./pages/GerirClube'))
const Instructions = lazyPage(() => import('./pages/Instructions'))
const PrivacyPolicy = lazyPage(() => import('./pages/PrivacyPolicy'))
const TermsOfService = lazyPage(() => import('./pages/TermsOfService'))
const MixOffline = lazyPage(() => import('./pages/MixOffline'))
const EscolherNivel = lazyPage(() => import('./pages/EscolherNivel'))
const ConsentGate = lazyPage(() => import('./pages/ConsentGate'))

// Same spinner used for every other in-app loading state (Home, Rankings,
// etc.) — a lazy chunk on a fast connection resolves before this is even
// visible; on a slow one it matches what players already see elsewhere.
const RouteFallback = () => (
  <div className="flex items-center justify-center py-16">
    <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
  </div>
)

// showSplash covers both the auth check and the splash's minimum display
// duration (see AppRoutes) — while true, Guard shows the splash instead of
// its normal redirect/children logic. /login and /instrucoes are unguarded
// routes and intentionally keep rendering immediately, exactly as before.
//
// This is the ONE component every authenticated route passes through, with
// Layout always rendered as its direct child. Routes used to each wrap
// Layout in their own guard (ProtectedRoute/MemberRoute/AdminRoute/
// PrivateMatchesRoute) — since those are different component types, React
// tore down and remounted Layout (and the bottom nav inside it, resetting
// its CSS transitions) every time navigation crossed between differently
// -guarded routes, e.g. Jogos -> Comunidade. Routing every page through
// this single component keeps Layout's identity — and the nav's mid
// -transition state — stable across every in-app navigation.
// Shown when a signed-in user's profile/memberships failed to load after
// every retry (see AuthContext's loadProfile) — without this, the guarded
// pages below silently render as if the account had no data at all
// (blank profile, "no clubs"), which reads as broken rather than as a
// temporary problem.
// 5 taps anywhere on the screen within 2s of each other jump to the
// no-backend Plan B tool (/mix-offline) — deliberately undocumented in the
// UI itself; admins are told about the gesture out of band so regular
// users don't stumble into it during an ordinary transient failure.
const PLAN_B_TAP_TARGET = 5
const PLAN_B_TAP_WINDOW_MS = 2000

const LoadErrorScreen = ({ onRetry }) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const tapCountRef = useRef(0)
  const lastTapAtRef = useRef(0)

  const handleTap = () => {
    const now = Date.now()
    if (now - lastTapAtRef.current > PLAN_B_TAP_WINDOW_MS) tapCountRef.current = 0
    lastTapAtRef.current = now
    tapCountRef.current += 1
    if (tapCountRef.current >= PLAN_B_TAP_TARGET) {
      tapCountRef.current = 0
      navigate('/mix-offline')
    }
  }

  return (
    <div onClick={handleTap} className="min-h-screen flex items-center justify-center px-6 bg-canvas">
      <div className="text-center max-w-xs">
        <Wordmark variant="light" className="h-8 mx-auto mb-8" />
        <WifiOff size={40} className="mx-auto mb-4 text-ink-700" />
        <h1 className="text-lg text-ink-900 mb-1">{t('app.load_error_title')}</h1>
        <p className="text-muted text-sm mb-6">{t('app.load_error_body')}</p>
        <PrimaryButton onClick={onRetry} className="w-full">{t('app.load_error_retry')}</PrimaryButton>
      </div>
    </div>
  )
}

// Moldura de quem chega sem conta (torneio, Trello #361): o link do torneio
// anda no WhatsApp e em cartazes, por isso a página abre a toda a gente.
// Sem sessão não há barra de navegação — só o logótipo e a porta de entrada.
function PublicShell({ children }) {
  const { t } = useTranslation()
  return (
    <div className="min-h-screen flex flex-col bg-canvas">
      <header className="bg-ink-900">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/" className="leading-none"><Wordmark /></Link>
          <Link to="/login" className="text-white font-extrabold text-sm hover:underline">{t('landing.login_link')}</Link>
        </div>
      </header>
      <main className="flex-1">
        <div className="max-w-2xl mx-auto px-4 pt-6 pb-16 animate-fade-up">{children}</div>
      </main>
    </div>
  )
}

const Guard = ({ require, showSplash, children }) => {
  const { user, profile, isGuest, isAdmin, isPrivateMatchesEnabled, isLessonsEnabled, profileError, retryProfile } = useAuth()
  const location = useLocation()

  if (showSplash) {
    return <SplashScreen />
  }

  if (user && profileError) {
    return <LoadErrorScreen onRetry={retryProfile} />
  }

  // Consent gate (Trello #154): brand-new accounts (email/password or
  // Google) must accept the Privacy Policy/Terms once before reaching the
  // app — checked BEFORE rating-onboarding so no profile data (like a
  // self-selected rating) gets written before consent is on file. Existing
  // pilot accounts are grandfathered — the migration backfills
  // consent_accepted_at = NOW() for every profile that existed before this
  // shipped, so only genuinely new signups see this screen.
  if (user && profile && profile.consent_accepted_at === null) {
    return <ConsentGate />
  }

  // Auto-classificação do primeiro registo (Elo v1): contas novas escolhem
  // o nível de entrada antes de usar a app. Comparação estrita com null —
  // contas de antes da migração têm o carimbo preenchido, e um cliente a
  // falar com uma BD ainda sem a coluna vê `undefined`; nenhum dos dois
  // pode ficar preso aqui.
  if (user && profile && profile.rating_onboarded_at === null) {
    return <EscolherNivel />
  }

  // "/" is the one public route: signed-out visitors see the Landing page
  // (no nav shell), signed-in ones see Home inside Layout.
  if (require === 'home') {
    return user ? <Layout>{children}</Layout> : <Landing />
  }

  // Abre com ou sem conta: com sessão vai dentro da app, sem sessão fica na
  // moldura simples acima (não manda ninguém para o /login).
  if (require === 'public') {
    return user ? <Layout>{children}</Layout> : <PublicShell>{children}</PublicShell>
  }

  if (require === 'admin') {
    return isAdmin ? <Layout>{children}</Layout> : <Navigate to="/" />
  }

  if (!user) {
    // Vale para TODAS as paginas fechadas, nao so para os convites (Trello
    // #454): quem nao tem conta e abre uma pagina de membros perdia o
    // destino e ficava na Home depois de criar a conta. O ?redirect= nao
    // abre portas nenhumas — so devolve a pessoa DEPOIS de ela ter conta, e
    // a partir dai e esta mesma funcao que decide se pode entrar.
    // Invite links (/jogos-privados/:id/entrar?slot=…) are by design opened
    // by people with no session yet — bouncing them to a bare /login lost
    // the match id and slot, so Login sends them back here after auth.
    const redirectTo = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?redirect=${redirectTo}`} />
  }

  // Members-only: guests are redirected to Jogos
  if (require === 'member' && isGuest) {
    return <Navigate to="/" />
  }

  // Redirects to Home when the private-matches feature flag is off — covers
  // direct navigation/bookmarks to a card that's already hidden on Home.
  if (require === 'privateMatches' && !isPrivateMatchesEnabled) {
    return <Navigate to="/" />
  }

  // Aulas escondidas (feature flag 'lessons'): o link direto de uma aula ou
  // da disponibilidade de um professor leva a Home.
  if (require === 'lessons' && (isGuest || !isLessonsEnabled)) {
    return <Navigate to="/" />
  }

  return <Layout>{children}</Layout>
}

/* Quem chega a /login ja com sessao volta para onde ia, nao para a Home
   (Trello #378). Acontece sempre que o Guard mandou alguem para
   /login?redirect=<pagina> e a sessao ja existe quando o /login desenha: com
   o Google e assim por definicao (a volta do OAuth traz a sessao feita), e
   com email ou conta nova ha a corrida entre o navigate(redirectTo) do
   Login.jsx e este <Navigate> — que ganhava sempre, e mandava para a Home.
   Importa para o torneio: quem abre o link e carrega em «Inscrever» tem de
   voltar a pagina do torneio.

   So se aceita um caminho dentro da app (safeInternalPath, loginLinks.js):
   o ?redirect= vem do URL, e sem essa trava bastava um link para levar
   alguem da pagina de entrada para fora, ja com sessao iniciada. */
function AfterLogin() {
  const [searchParams] = useSearchParams()
  return <Navigate to={safeInternalPath(searchParams.get('redirect'))} replace />
}

function AppRoutes() {
  const { user, loading: authLoading } = useAuth()
  const [minDurationElapsed, setMinDurationElapsed] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setMinDurationElapsed(true), 700)
    return () => clearTimeout(timer)
  }, [])

  const showSplash = authLoading || !minDurationElapsed

  return (
    // Rede de seguranca: sem ela, um erro em qualquer pagina da ecra branco.
    <ErrorBoundary>
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={user ? <AfterLogin /> : <Login />} />
        <Route path="/esqueci-password" element={user ? <Navigate to="/" /> : <ForgotPassword />} />
        {/* Not guarded like /login above — Supabase establishes a
            (recovery-only) session as soon as the visitor lands here via
            the email link, so `user` is already set by the time this
            renders; redirecting on that would bounce them straight past
            the form they came here to fill in. */}
        <Route path="/redefinir-password" element={<ResetPassword />} />
        <Route path="/instrucoes" element={<Instructions />} />
        <Route path="/privacidade" element={<PrivacyPolicy />} />
        <Route path="/termos" element={<TermsOfService />} />
        <Route path="/mix-offline" element={<MixOffline />} />
        <Route
          path="/"
          element={
            <Guard require="home" showSplash={showSplash}>
              <Home />
            </Guard>
          }
        />
        <Route
          path="/jogo/:id"
          element={
            <Guard require="protected" showSplash={showSplash}>
              <GameDetails />
            </Guard>
          }
        />
        <Route
          path="/rankings"
          element={
            <Guard require="member" showSplash={showSplash}>
              <Rankings />
            </Guard>
          }
        />
        <Route
          path="/comunidade"
          element={
            <Guard require="member" showSplash={showSplash}>
              <Comunidade />
            </Guard>
          }
        />
        <Route
          path="/clube/:slug"
          element={
            <Guard require="member" showSplash={showSplash}>
              <ClubProfile />
            </Guard>
          }
        />
        <Route
          path="/clube/:slug/jogos"
          element={
            <Guard require="member" showSplash={showSplash}>
              <GroupMatches />
            </Guard>
          }
        />
        <Route
          path="/clube/:slug/jogos/novo"
          element={
            <Guard require="member" showSplash={showSplash}>
              <CreateGroupMatch />
            </Guard>
          }
        />
        {/* Convite do parceiro sem conta (Trello #339) — abre sem conta:
            quem chega pelo link vê o convite e o caminho para se registar. */}
        <Route
          path="/convite-torneio/:token"
          element={
            <Guard require="public" showSplash={showSplash}>
              <ClaimInvite />
            </Guard>
          }
        />
        <Route
          path="/convite/:token"
          element={
            <Guard require="public" showSplash={showSplash}>
              <ClaimInvite />
            </Guard>
          }
        />
        {/* Ecrã do marcador (Trello #365) — precisa de conta: só o admin
            e os marcadores do torneio marcam resultados. */}
        <Route
          path="/torneio/:id/marcar"
          element={
            <Guard require="protected" showSplash={showSplash}>
              <TournamentScorePage />
            </Guard>
          }
        />
        {/* A folha para imprimir (Trello #364) — grupos, quadro e a grelha
            de horas numa folha só. Abre sem conta: quem está ao balcao
            pode nao ter sessao iniciada, e esta e a folha do plano B. */}
        <Route
          path="/torneio/:id/imprimir"
          element={
            <Guard require="public" showSplash={showSplash}>
              <TournamentPrint />
            </Guard>
          }
        />
        {/* Torneios (Trello #361 a #366) — abre sem conta */}
        <Route
          path="/torneio/:id"
          element={
            <Guard require="public" showSplash={showSplash}>
              <TournamentPage />
            </Guard>
          }
        />
        {/* Aulas com professores (Trello #49) */}
        <Route
          path="/professor/:id"
          element={
            <Guard require="member" showSplash={showSplash}>
              <TeacherPage view="profile" />
            </Guard>
          }
        />
        <Route
          path="/aula/:id"
          element={
            <Guard require="lessons" showSplash={showSplash}>
              <LessonPage />
            </Guard>
          }
        />
        <Route
          path="/professor/:id/disponibilidade"
          element={
            <Guard require="lessons" showSplash={showSplash}>
              <TeacherPage view="availability" />
            </Guard>
          }
        />
        <Route
          path="/jogador/:id"
          element={
            <Guard require="member" showSplash={showSplash}>
              <PlayerDetails />
            </Guard>
          }
        />
        <Route
          path="/perfil"
          element={
            <Guard require="protected" showSplash={showSplash}>
              <Profile />
            </Guard>
          }
        />
        {/* Informação pessoal em página própria (Francisco, 21 set 2026) —
            com a alteração de password lá dentro. */}
        <Route
          path="/perfil/informacao"
          element={
            <Guard require="protected" showSplash={showSplash}>
              <PersonalInfo />
            </Guard>
          }
        />
        <Route
          path="/jogos-privados"
          element={
            <Guard require="privateMatches" showSplash={showSplash}>
              <PrivateMatches />
            </Guard>
          }
        />
        <Route
          path="/jogos-privados/novo"
          element={
            <Guard require="privateMatches" showSplash={showSplash}>
              <CreatePrivateMatch />
            </Guard>
          }
        />
        <Route
          path="/jogos-privados/:id/entrar"
          element={
            <Guard require="privateMatches" showSplash={showSplash}>
              <JoinPrivateMatch />
            </Guard>
          }
        />
        <Route
          path="/gerir"
          element={
            <Guard require="protected" showSplash={showSplash}>
              <Gerir />
            </Guard>
          }
        />
        <Route
          path="/gerir/:slug"
          element={
            <Guard require="protected" showSplash={showSplash}>
              <GerirClube />
            </Guard>
          }
        />
      </Routes>
    </Suspense>
    </ErrorBoundary>
  )
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <AppRoutes />
        <CookieConsentBanner />
      </Router>
    </AuthProvider>
  )
}

export default App


