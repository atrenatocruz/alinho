import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Home, Users, Trophy, Settings, LogOut, HelpCircle, Phone, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { LevelBadge, PrimaryButton, Avatar } from './ui'
import { hashPhone } from '../lib/hashPhone'
import PadelIcon from './icons/PadelIcon'

// Re-prompt at most once per day once dismissed — a nudge, not a gate.
const PHONE_PROMPT_DISMISSED_KEY = 'phonePromptDismissedDate'

/* Dismissible nudge (X button or "Agora não") shown whenever a real
   (non-guest) member has no phone hash yet, since the WhatsApp bot needs
   it to recognize them in the group. Phone is optional — this never blocks
   using the app, it's just a reminder that can always be skipped and the
   number added later from the Profile page. */
function PhoneRequiredModal({ onSave, onDismiss }) {
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (phone.replace(/\D/g, '').length < 9) {
      setError('Introduz um número de telemóvel válido')
      return
    }
    setSaving(true)
    setError('')
    try {
      const hash = await hashPhone(phone)
      const { error: saveError } = await onSave(hash)
      if (saveError) throw saveError
      // on success the parent's `profile.phone_hash` updates and this modal unmounts
    } catch {
      setError('Não foi possível guardar. Tenta novamente.')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink-900/70 animate-fade-in" onClick={onDismiss}>
      <div className="bg-surface rounded-t-card sm:rounded-card shadow-lift w-full sm:max-w-md p-6 animate-pop relative" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onDismiss}
          aria-label="Fechar"
          className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center rounded-full text-muted hover:bg-ink-50 hover:text-ink-900 transition-colors duration-fast"
        >
          <X size={18} />
        </button>
        <div className="w-11 h-11 rounded-full bg-lime-400/15 text-lime-600 flex items-center justify-center mb-4">
          <Phone size={20} />
        </div>
        <h3 className="text-lg text-ink-900 mb-1.5 pr-8">Queres adicionar o teu nº de telemóvel?</h3>
        <p className="text-sm text-muted mb-5">
          É opcional — só é preciso se quiseres usar o bot do WhatsApp (para poderes escrever "In"/"Out" nos mixes). Podes sempre adicionar mais tarde no teu Perfil.
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="input-field"
            placeholder="912 345 678"
            autoFocus
          />
          {error && (
            <div className="bg-danger/10 text-danger px-4 py-3 rounded-ctrl text-sm font-extrabold">
              {error}
            </div>
          )}
          <PrimaryButton type="submit" disabled={saving} className="w-full">
            {saving ? 'A guardar…' : 'Guardar'}
          </PrimaryButton>
          <button
            type="button"
            onClick={onDismiss}
            className="w-full text-center text-ink-700 font-extrabold text-sm py-2"
          >
            Agora não
          </button>
        </form>
      </div>
    </div>
  )
}

/* Brand wordmark — the real alinho logo, inlined (no SVGR/asset-import
   tooling in this project — Vite would otherwise only give us the file's
   URL, not a component). Path data is extracted from src/logo/*.svg:
   the four letter shapes + dot/stem (a, l, i, n) + the tall ascender (h)
   render in `textFill`; the final "o" is the ball icon — a lime ring with
   a seam swirl that's WHITE on the dark-card variant (for contrast against
   the near-black header) and solid LIME on the light-background variant
   (matching src/logo/Primary Logo (Light Background).svg exactly). */
const WORDMARK_LETTER_PATHS = [
  'M12.2178 7.90027C18.9655 7.90027 24.4355 13.2882 24.4355 19.9344C24.4355 19.9651 24.4348 19.9957 24.4346 20.0262H24.4355V32.1522H19.6582V29.4764C17.5974 31.0377 15.0186 31.9686 12.2178 31.9686C5.47011 31.9686 3.97697e-05 26.5807 0 19.9344C0 13.2882 5.47008 7.90028 12.2178 7.90027ZM12.2188 12.8553C8.24951 12.8553 5.03125 16.0249 5.03125 19.9344C5.03132 23.844 8.24955 27.0135 12.2188 27.0135C16.1879 27.0135 19.4052 23.8439 19.4053 19.9344C19.4053 16.0249 16.1879 12.8554 12.2188 12.8553Z',
  'M88.1885 11.3911V0H85.4327C84.4222 0 82.6768 0.826771 82.6768 3.39895V32.1522H87.8211V17.8215C87.8211 16.0626 90.6689 13.4121 94.8946 13.4121C99.1203 13.4121 101.968 15.9842 101.968 17.8215V32.1522H107.112V17.4541C107.112 13.9632 104.448 8.45143 96.9155 8.45143C90.8893 8.45143 88.5866 10.4724 88.1885 11.3911Z',
  'M31.5087 0H34.0809C34.0809 0 34.1727 22.0472 34.1727 24.2519C34.1727 26.4567 35.3669 27.7428 37.1123 27.7428C37.9391 27.7428 38.1228 27.7428 38.1228 27.7428V32.1522C38.1228 32.1522 39.7764 32.1522 35.2751 32.1522C30.7738 32.1522 28.9365 28.0183 28.9365 24.2519C28.9365 21.3131 28.9365 8.19484 28.9365 2.57218C28.9365 1.74541 29.5796 0 31.5087 0Z',
  'M52.9658 15.2493V31.5092H57.8346V18.0971C57.8346 16.4436 59.8556 12.9527 65.7348 12.9527C70.4382 12.9527 72.349 16.6273 72.349 18.0971V31.5092H77.1258V15.3412C77.1258 12.5853 72.6245 8.08398 66.286 8.08398C61.4172 8.08398 59.0288 9.79877 57.9264 10.6562V7.07349C52.9659 7.07349 52.9658 11.5748 52.9658 15.2493Z',
]
const WORDMARK_BALL_SWIRL_PATH = 'M116.72 22.6364C118.184 22.1131 119.529 22.0009 120.782 22.2379C122.525 22.5675 123.902 23.5362 125.036 24.5797C125.605 25.1032 126.135 25.6676 126.629 26.2047C127.134 26.7543 127.59 27.2616 128.056 27.736C128.969 28.6651 129.743 29.2663 130.524 29.5094C129.47 29.9914 128.319 30.2938 127.105 30.3785C126.794 30.1055 126.499 29.8218 126.221 29.5387C125.715 29.0241 125.211 28.4607 124.736 27.9449C124.251 27.4167 123.78 26.9201 123.294 26.4733C122.319 25.5762 121.37 24.9667 120.305 24.7653C119.574 24.627 118.693 24.6642 117.598 25.0533C117.206 24.2991 116.908 23.4885 116.72 22.6364ZM122.248 11.4772C123.687 13.7775 127.735 16.932 135.185 15.8678C135.589 16.635 135.895 17.4611 136.088 18.3307C127.475 19.7388 122.153 16.1986 120.069 12.8502C120.729 12.3026 121.461 11.8409 122.248 11.4772Z'
const WORDMARK_BALL_RING_PATH = 'M136.326 20.4856C136.326 15.0062 131.884 10.5643 126.404 10.5643C120.925 10.5643 116.483 15.0062 116.483 20.4856C116.483 25.9649 120.925 30.4068 126.404 30.4068V34.0813C118.896 34.0813 112.809 27.9943 112.809 20.4856C112.809 12.9768 118.896 6.88977 126.404 6.88977C133.913 6.88977 140 12.9768 140 20.4856C140 27.9943 133.913 34.0813 126.404 34.0813V30.4068C131.884 30.4068 136.326 25.9649 136.326 20.4856Z'

export function Wordmark({ className = '', variant = 'dark' }) {
  const textFill = variant === 'dark' ? '#FFFFFF' : '#040404'
  const swirlFill = variant === 'dark' ? '#FFFFFF' : '#C5DD01'
  return (
    <svg
      viewBox="0 0 140 35"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="alinho"
      className={`h-6 w-auto ${className}`}
    >
      {WORDMARK_LETTER_PATHS.map((d, i) => (
        <path key={i} d={d} fill={textFill} />
      ))}
      <ellipse cx="44.5529" cy="2.93963" rx="2.93962" ry="2.93963" fill={textFill} />
      <rect x="41.9824" y="8.63513" width="5.14434" height="23.517" fill={textFill} />
      <path d={WORDMARK_BALL_SWIRL_PATH} fill={swirlFill} />
      <path d={WORDMARK_BALL_RING_PATH} fill="#C5DD01" />
    </svg>
  )
}

export default function Layout({ children }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { signOut, profile, updateProfile, currentMembership, isAdmin, isGuest } = useAuth()

  const today = new Date().toISOString().slice(0, 10)
  const [phonePromptDismissed, setPhonePromptDismissed] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem(PHONE_PROMPT_DISMISSED_KEY) === today
  )

  const needsPhone = profile && !isGuest && !profile.phone_hash && !phonePromptDismissed

  const dismissPhonePrompt = () => {
    localStorage.setItem(PHONE_PROMPT_DISMISSED_KEY, today)
    setPhonePromptDismissed(true)
  }

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  // Guests only see Jogos + Perfil
  // `icon` is omitted for Perfil — the render loop always shows the real
  // Avatar there instead of an icon (see isPerfil below).
  const navItems = isGuest
    ? [
        { path: '/', icon: Home, label: 'Jogos' },
        { path: '/perfil', label: 'Perfil' },
      ]
    : [
        { path: '/', icon: Home, label: 'Jogos' },
        { path: '/comunidade', icon: Users, label: 'Comunidade' },
        { path: '/clubes', icon: PadelIcon, label: 'Clubes' },
        { path: '/rankings', icon: Trophy, label: 'Rankings' },
        { path: '/perfil', label: 'Perfil' },
      ]

  if (isAdmin) {
    navItems.push({ path: '/admin', icon: Settings, label: 'Admin' })
  }

  return (
    <div className="min-h-screen bg-canvas pb-32">
      {/* Header — dark liquid glass. paddingTop pushes the row below the
          status bar while letting the dark background itself run all the
          way up into the safe area (PWA/notch), instead of leaving a
          strip of the canvas background showing above it. */}
      <header
        className="sticky top-0 z-10 bg-ink-900/95 backdrop-blur-xl border-b border-white/5 supports-[backdrop-filter]:bg-ink-900/85 rounded-b-[28px]"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="max-w-2xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="leading-none">
            <Wordmark />
          </Link>

          <div className="flex items-center gap-1">
            {currentMembership?.level && !isGuest && (
              <Link to="/perfil" title="O teu nível" className="mr-2">
                <LevelBadge level={currentMembership.level} me />
              </Link>
            )}
            <Link
              to="/instrucoes"
              title="Instruções"
              className="w-11 h-11 flex items-center justify-center rounded-full text-ink-200 hover:text-white hover:bg-white/10 transition-colors duration-fast"
            >
              <HelpCircle size={21} />
            </Link>
            <button
              onClick={handleSignOut}
              title="Sair"
              className="w-11 h-11 flex items-center justify-center rounded-full text-ink-200 hover:text-white hover:bg-white/10 transition-colors duration-fast"
            >
              <LogOut size={21} />
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-2xl mx-auto px-4 py-6 animate-fade-up">
        {children}
      </main>

      {/* Nav — floating dynamic island, liquid glass */}
      {/* translateZ(0) + will-change force this onto its own compositing
          layer — without it, iOS Safari has a known bug where a `fixed`
          element containing a `backdrop-filter` descendant (the pill below)
          detaches from the viewport during momentum scrolling and ends up
          drifting up the page with the content instead of staying pinned. */}
      <nav
        className="fixed inset-x-0 z-20 flex justify-center pointer-events-none px-4"
        style={{
          bottom: 'calc(1rem + env(safe-area-inset-bottom))',
          transform: 'translateZ(0)',
          willChange: 'transform',
        }}
      >
        <div className="pointer-events-auto flex items-center gap-1 p-1.5 rounded-full
                        bg-ink-900/95 supports-[backdrop-filter]:bg-ink-900/90 backdrop-blur-xl
                        shadow-[0_8px_32px_rgba(11,37,69,0.35)]
                        ring-1 ring-white/10">
          {navItems.map(({ path, icon: Icon, label }) => {
            const isActive = location.pathname === path
            const isPerfil = path === '/perfil'
            return (
              <Link
                key={path}
                to={path}
                aria-current={isActive ? 'page' : undefined}
                aria-label={label}
                className={`flex items-center justify-center gap-1.5 h-12 rounded-full
                            transition-all duration-base ${
                  isActive
                    ? 'bg-white/15 text-lime-400 px-4'
                    : 'text-ink-200 hover:text-white w-12'
                }`}
              >
                {isPerfil ? (
                  <Avatar
                    name={profile?.name}
                    url={profile?.avatar_url}
                    size="w-6 h-6 text-[10px]"
                    colorClass="bg-ink-700 text-white"
                  />
                ) : (
                  <Icon size={20} strokeWidth={2} className="shrink-0" />
                )}
                {/* label morphs in on the active item — island style */}
                <span
                  className={`text-xs font-extrabold whitespace-nowrap overflow-hidden transition-all duration-base ${
                    isActive ? 'max-w-[80px] opacity-100' : 'max-w-0 opacity-0'
                  }`}
                >
                  {label}
                </span>
              </Link>
            )
          })}
        </div>
      </nav>

      {needsPhone && (
        <PhoneRequiredModal
          onSave={(phone_hash) => updateProfile({ phone_hash })}
          onDismiss={dismissPhonePrompt}
        />
      )}
    </div>
  )
}
