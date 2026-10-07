import { Wordmark } from './Layout'

/* Shown once per app boot while AuthContext resolves the initial
   session — see App.jsx's AppRoutes gate. */
export default function SplashScreen() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900">
      <Wordmark className="h-10 sm:h-12 animate-pulse-soft" />
    </div>
  )
}
