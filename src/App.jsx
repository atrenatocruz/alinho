import { useState, useEffect, useRef } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
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
import Profile from './pages/Profile'
import Comunidade from './pages/Comunidade'
import ClubProfile from './pages/ClubProfile'
import PrivateMatches from './pages/PrivateMatches'
import CreatePrivateMatch from './pages/CreatePrivateMatch'
import JoinPrivateMatch from './pages/JoinPrivateMatch'
import Gerir from './pages/Gerir'
import GerirClube from './pages/GerirClube'
import Instructions from './pages/Instructions'
import PrivacyPolicy from './pages/PrivacyPolicy'
import TermsOfService from './pages/TermsOfService'
import MixOffline from './pages/MixOffline'
import EscolherNivel from './pages/EscolherNivel'

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

const Guard = ({ require, showSplash, children }) => {
  const { user, profile, isGuest, isAdmin, isPrivateMatchesEnabled, profileError, retryProfile } = useAuth()
  const location = useLocation()

  if (showSplash) {
    return <SplashScreen />
  }

  if (user && profileError) {
    return <LoadErrorScreen onRetry={retryProfile} />
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

  if (require === 'admin') {
    return isAdmin ? <Layout>{children}</Layout> : <Navigate to="/" />
  }

  if (!user) {
    if (require === 'member') {
      return <Navigate to="/login" />
    }
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

  return <Layout>{children}</Layout>
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
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" /> : <Login />} />
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
  )
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <AppRoutes />
      </Router>
    </AuthProvider>
  )
}

export default App


