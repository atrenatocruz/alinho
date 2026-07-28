import { forwardRef, useImperativeHandle, useRef } from 'react'
import { toPng } from 'html-to-image'
import logoWordmark from '../logo/primary-dark-card.svg'

/* ════════════════════════════════════════════════════════════════════════
   ShareCard — branded, rasterizable Instagram Story card (1080×1920).
   Built at a phone-sized base (360×640) with normal Tailwind classes, then
   exported at 3x pixel ratio via html-to-image — keeps the JSX readable
   instead of juggling four-digit arbitrary pixel classes. Two variants:
   "invite" (promote an open/upcoming mix) and "podium" (finished mix
   leaderboard, top 3). Player photos are intentionally skipped in favor of
   initials — avoids CORS/rasterization failures on cross-origin avatar URLs.
   ════════════════════════════════════════════════════════════════════════ */

export const CARD_W = 360
export const CARD_H = 640
const EXPORT_PIXEL_RATIO = 3 // 360×640 * 3 = 1080×1920

const MEDAL = ['🥇', '🥈', '🥉']

function initial(name) {
  return (name || '?').trim().charAt(0).toUpperCase()
}

function CardAvatar({ name, size = 40 }) {
  return (
    <div
      style={{ width: size, height: size }}
      className="rounded-full bg-ink-700 text-lime-400 flex items-center justify-center font-extrabold shrink-0"
    >
      <span style={{ fontSize: size * 0.4 }}>{initial(name)}</span>
    </div>
  )
}

/* Faint court-line motif, echoing EmptyState's — a quiet brand texture
   behind the content rather than a blank dark rectangle. */
function CourtMotif() {
  return (
    <svg viewBox={`0 0 ${CARD_W} ${CARD_H}`} className="absolute inset-0 w-full h-full" fill="none">
      <rect x="40" y="150" width="280" height="420" rx="24" stroke="#C5DD01" strokeOpacity="0.08" strokeWidth="3" />
      <line x1="180" y1="150" x2="180" y2="570" stroke="#C5DD01" strokeOpacity="0.08" strokeWidth="3" />
      <line x1="40" y1="360" x2="320" y2="360" stroke="#C5DD01" strokeOpacity="0.08" strokeWidth="3" strokeDasharray="8 10" />
    </svg>
  )
}

function CardShell({ children }) {
  return (
    <div style={{ width: CARD_W, height: CARD_H }} className="relative overflow-hidden bg-ink-900 flex flex-col">
      <CourtMotif />
      <div className="relative flex-1 flex flex-col px-8 pt-14 pb-10">{children}</div>
    </div>
  )
}

function LogoFooter() {
  return (
    <div className="mt-auto flex flex-col items-center gap-2.5 pt-8">
      <img src={logoWordmark} alt="alinho" style={{ height: 24 }} />
      <p className="text-[11px] font-mono font-extrabold tracking-[0.2em] uppercase text-ink-200">
        junta-te no alinho
      </p>
    </div>
  )
}

function InviteCard({ game, people, capacity, formattedDate }) {
  const shown = people.slice(0, 6)
  const overflow = people.length - shown.length
  return (
    <CardShell>
      <p className="text-[13px] font-mono font-extrabold tracking-[0.2em] uppercase text-lime-400 mb-3">
        🎾 Vem jogar
      </p>
      <h1 className="text-[32px] leading-[1.15] font-bold text-white font-display mb-6">
        {game.title}
      </h1>
      <div className="space-y-2 text-[15px] text-ink-200 font-semibold mb-10">
        <p className="capitalize">{formattedDate}</p>
        {game.location && <p>{game.location}</p>}
      </div>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        {shown.map((p, i) => <CardAvatar key={p.id || i} name={p.name} />)}
        {overflow > 0 && (
          <div style={{ width: 40, height: 40 }} className="rounded-full bg-white/10 text-white flex items-center justify-center font-extrabold text-sm">
            +{overflow}
          </div>
        )}
      </div>
      <p className="text-sm font-extrabold text-lime-400 tabular-nums">
        {people.length}/{capacity} jogadores
      </p>
      <LogoFooter />
    </CardShell>
  )
}

function PodiumCard({ game, mixStats }) {
  const top = mixStats.slice(0, 3)
  return (
    <CardShell>
      <p className="text-[13px] font-mono font-extrabold tracking-[0.2em] uppercase text-lime-400 mb-3">
        🏆 Resultados do mix
      </p>
      <h1 className="text-[26px] leading-[1.2] font-bold text-white font-display mb-10">
        {game.title}
      </h1>
      <div className="space-y-4">
        {top.map((s, i) => (
          <div
            key={s.id}
            className={`flex items-center gap-4 rounded-2xl px-4 py-4 ${i === 0 ? 'bg-lime-400/15' : 'bg-white/5'}`}
          >
            <span className="text-2xl shrink-0 leading-none">{MEDAL[i]}</span>
            <span className="flex-1 min-w-0 text-white font-extrabold text-lg truncate">
              {s.user?.name || '—'}
            </span>
            <span className="text-lime-400 font-extrabold text-xl tabular-nums shrink-0">
              {s.points_earned}
            </span>
          </div>
        ))}
      </div>
      <LogoFooter />
    </CardShell>
  )
}

/* Imperative `exportPng()` is the only thing consumers need — ShareModal
   calls it on tap, not on every render, since rasterizing is not free. */
const ShareCard = forwardRef(function ShareCard(props, ref) {
  const { variant, game, people = [], capacity, mixStats = [], formattedDate } = props
  const nodeRef = useRef(null)

  useImperativeHandle(ref, () => ({
    exportPng: async () => {
      const node = nodeRef.current
      if (!node) throw new Error('Card not ready')
      const dataUrl = await toPng(node, {
        width: CARD_W,
        height: CARD_H,
        pixelRatio: EXPORT_PIXEL_RATIO,
        cacheBust: true,
      })
      const res = await fetch(dataUrl)
      return res.blob()
    },
  }))

  return (
    <div ref={nodeRef}>
      {variant === 'podium'
        ? <PodiumCard game={game} mixStats={mixStats} />
        : <InviteCard game={game} people={people} capacity={capacity} formattedDate={formattedDate} />}
    </div>
  )
})

export default ShareCard
