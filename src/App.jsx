import { useState, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'
import SplashScreen from './components/SplashScreen'
import Login from './pages/Login'
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
// duration (see AppRoutes) — while true, these guards show the splash
// instead of their normal redirect/children logic. /login and /instrucoes
// are unguarded routes and intentionally keep rendering immediately,
// exactly as before.
const ProtectedRoute = ({ children, showSplash }) => {
  const { user } = useAuth()
  const location = useLocation()

  if (showSplash) {
    return <SplashScreen />
  }

  if (!user) {
    // Invite links (/jogos-privados/:id/entrar?slot=…) are by design opened
    // by people with no session yet — bouncing them to a bare /login lost
    // the match id and slot, so Login sends them back here after auth.
    const redirectTo = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?redirect=${redirectTo}`} />
  }

  return children
}

// Members-only route: guests are redirected to Jogos
const MemberRoute = ({ children, showSplash }) => {
  const { user, isGuest } = useAuth()

  if (showSplash) {
    return <SplashScreen />
  }

  if (!user) {
    return <Navigate to="/login" />
  }

  if (isGuest) {
    return <Navigate to="/" />
  }

  return children
}

const AdminRoute = ({ children, showSplash }) => {
  const { isAdmin } = useAuth()

  if (showSplash) {
    return <SplashScreen />
  }

  if (!isAdmin) {
    return <Navigate to="/" />
  }

  return children
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
          <ProtectedRoute showSplash={showSplash}>
            <Layout>
              <Home />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/jogo/:id"
        element={
          <ProtectedRoute showSplash={showSplash}>
            <Layout>
              <GameDetails />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/rankings"
        element={
          <MemberRoute showSplash={showSplash}>
            <Layout>
              <Rankings />
            </Layout>
          </MemberRoute>
        }
      />
      <Route
        path="/comunidade"
        element={
          <MemberRoute showSplash={showSplash}>
            <Layout>
              <Comunidade />
            </Layout>
          </MemberRoute>
        }
      />
      <Route
        path="/clubes"
        element={
          <MemberRoute showSplash={showSplash}>
            <Layout>
              <Clubes />
            </Layout>
          </MemberRoute>
        }
      />
      <Route
        path="/jogador/:id"
        element={
          <MemberRoute showSplash={showSplash}>
            <Layout>
              <PlayerDetails />
            </Layout>
          </MemberRoute>
        }
      />
      <Route
        path="/perfil"
        element={
          <ProtectedRoute showSplash={showSplash}>
            <Layout>
              <Profile />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/jogos-privados"
        element={
          <ProtectedRoute showSplash={showSplash}>
            <Layout>
              <PrivateMatches />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/jogos-privados/novo"
        element={
          <ProtectedRoute showSplash={showSplash}>
            <Layout>
              <CreatePrivateMatch />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/jogos-privados/:id/entrar"
        element={
          <ProtectedRoute showSplash={showSplash}>
            <Layout>
              <JoinPrivateMatch />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <AdminRoute showSplash={showSplash}>
            <Layout>
              <Admin />
            </Layout>
          </AdminRoute>
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


