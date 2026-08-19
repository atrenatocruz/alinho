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

function bakeCircularAvatar(img, size) {
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

  return canvas.toDataURL('image/png')
}

function useCircularAvatar(url, size) {
  const cacheKey = url ? `${url}|${size}` : null
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
        const baked = bakeCircularAvatar(img, size)
        avatarBakeCache.set(cacheKey, baked)
        if (!cancelled) setBakedUrl(baked)
      })
      .catch(() => {
        // leave bakedUrl null — CardAvatar falls back to the initials circle
      })
    return () => { cancelled = true }
  }, [url, size, cacheKey])

  return bakedUrl
}

/* Shows the player's photo once it's been baked into a local circular PNG,
   otherwise the initial-in-a-circle fallback (also used while the photo is
   still loading, and permanently if it has none / fails to load). The baked
   photo needs no rounding/clipping classes — it's already circular. */
function CardAvatar({ name, url, size = 40 }) {
  const bakedUrl = useCircularAvatar(url, size)
  const base = { width: size, height: size }
  if (bakedUrl) {
    return <img src={bakedUrl} alt={name || ''} style={base} className="shrink-0" />
  }
  return (
    <div
      style={base}
      className="rounded-full bg-ink-700 text-lime-400 flex items-center justify-center font-extrabold shrink-0"
    >
      <span style={{ fontSize: size * 0.4 }}>{initial(name)}</span>
    </div>
  )
}

/* Faint alinho ball mark behind the content — a quiet brand texture
   instead of a blank dark rectangle. Percentage-centered (not tied to
   CARD_H) so it looks right on both the fixed-height cards and DuplasCard's
   content-driven autoHeight. Same ring+swoosh paths as src/logo/icon-mark.svg,
   minus its background square (would show as an odd faint box otherwise). */
function LogoWatermark() {
  return (
    <svg
      viewBox="0 0 27.1915 27.1915"
      className="absolute left-1/2 top-1/2 w-[440px] h-[440px] -translate-x-1/2 -translate-y-1/2 opacity-[0.035]"
      aria-hidden="true"
    >
      <path d="M23.517 13.5958 C23.517 8.1164 19.075 3.6745 13.595 3.6745 C8.116 3.6745 3.674 8.1164 3.674 13.5958 C3.674 19.0751 8.116 23.517 13.595 23.517 V27.1915 C6.087 27.1915 0 21.1045 0 13.5958 C0 6.087 6.087 0 13.595 0 C21.104 0 27.191 6.087 27.191 13.5958 C27.191 21.1045 21.104 27.1915 13.595 27.1915 V23.517 C19.075 23.517 23.517 19.0751 23.517 13.5958 Z" fill="#C5DD01" />
      <path d="M3.911 15.7466 C5.375 15.2233 6.72 15.1111 7.973 15.3481 C9.716 15.6777 11.093 16.6464 12.227 17.6899 C12.796 18.2134 13.326 18.7778 13.82 19.3149 C14.325 19.8645 14.781 20.3718 15.247 20.8462 C16.16 21.7753 16.934 22.3765 17.715 22.6196 C16.661 23.1016 15.51 23.404 14.296 23.4887 C13.985 23.2157 13.69 22.932 13.412 22.6489 C12.906 22.1343 12.402 21.5709 11.927 21.0551 C11.442 20.5269 10.971 20.0303 10.485 19.5835 C9.51 18.6864 8.561 18.0769 7.496 17.8755 C6.765 17.7372 5.884 17.7744 4.789 18.1635 C4.397 17.4093 4.099 16.5987 3.911 15.7466 ZM9.439 4.5874 C10.878 6.8877 14.926 10.0422 22.376 8.978 C22.78 9.7452 23.086 10.5713 23.279 11.4409 C14.666 12.849 9.344 9.3088 7.26 5.9604 C7.92 5.4128 8.652 4.9511 9.439 4.5874 Z" fill="#FFFFFF" />
    </svg>
  )
}

// autoHeight lets the card grow to fit its content (CARD_H as a floor via
// minHeight) instead of a hard-fixed height — DuplasCard and PodiumCard use
// this since their lists of pairs can't be capped upfront and the card
// can't scroll to hide overflow. InviteCard keeps the fixed CARD_H: its
// content is always capped (6 avatars + overflow badge).
function CardShell({ children, autoHeight = false }) {
  return (
    <div
      style={autoHeight ? { width: CARD_W, minHeight: CARD_H } : { width: CARD_W, height: CARD_H }}
      className="relative overflow-hidden bg-ink-900 flex flex-col"
    >
      <LogoWatermark />
      <div className="relative flex-1 flex flex-col px-8 pt-14 pb-10">{children}</div>
    </div>
  )
}

function LogoFooter({ tagline = 'E tu, alinhas?' }) {
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
  const rest = duplas.slice(3)
  return (
    <CardShell autoHeight>
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
            <div className="flex gap-1 shrink-0">
              <CardAvatar name={d.player1?.name} url={d.player1?.avatar_url} size={34} />
              <CardAvatar name={d.player2?.name} url={d.player2?.avatar_url} size={34} />
            </div>
            <span className="flex-1 min-w-0 text-white font-extrabold text-base leading-tight">
              {d.name}
            </span>
            <span className="text-lime-400 font-extrabold text-xl tabular-nums shrink-0">
              {d.points}
            </span>
          </div>
        ))}
      </div>
      {rest.length > 0 && (
        <div className="space-y-1 mt-3">
          {rest.map((d, i) => (
            <div key={d.id} className="flex items-center gap-3 rounded-xl px-4 py-2">
              <span className="text-[11px] font-extrabold text-ink-200 tabular-nums shrink-0 w-4">
                {i + 4}
              </span>
              <span className="flex-1 min-w-0 text-white font-semibold text-[13px] leading-tight">
                {d.name}
              </span>
              <span className="text-lime-400 font-extrabold text-sm tabular-nums shrink-0">
                {d.points}
              </span>
            </div>
          ))}
        </div>
      )}
      <LogoFooter />
    </CardShell>
  )
}

// The card can't scroll (it's rasterized to a static image) and its height
// now auto-fits the content (see CardShell's autoHeight), so a long list of
// pairs simply makes the exported image taller instead of clipping. This
// density tier just keeps a big list from looking sparse/oversized:
// compact (smaller avatars, tighter rows) once there are more than a
// typical mix's worth of duplas.
const DUPLAS_COMPACT_THRESHOLD = 5

// align="end" (the team on the left of "vs") reverses each row so the
// avatar — fixed-size, unlike the name — sits flush against "vs" at a
// constant offset. Right-justifying the row as a whole instead (an
// earlier attempt) broke down here: a two-line wrapped name gives that
// row a different total cluster width than a one-line row, so the
// avatars stopped lining up vertically between the two rows of the same
// team. Anchoring on the avatar side keeps both rows' avatars at the
// same x regardless of how the name wraps.
function DuplaPlayers({ team, compact, avatarSize, align = 'start' }) {
  return (
    <div className={`${compact ? 'space-y-1' : 'space-y-1.5'} w-full`}>
      {[team?.player1, team?.player2].map((player, idx) => (
        <div
          key={player?.id || idx}
          className={`flex items-center gap-2 min-w-0 w-full ${align === 'end' ? 'flex-row-reverse' : ''}`}
        >
          <CardAvatar name={player?.name} url={player?.avatar_url} size={avatarSize} />
          <span
            className={`text-white font-extrabold leading-tight min-w-0 ${compact ? 'text-[12px]' : 'text-sm'} ${align === 'end' ? 'text-right' : ''}`}
          >
            {player?.name || '?'}
          </span>
        </div>
      ))}
    </div>
  )
}

// Grouped by court by list position (1st & 2nd dupla → court 1, 3rd & 4th
// → court 2, ...) rather than seed_ranking — seed_ranking is set once when
// duplas are formed and never updated by a manual admin swap, so sorting by
// it here would show a different (stale) pairing than the app's own Duplas
// view, which pairs the same way. A leftover unpaired dupla (odd count) is
// dropped, since the card can't show a dupla with no opponent.
function DuplasCard({ game, duplas }) {
  const compact = duplas.length >= DUPLAS_COMPACT_THRESHOLD
  const avatarSize = compact ? 22 : 34
  const numCourts = game.num_courts || Math.ceil(duplas.length / 2)
  const teamById = Object.fromEntries(duplas.map(d => [d.id, d]))
  const courtMatches = []
  for (let c = 1; c <= numCourts; c++) {
    const a = duplas[(c - 1) * 2]
    const b = duplas[(c - 1) * 2 + 1]
    if (a && b) courtMatches.push({ court_number: c, team_a_id: a.id, team_b_id: b.id })
  }

  return (
    <CardShell autoHeight>
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
        {courtMatches.map((m) => {
          const a = teamById[m.team_a_id]
          const b = teamById[m.team_b_id]
          return (
            <div key={m.court_number} className={`rounded-2xl bg-white/5 ${compact ? 'px-3 py-2.5' : 'px-4 py-3.5'}`}>
              <p className={`font-mono font-extrabold uppercase tracking-wide text-lime-400 ${compact ? 'text-[9px] mb-1.5' : 'text-[11px] mb-2'}`}>
                Campo {m.court_number}
              </p>
              <div className="flex items-center">
                <div className="flex-1 min-w-0">
                  <DuplaPlayers team={a} compact={compact} avatarSize={avatarSize} align="end" />
                </div>
                <p className={`shrink-0 font-extrabold text-ink-200 ${compact ? 'text-[10px] px-1.5' : 'text-xs px-2'}`}>vs</p>
                <div className="flex-1 min-w-0">
                  <DuplaPlayers team={b} compact={compact} avatarSize={avatarSize} />
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <LogoFooter />
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
      // Measured, not estimated: scrollHeight reflects the node's actual
      // layout height regardless of the 0.55 CSS-transform scale the
      // on-screen preview wraps it in (transforms don't affect layout
      // metrics), so this is exact for autoHeight cards (DuplasCard) and a
      // no-op for fixed-height ones (InviteCard/PodiumCard, always CARD_H).
      const height = Math.max(CARD_H, node.scrollHeight)
      const dataUrl = await toPng(node, {
        width: CARD_W,
        height,
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
