import { useState, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'
import SplashScreen from './components/SplashScreen'
import Login from './pages/Login'
import Landing from './pages/Landing'
import Home from './pages/Home'
import GameDetails from './pages/GameDetails'
import Rankings from './pages/Rankings'
import PlayerDetails from './pages/PlayerDetails'
import Profile from './pages/Profile'
import Comunidade from './pages/Comunidade'
import Clubes from './pages/Clubes'
import PrivateMatches from './pages/PrivateMatches'
import CreatePrivateMatch from './pages/CreatePrivateMatch'
import JoinPrivateMatch from './pages/JoinPrivateMatch'
import Admin from './pages/Admin'
import Instructions from './pages/Instructions'

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
const Guard = ({ require, showSplash, children }) => {
  const { user, isGuest, isAdmin, isPrivateMatchesEnabled } = useAuth()
  const location = useLocation()

  if (showSplash) {
    return <SplashScreen />
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
        path="/clubes"
        element={
          <Guard require="member" showSplash={showSplash}>
            <Clubes />
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
        path="/admin"
        element={
          <Guard require="admin" showSplash={showSplash}>
            <Admin />
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


