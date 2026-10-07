import { Wordmark } from './Layout'

/* Shown once per app boot while AuthContext resolves the initial
   session — see App.jsx's AppRoutes gate. Same lime ground and resting
   logo as the animated boot screen in index.html, so the hand-over from
   one to the other doesn't show. */
export default function SplashScreen() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-lime-400">
      <Wordmark variant="lime" className="!h-auto w-[min(62vw,260px)]" />
    </div>
  )
}
