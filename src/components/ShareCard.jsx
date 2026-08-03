import { forwardRef, useImperativeHandle, useRef, useState, useEffect } from 'react'
import { toPng } from 'html-to-image'
import logoWordmark from '../logo/primary-dark-card.svg'

/* ════════════════════════════════════════════════════════════════════════
   ShareCard — branded, rasterizable Instagram Story card (1080×1920).
   Built at a phone-sized base (360×640) with normal Tailwind classes, then
   exported at 3x pixel ratio via html-to-image — keeps the JSX readable
   instead of juggling four-digit arbitrary pixel classes. Two variants:
   "invite" (promote an open/upcoming mix) and "podium" (finished mix
   leaderboard, top 3).
   ════════════════════════════════════════════════════════════════════════ */

export const CARD_W = 360
export const CARD_H = 640
const EXPORT_PIXEL_RATIO = 3 // 360×640 * 3 = 1080×1920

const MEDAL = ['🥇', '🥈', '🥉']

function initial(name) {
  return (name || '?').trim().charAt(0).toUpperCase()
}

/* Circular avatars broke in a WebKit-specific way once actually shared:
   clipping a photo <img> into a circle with CSS (border-radius +
   object-fit: cover) rasterizes fine in Chrome/the in-app preview, but
   comes out as torn artifacts on iOS once html-to-image's SVG-foreignObject
   technique rasterizes it (confirmed on-device — initials, which are a
   plain colored <div>, always rendered fine; only actual <img> photos broke).
   Fix: do the circular crop ourselves with <canvas> ahead of time and hand
   CardAvatar an already-circular PNG — no CSS clipping left for WebKit to
   get wrong. Baked at EXPORT_PIXEL_RATIO so it's still sharp at export size. */
const avatarBakeCache = new Map()

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('avatar image failed to decode'))
    img.src = src
  })
}

function bakeCircularAvatar(img, size, ring) {
  const dim = Math.round(size * EXPORT_PIXEL_RATIO)
  const canvas = document.createElement('canvas')
  canvas.width = dim
  canvas.height = dim
  const ctx = canvas.getContext('2d')
  const r = dim / 2

  ctx.save()
  ctx.beginPath()
  ctx.arc(r, r, r, 0, Math.PI * 2)
  ctx.closePath()
  ctx.clip()
  const scale = Math.max(dim / img.naturalWidth, dim / img.naturalHeight)
  const w = img.naturalWidth * scale
  const h = img.naturalHeight * scale
  ctx.drawImage(img, (dim - w) / 2, (dim - h) / 2, w, h)
  ctx.restore()

  if (ring) {
    ctx.beginPath()
    ctx.arc(r, r, r - dim * 0.03, 0, Math.PI * 2)
    ctx.lineWidth = dim * 0.06
    ctx.strokeStyle = '#040404' // ink-900, matches the card background
    ctx.stroke()
  }

  return canvas.toDataURL('image/png')
}

function useCircularAvatar(url, size, ring) {
  const cacheKey = url ? `${url}|${size}|${ring}` : null
  const [bakedUrl, setBakedUrl] = useState(() => (cacheKey && avatarBakeCache.get(cacheKey)) || null)

  useEffect(() => {
    if (!cacheKey) { setBakedUrl(null); return }
    const cached = avatarBakeCache.get(cacheKey)
    if (cached) { setBakedUrl(cached); return }

    let cancelled = false
    setBakedUrl(null)
    fetch(url, { mode: 'cors' })
      .then((res) => { if (!res.ok) throw new Error('avatar fetch failed'); return res.blob() })
      .then((blob) => loadImageElement(URL.createObjectURL(blob)))
      .then((img) => {
        const baked = bakeCircularAvatar(img, size, ring)
        avatarBakeCache.set(cacheKey, baked)
        if (!cancelled) setBakedUrl(baked)
      })
      .catch(() => {
        // leave bakedUrl null — CardAvatar falls back to the initials circle
      })
    return () => { cancelled = true }
  }, [url, size, ring, cacheKey])

  return bakedUrl
}

/* Shows the player's photo once it's been baked into a local circular PNG,
   otherwise the initial-in-a-circle fallback (also used while the photo is
   still loading, and permanently if it has none / fails to load). The baked
   photo needs no rounding/clipping classes — it's already circular. */
function CardAvatar({ name, url, size = 40, ring = false }) {
  const bakedUrl = useCircularAvatar(url, size, ring)
  const base = { width: size, height: size }
  if (bakedUrl) {
    return <img src={bakedUrl} alt={name || ''} style={base} className="shrink-0" />
  }
  return (
    <div
      style={base}
      className={`rounded-full bg-ink-700 text-lime-400 flex items-center justify-center font-extrabold shrink-0 ${ring ? 'ring-2 ring-ink-900' : ''}`}
    >
      <span style={{ fontSize: size * 0.4 }}>{initial(name)}</span>
    </div>
  )
}

/* Faint court-line motif, echoing EmptyState's — a quiet brand texture
   behind the content rather than a blank dark rectangle. */
function CourtMotif({ height = CARD_H }) {
  return (
    <svg viewBox={`0 0 ${CARD_W} ${height}`} className="absolute inset-0 w-full h-full" fill="none">
      <rect x="40" y="150" width="280" height="420" rx="24" stroke="#C5DD01" strokeOpacity="0.08" strokeWidth="3" />
      <line x1="180" y1="150" x2="180" y2="570" stroke="#C5DD01" strokeOpacity="0.08" strokeWidth="3" />
      <line x1="40" y1="360" x2="320" y2="360" stroke="#C5DD01" strokeOpacity="0.08" strokeWidth="3" strokeDasharray="8 10" />
    </svg>
  )
}

// height defaults to the standard Instagram-Story size (CARD_H); DuplasCard
// overrides it so a long list of pairs can never be clipped off the bottom
// of a fixed-height, non-scrolling exported image (see shareCardHeight).
function CardShell({ children, height = CARD_H }) {
  return (
    <div style={{ width: CARD_W, height }} className="relative overflow-hidden bg-ink-900 flex flex-col">
      <CourtMotif height={height} />
      <div className="relative flex-1 flex flex-col px-8 pt-14 pb-10">{children}</div>
    </div>
  )
}

function LogoFooter({ tagline = 'junta-te no alinho' }) {
  return (
    <div className="mt-auto flex flex-col items-center gap-2.5 pt-8">
      <img src={logoWordmark} alt="alinho" style={{ height: 24 }} />
      <p className="text-[11px] font-mono font-extrabold tracking-[0.2em] uppercase text-ink-200">
        {tagline}
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
        {shown.map((p, i) => <CardAvatar key={p.id || i} name={p.name} url={p.avatar_url} />)}
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

function PodiumCard({ game, duplas }) {
  const top = duplas.slice(0, 3)
  return (
    <CardShell>
      <p className="text-[13px] font-mono font-extrabold tracking-[0.2em] uppercase text-lime-400 mb-3">
        🏆 Resultados do mix
      </p>
      <h1 className="text-[26px] leading-[1.2] font-bold text-white font-display mb-2">
        {game.title}
      </h1>
      {game.location && (
        <p className="text-[15px] text-ink-200 font-semibold">{game.location}</p>
      )}
      <div className="space-y-4 mt-8">
        {top.map((d, i) => (
          <div
            key={d.id}
            className={`flex items-center gap-3 rounded-2xl px-4 py-4 ${i === 0 ? 'bg-lime-400/15' : 'bg-white/5'}`}
          >
            <span className="text-2xl shrink-0 leading-none">{MEDAL[i]}</span>
            <div className="flex -space-x-2 shrink-0">
              <CardAvatar name={d.player1?.name} url={d.player1?.avatar_url} size={34} ring />
              <CardAvatar name={d.player2?.name} url={d.player2?.avatar_url} size={34} ring />
            </div>
            <span className="flex-1 min-w-0 text-white font-extrabold text-base truncate">
              {d.name}
            </span>
            <span className="text-lime-400 font-extrabold text-xl tabular-nums shrink-0">
              {d.points}
            </span>
          </div>
        ))}
      </div>
      <LogoFooter tagline="E tu alinhas?" />
    </CardShell>
  )
}

// The card can't scroll (it's rasterized to a static image), so instead of
// a fixed 640px canvas that clips a long list of pairs, the export height
// grows with the number of duplas. Two density tiers on top of that keep
// it from getting silly-tall: normal spacing for a typical mix (≤4
// duplas), compact (smaller avatars, tighter rows) once there are more.
const DUPLAS_COMPACT_THRESHOLD = 5
const DUPLAS_HEADER_H = 240 // label + title + location + top padding
const DUPLAS_FOOTER_H = 120 // LogoFooter + bottom padding
const DUPLAS_ROW_H_NORMAL = 120 // one dupla block: 34px avatars, normal spacing
const DUPLAS_ROW_H_COMPACT = 100 // one dupla block: 22px avatars, tight spacing

// Exported so ShareModal's on-screen preview (src/components/ui.jsx) can
// size its container identically to what exportPng() will actually
// rasterize — same formula, single source of truth, no separate DOM
// measurement needed to keep the two in sync.
export function shareCardHeight(variant, { duplas = [] } = {}) {
  if (variant !== 'duplas') return CARD_H
  const rowH = duplas.length >= DUPLAS_COMPACT_THRESHOLD ? DUPLAS_ROW_H_COMPACT : DUPLAS_ROW_H_NORMAL
  return Math.max(CARD_H, DUPLAS_HEADER_H + duplas.length * rowH + DUPLAS_FOOTER_H)
}

function DuplasCard({ game, duplas }) {
  const compact = duplas.length >= DUPLAS_COMPACT_THRESHOLD
  const avatarSize = compact ? 22 : 34
  const height = shareCardHeight('duplas', { duplas })
  return (
    <CardShell height={height}>
      <p className="text-[13px] font-mono font-extrabold tracking-[0.2em] uppercase text-lime-400 mb-3">
        🎾 Duplas
      </p>
      <h1 className={`${compact ? 'text-[22px] mb-1' : 'text-[26px] mb-2'} leading-[1.2] font-bold text-white font-display`}>
        {game.title}
      </h1>
      {game.location && (
        <p className="text-[15px] text-ink-200 font-semibold">{game.location}</p>
      )}
      <div className={`${compact ? 'space-y-1.5 mt-4' : 'space-y-3 mt-8'} flex-1 overflow-hidden`}>
        {duplas.map((d, i) => (
          <div key={d.id} className={`rounded-2xl bg-white/5 ${compact ? 'px-3 py-2' : 'px-4 py-3'}`}>
            <p className={`font-mono font-extrabold uppercase tracking-wide text-lime-400 ${compact ? 'text-[9px] mb-1' : 'text-[11px] mb-2'}`}>
              Dupla {i + 1}
            </p>
            <div className={compact ? 'space-y-1' : 'space-y-1.5'}>
              {[d.player1, d.player2].map((player, idx) => (
                <div key={player?.id || idx} className="flex items-center gap-2">
                  <CardAvatar name={player?.name} url={player?.avatar_url} size={avatarSize} ring />
                  <span className={`text-white font-extrabold truncate ${compact ? 'text-[12px]' : 'text-sm'}`}>
                    {player?.name || '?'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <LogoFooter tagline="junta-te no alinho" />
    </CardShell>
  )
}

/* Imperative `exportPng()` is the only thing consumers need — ShareModal
   calls it on tap, not on every render, since rasterizing is not free. */
const ShareCard = forwardRef(function ShareCard(props, ref) {
  const { variant, game, people = [], capacity, duplas = [], formattedDate } = props
  const nodeRef = useRef(null)

  useImperativeHandle(ref, () => ({
    exportPng: async () => {
      const node = nodeRef.current
      if (!node) throw new Error('Card not ready')
      const dataUrl = await toPng(node, {
        width: CARD_W,
        height: shareCardHeight(variant, { duplas }),
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
        ? <PodiumCard game={game} duplas={duplas} />
        : variant === 'duplas'
        ? <DuplasCard game={game} duplas={duplas} />
        : <InviteCard game={game} people={people} capacity={capacity} formattedDate={formattedDate} />}
    </div>
  )
})

export default ShareCard
