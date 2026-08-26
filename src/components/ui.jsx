import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { MapPin, CheckCircle2, ChevronRight, ChevronDown, ChevronLeft, Lock, Play, Calendar, X, Share2, MessageCircle, Link2, ImageDown, Trophy, Repeat } from 'lucide-react'
import ShareCard, { CARD_W, CARD_H } from './ShareCard'
import { ratingBand, groupRatingBand } from '../lib/elo'

/* ─── Date fields ────────────────────────────────────────────────────────
   Native <input type=date/datetime-local> pickers open reliably on iOS
   Safari (any tap opens the full OS picker) but not on desktop Chrome/
   Edge/Firefox, where only a click on the browser's own tiny built-in
   calendar icon opens anything. Both fields below are fully custom instead
   — a styled trigger box (unchanged look) opens our own portal'd bottom
   sheet with a month-grid calendar, so behavior is identical everywhere. */

const WEEKDAY_LABELS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

// Portuguese month names for the quick month-jump Select, capitalized the
// same way as the header label (JS, not CSS — see the note below).
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => {
  const label = new Date(2000, i, 1).toLocaleDateString('pt-PT', { month: 'long' })
  return { value: i, label: label.charAt(0).toUpperCase() + label.slice(1) }
})

// Bounds the year-jump Select's option list. With both min and max (games
// have neither, birthdays only have max) the range is exact; with only a
// max (birthdays) it opens up 120 years back — enough for anyone filling
// in their own birth year without endless scrolling; with neither
// (unconstrained dates) it's just a handful of years around today.
function yearOptionsFor(min, max) {
  const thisYear = new Date().getFullYear()
  let startYear, endYear
  if (min && max) {
    startYear = min.getFullYear()
    endYear = max.getFullYear()
  } else if (max) {
    endYear = max.getFullYear()
    startYear = endYear - 120
  } else {
    startYear = thisYear - 1
    endYear = thisYear + 5
  }
  const years = []
  for (let y = endYear; y >= startYear; y--) years.push({ value: y, label: String(y) })
  return years
}

function toIsoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/* Month grid used by both DateField and DateTimeField's picker sheet.
   `selected`/`min`/`max` are Date objects or null; `viewDate` is the 1st
   of the month currently on screen (navigation doesn't move `selected`
   until a day is actually tapped). Month/year are also directly jumpable
   (not just +/-1 arrows) — stepping one month at a time from today back to
   a decades-old birth year is a real, reported usability problem. */
function MonthCalendar({ selected, viewDate, onNavigate, onJumpTo, onSelectDay, min, max }) {
  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const firstWeekday = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const cells = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-4">
        <button
          type="button"
          onClick={() => onNavigate(-1)}
          aria-label="Mês anterior"
          className="w-9 h-9 shrink-0 flex items-center justify-center rounded-full text-ink-700 hover:bg-ink-50 transition-colors duration-fast"
        >
          <ChevronLeft size={20} />
        </button>
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <Select
            value={month}
            onChange={(m) => onJumpTo(year, Number(m))}
            options={MONTH_OPTIONS}
            className="flex-1 min-w-0 py-2"
          />
          <Select
            value={year}
            onChange={(y) => onJumpTo(Number(y), month)}
            options={yearOptionsFor(min, max)}
            className="w-24 shrink-0 py-2"
          />
        </div>
        <button
          type="button"
          onClick={() => onNavigate(1)}
          aria-label="Mês seguinte"
          className="w-9 h-9 shrink-0 flex items-center justify-center rounded-full text-ink-700 hover:bg-ink-50 transition-colors duration-fast"
        >
          <ChevronRight size={20} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAY_LABELS.map((w, i) => (
          <div key={i} className="text-center text-[11px] font-extrabold uppercase text-muted py-1">{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (d === null) return <div key={`e${i}`} />
          const cellDate = new Date(year, month, d)
          const isSelected = !!selected
            && selected.getFullYear() === year && selected.getMonth() === month && selected.getDate() === d
          const disabled = (min && cellDate < min) || (max && cellDate > max)
          return (
            <button
              key={d}
              type="button"
              disabled={disabled}
              onClick={() => onSelectDay(d)}
              className={`h-10 rounded-ctrl text-sm font-extrabold transition-colors duration-fast ${
                isSelected ? 'bg-lime-400 text-ink-900'
                : disabled ? 'text-muted/40 cursor-not-allowed'
                : 'text-ink-900 hover:bg-ink-50'
              }`}
            >
              {d}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function DateField({ value, onChange, max, min, placeholder = 'Seleciona a data' }) {
  const [open, setOpen] = useState(false)
  const selectedDate = value ? new Date(value + 'T00:00:00') : null
  const minDate = min ? new Date(min + 'T00:00:00') : null
  const maxDate = max ? new Date(max + 'T00:00:00') : null
  const [viewDate, setViewDate] = useState(selectedDate || new Date())

  const display = value
    ? new Date(value + 'T00:00:00').toLocaleDateString('pt-PT', { day: '2-digit', month: 'long', year: 'numeric' })
    : placeholder

  const openPicker = () => {
    setViewDate(selectedDate || new Date())
    setOpen(true)
  }

  const navigate = (delta) => {
    setViewDate((d) => new Date(d.getFullYear(), d.getMonth() + delta, 1))
  }

  const jumpTo = (year, month) => {
    setViewDate(new Date(year, month, 1))
  }

  const selectDay = (day) => {
    onChange(toIsoDate(new Date(viewDate.getFullYear(), viewDate.getMonth(), day)))
    setOpen(false)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={openPicker}
        className={`input-field flex items-center justify-between text-left ${value ? 'text-ink-900' : 'text-muted'}`}
      >
        <span className="truncate">{display}</span>
        <Calendar size={20} className="text-ink-700 shrink-0 ml-2" />
      </button>

      {open && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink-900/50 animate-fade-in"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-surface rounded-t-card sm:rounded-card shadow-lift w-full sm:max-w-md max-h-[90vh] overflow-y-auto overflow-x-hidden p-5 animate-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg text-ink-900">{placeholder}</h3>
              <button
                onClick={() => setOpen(false)}
                aria-label="Fechar"
                className="w-9 h-9 flex items-center justify-center rounded-full text-muted hover:bg-ink-50 hover:text-ink-900 transition-colors duration-fast"
              >
                <X size={20} />
              </button>
            </div>
            <MonthCalendar
              selected={selectedDate}
              viewDate={viewDate}
              onNavigate={navigate}
              onJumpTo={jumpTo}
              onSelectDay={selectDay}
              min={minDate}
              max={maxDate}
            />
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

export function DateTimeField({ value, onChange, placeholder = 'Seleciona data e hora' }) {
  const [open, setOpen] = useState(false)
  // Pending date (from the calendar) and time (from the native time input)
  // are held separately while the sheet is open, and only combined into
  // one value when "Confirmar" is tapped — picking a day shouldn't close
  // this sheet the way it does for DateField, since there's still a time
  // to set.
  const initialDate = value ? new Date(value) : null
  const [pendingDate, setPendingDate] = useState(initialDate)
  const [pendingTime, setPendingTime] = useState(
    initialDate
      ? `${String(initialDate.getHours()).padStart(2, '0')}:${String(initialDate.getMinutes()).padStart(2, '0')}`
      : '10:00'
  )
  const [viewDate, setViewDate] = useState(initialDate || new Date())

  const display = value
    ? new Date(value).toLocaleString('pt-PT', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : placeholder

  const openPicker = () => {
    const current = value ? new Date(value) : null
    setPendingDate(current)
    setPendingTime(
      current
        ? `${String(current.getHours()).padStart(2, '0')}:${String(current.getMinutes()).padStart(2, '0')}`
        : '10:00'
    )
    setViewDate(current || new Date())
    setOpen(true)
  }

  const navigate = (delta) => {
    setViewDate((d) => new Date(d.getFullYear(), d.getMonth() + delta, 1))
  }

  const jumpTo = (year, month) => {
    setViewDate(new Date(year, month, 1))
  }

  const selectDay = (day) => {
    setPendingDate(new Date(viewDate.getFullYear(), viewDate.getMonth(), day))
  }

  const confirm = () => {
    if (!pendingDate) return
    const [hours, minutes] = pendingTime.split(':').map(Number)
    const combined = new Date(pendingDate.getFullYear(), pendingDate.getMonth(), pendingDate.getDate(), hours, minutes)
    const iso = `${combined.getFullYear()}-${String(combined.getMonth() + 1).padStart(2, '0')}-${String(combined.getDate()).padStart(2, '0')}T${String(combined.getHours()).padStart(2, '0')}:${String(combined.getMinutes()).padStart(2, '0')}`
    onChange(iso)
    setOpen(false)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={openPicker}
        className={`input-field flex items-center justify-between text-left ${value ? 'text-ink-900' : 'text-muted'}`}
      >
        <span className="truncate">{display}</span>
        <Calendar size={20} className="text-ink-700 shrink-0 ml-2" />
      </button>

      {open && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink-900/50 animate-fade-in"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-surface rounded-t-card sm:rounded-card shadow-lift w-full sm:max-w-md max-h-[90vh] overflow-y-auto overflow-x-hidden p-5 animate-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg text-ink-900">{placeholder}</h3>
              <button
                onClick={() => setOpen(false)}
                aria-label="Fechar"
                className="w-9 h-9 flex items-center justify-center rounded-full text-muted hover:bg-ink-50 hover:text-ink-900 transition-colors duration-fast"
              >
                <X size={20} />
              </button>
            </div>
            <MonthCalendar
              selected={pendingDate}
              viewDate={viewDate}
              onNavigate={navigate}
              onJumpTo={jumpTo}
              onSelectDay={selectDay}
              min={null}
              max={null}
            />
            <div className="mt-4 min-w-0">
              <label className="block text-sm font-extrabold text-ink-900 mb-2">Hora</label>
              {/* iOS Safari's native time-picker control can ignore `width:
                  100%` and render at its own internal width instead,
                  pushing past the card's right edge — `min-w-0` overrides
                  the implicit "don't shrink below content size" default
                  that causes it. */}
              <input
                type="time"
                value={pendingTime}
                onChange={(e) => setPendingTime(e.target.value)}
                className="input-field w-full min-w-0 box-border"
                aria-label="Hora"
              />
            </div>
            <button
              type="button"
              onClick={confirm}
              disabled={!pendingDate}
              className="btn-primary w-full mt-4 disabled:opacity-40 disabled:pointer-events-none"
            >
              Confirmar
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════
   UI kit — alinho
   Reusable components: PrimaryButton, RatingBadge, PlayerAvatarRow,
   EmptyState, MixCard. Design tokens live in src/index.css.
   ════════════════════════════════════════════════════════════════════════ */

/* ─── BadgePill ──────────────────────────────────────────────────────────
   Pill partilhado por RatingBadge e GroupLevelBadge — as várias famílias
   de badge têm de se manter visualmente idênticas, por isso o markup vive
   uma vez. */
function BadgePill({ text, title, me = false, size = 'sm' }) {
  const sizes = {
    sm: 'text-[11px] px-2 py-0.5',
    md: 'text-sm px-3 py-1',
  }
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-full font-mono font-extrabold tracking-wide uppercase
                  ${sizes[size]}
                  ${me ? 'bg-lime-400 text-ink-900' : 'bg-ink-900 text-lime-400'}`}
    >
      {text}
    </span>
  )
}

/* ─── RatingBadge ────────────────────────────────────────────────────────
   Banda pública do Elo (M6, F4, INI…), derivada do rating do jogador. Não renderiza nada
   para contas ainda sem rating. */
export function RatingBadge({ rating, gender, me = false, size = 'sm' }) {
  const band = ratingBand(rating, gender)
  if (!band) return null
  return <BadgePill text={band.label} title={band.full} me={me} size={size} />
}

/* ─── GroupLevelBadge ────────────────────────────────────────────────────
   Mesmo visual do RatingBadge, mas para a média de um clube/grupo (prefixo
   N em vez de M/F — ver groupRatingBand). Não renderiza nada sem rating. */
export function GroupLevelBadge({ rating, size = 'sm' }) {
  const band = groupRatingBand(rating)
  if (!band) return null
  return <BadgePill text={band.label} title={band.full} size={size} />
}

/* ─── PrimaryButton ──────────────────────────────────────────────────────
   variant: "lime" (main CTA) | "navy" | "ghost" | "danger" | "whatsapp" */
export function PrimaryButton({ variant = 'lime', className = '', children, ...props }) {
  const variants = {
    lime:     'bg-lime-400 text-ink-900 hover:bg-lime-600 shadow-card',
    navy:     'bg-ink-700 text-white hover:bg-ink-500 shadow-card',
    ghost:    'bg-surface text-ink-900 border border-line hover:bg-ink-50 hover:border-ink-200',
    danger:   'bg-danger/10 text-danger hover:bg-danger/15',
    whatsapp: 'bg-[#25D366] text-white hover:bg-[#20bd5a] shadow-card',
  }
  return (
    <button
      className={`font-extrabold py-3.5 px-6 rounded-ctrl min-h-[48px] text-base
                  inline-flex items-center justify-center gap-2
                  transition-all duration-fast active:scale-[0.98]
                  disabled:opacity-40 disabled:pointer-events-none
                  ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

/* ─── RankBadge ──────────────────────────────────────────────────────────
   This player's position in the global ranking (get_global_rankings) —
   shown on both PlayerDetails.jsx and Profile.jsx. Same colour steps as
   Rankings.jsx's positionStyle: lime for 1st, dark tones for 2nd/3rd,
   neutral past that. `rank` is a plain 1-based position, computed by the
   caller from get_global_rankings' array order — since Elo v1 that order
   is rating-desc (Elo), NOT total_points-desc; any number shown next to
   this badge should be the rating, not the points. */
export function RankBadge({ rank, size = 'md' }) {
  if (!rank) return null
  const sizes = {
    sm: 'text-[11px] px-2 py-0.5 gap-1',
    md: 'text-sm px-2.5 py-1 gap-1',
  }
  const style =
    rank === 1 ? 'bg-lime-400 text-ink-900'
    : rank === 2 ? 'bg-ink-900 text-white'
    : rank === 3 ? 'bg-ink-700 text-white'
    : 'bg-ink-50 text-ink-700'
  return (
    <span
      title="Posição no ranking global"
      className={`inline-flex items-center rounded-full font-extrabold tabular-nums ${sizes[size]} ${style}`}
    >
      <Trophy size={size === 'sm' ? 12 : 14} />
      #{rank}
    </span>
  )
}

/* ─── GuestBadge ─────────────────────────────────────────────────────────
   Marks non-regular players inside game participant lists. */
export function GuestBadge({ size = 'sm', label = 'Convidado' }) {
  const sizes = {
    sm: 'text-[11px] px-2 py-0.5',
    md: 'text-sm px-3 py-1',
  }
  return (
    <span
      title={label === 'Teste' ? 'Jogador de teste (admin)' : 'Jogador convidado'}
      className={`inline-flex items-center rounded-full font-mono font-extrabold tracking-wide uppercase
                  border border-dashed border-ink-200 bg-canvas text-muted ${sizes[size]}`}
    >
      {label}
    </span>
  )
}

/* ─── Avatar ─────────────────────────────────────────────────────────────
   Shows the person's photo when they have one, otherwise the existing
   colored-circle-with-initial. `size` carries width/height/text-size (and
   any extra utility classes a call site needs, e.g. a ring); `colorClass`
   is the fallback bg/text pair — each call site keeps its own current
   look for people with no photo yet. */
export function Avatar({ name, url, size = 'w-10 h-10 text-sm', colorClass = 'bg-ink-700 text-white' }) {
  const base = `${size} rounded-full flex items-center justify-center shrink-0 font-extrabold overflow-hidden`
  if (url) {
    return <img src={url} alt={name || ''} className={`${base} object-cover`} />
  }
  return <div className={`${base} ${colorClass}`}>{(name || '?').charAt(0).toUpperCase()}</div>
}

/* ─── PlayerAvatarRow ────────────────────────────────────────────────────
   Filled initials + dashed empty slots + count. Slots visible at a glance.
   Caps visible avatars (cap) with a +N chip so wide games stay compact. */
export function PlayerAvatarRow({ players = [], max = 4, size = 'md', cap = 6 }) {
  const dim = size === 'sm' ? 'w-7 h-7 text-[11px]' : 'w-9 h-9 text-sm'
  const shown = players.slice(0, cap)
  const overflow = players.length - shown.length
  // only show empty slots when nothing is hidden (small games)
  const empty = overflow > 0 ? 0 : Math.max(0, Math.min(max - players.length, cap - shown.length))
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex -space-x-2">
        {shown.map((p, i) => (
          <div key={p.id || i} title={p.name} style={{ zIndex: cap - i }} className="relative">
            <Avatar name={p.name} url={p.avatar_url} size={`${dim} ring-2 ring-surface`} />
          </div>
        ))}
        {Array.from({ length: empty }).map((_, i) => (
          <div
            key={`e${i}`}
            className={`${dim} rounded-full border-2 border-dashed border-ink-200
                        bg-canvas ring-2 ring-surface`}
          />
        ))}
        {overflow > 0 && (
          <div className={`${dim} relative rounded-full bg-ink-50 text-ink-700 font-extrabold
                          flex items-center justify-center ring-2 ring-surface`}>
            +{overflow}
          </div>
        )}
      </div>
      <span className="text-sm font-extrabold text-ink-900 tabular-nums">
        {players.length}<span className="text-muted font-normal">/{max}</span>
      </span>
    </div>
  )
}

/* ─── EmptyState ─────────────────────────────────────────────────────────
   Friendly copy + court-line motif (now with a small lime ball-ring accent,
   a nod to the logo) + always one clear action. */
export function EmptyState({ icon: Icon, title, subtitle, action }) {
  return (
    <div className="card text-center py-12 px-6 animate-fade-up">
      <div className="relative w-24 h-24 mx-auto mb-5">
        {/* faint court-line motif */}
        <svg viewBox="0 0 96 96" className="absolute inset-0 text-ink-50" fill="none">
          <rect x="8" y="14" width="80" height="68" rx="10" stroke="currentColor" strokeWidth="2.5" />
          <line x1="48" y1="14" x2="48" y2="82" stroke="currentColor" strokeWidth="2.5" />
          <line x1="8" y1="48" x2="88" y2="48" stroke="currentColor" strokeWidth="2.5" strokeDasharray="4 5" />
          {/* ball-ring accent, echoing the logo's lime ring glyph */}
          <circle cx="76" cy="24" r="9" stroke="#C5DD01" strokeWidth="2.5" />
        </svg>
        {Icon && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Icon size={32} strokeWidth={2} className="text-ink-700" />
          </div>
        )}
      </div>
      <h3 className="text-lg text-ink-900 mb-1">{title}</h3>
      {subtitle && <p className="text-muted text-sm mb-6">{subtitle}</p>}
      {action}
    </div>
  )
}

/* ─── MixCard ────────────────────────────────────────────────────────────
   Scannable at a glance: when, where, levels, slots, my state.
   States: open | closed (court reservado) | completed | joined. */
export function MixCard({ game, joined = false, showClub = false }) {
  // Every person in the game — a row with partner counts as 2 players
  const players = (game.participants || [])
    .filter(p => p.status === 'confirmed')
    .flatMap(p => [
      { id: p.user_id, name: p.user?.name, rating: p.user?.rating, isGuest: p.user?.is_guest, avatar_url: p.user?.avatar_url },
      ...(p.partner_id ? [{ id: p.partner_id, name: p.partner?.name, rating: p.partner?.rating, isGuest: p.partner?.is_guest, avatar_url: p.partner?.avatar_url }] : []),
    ])

  // Guests count as players but their rating shouldn't skew the group level
  const ratedPlayers = players.filter(p => !p.isGuest && p.rating != null)
  const avgRating = ratedPlayers.length > 0
    ? ratedPlayers.reduce((sum, p) => sum + p.rating, 0) / ratedPlayers.length
    : null
  // A full game reads as closed even if the stored status lagged behind
  const capacity = game.max_players || (game.num_courts || 1) * 4
  const isFull = players.length >= capacity
  const isClosed = game.status === 'closed' || (game.status === 'open' && isFull)
  const isLive = game.status === 'in_progress'
  const isDone = game.status === 'completed' || game.status === 'finished'

  const d = new Date(game.date)
  const today = new Date(); const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  const dayLabel =
    d.toDateString() === today.toDateString() ? 'Hoje'
    : d.toDateString() === tomorrow.toDateString() ? 'Amanhã'
    : d.toLocaleDateString('pt-PT', { weekday: 'short', day: 'numeric', month: 'short' })
  const time = d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })

  return (
    <Link
      to={`/jogo/${game.id}`}
      className={`card press block hover:shadow-lift relative overflow-hidden
                  ${isDone ? 'opacity-60' : ''}`}
    >
      {/* joined = lime accent bar, instantly distinct */}
      {joined && <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-lime-400" />}

      <div className="flex items-start justify-between gap-3 mb-3">
        {/* When — the strongest element on the card */}
        <div>
          <p className="text-xs font-extrabold uppercase tracking-widest text-ink-700">{dayLabel}</p>
          <p className="text-2xl text-ink-900 leading-tight">{time}</p>
        </div>

        {/* State — color + icon, never text alone */}
        {isLive ? (
          <span className="inline-flex items-center gap-1.5 bg-lime-400 text-ink-900 text-xs font-extrabold px-3 py-1.5 rounded-full">
            <Play size={14} /> A decorrer
          </span>
        ) : isDone ? (
          <span className="inline-flex items-center gap-1.5 bg-ink-50 text-ink-700 text-xs font-extrabold px-3 py-1.5 rounded-full">
            <CheckCircle2 size={14} /> Mix terminado
          </span>
        ) : joined ? (
          <span className="inline-flex items-center gap-1.5 bg-lime-400 text-ink-900 text-xs font-extrabold px-3 py-1.5 rounded-full">
            <CheckCircle2 size={14} /> Inscrito
          </span>
        ) : null}
      </div>

      {showClub && game.organization?.name && (
        <p className="text-[11px] font-extrabold uppercase tracking-widest text-lime-700 mb-1">
          {game.organization.name}
        </p>
      )}
      {game.recurrence_id && (
        <p className="flex items-center gap-1 text-[11px] font-extrabold uppercase tracking-widest text-lime-700 mb-1">
          <Repeat size={12} /> Recorrente
        </p>
      )}
      <h3 className="text-lg text-ink-900 leading-snug mb-1">{game.title}</h3>
      {game.location && (
        <p className="flex items-center gap-1.5 text-muted text-sm mb-4">
          <MapPin size={15} className="shrink-0" /> {game.location}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-3 border-t border-line">
        <div className="flex items-center gap-3 min-w-0">
          <PlayerAvatarRow players={players} max={game.max_players} size="sm" />
          <GroupLevelBadge rating={avgRating} />
        </div>
        {game.status === 'open' && !joined && !isFull && (
          <span className="ml-auto inline-flex items-center gap-0.5 text-ink-700 text-sm font-extrabold">
            Jogar <ChevronRight size={16} />
          </span>
        )}
        {isClosed && !isLive && !isDone && (
          <span className="ml-auto inline-flex items-center gap-1.5 bg-ok/10 text-ok text-[11px] font-extrabold px-2.5 py-1 rounded-full">
            <Lock size={13} className="shrink-0" /> Mix fechado — campo reservado
          </span>
        )}
      </div>
    </Link>
  )
}

/* ─── ShareModal ─────────────────────────────────────────────────────────
   Share sheet used for mixes: editable caption + link, WhatsApp + native
   share (when the device supports it) + copy-link fallback. */
export function ShareModal({ title = 'Partilhar', message, url, onClose, imageCard }) {
  const [caption, setCaption] = useState(message)
  const [editingCaption, setEditingCaption] = useState(false)
  const [copied, setCopied] = useState(false)
  const shareCardRef = useRef(null)
  const previewMeasureRef = useRef(null)
  const [cardHeight, setCardHeight] = useState(CARD_H)
  const [generatingImage, setGeneratingImage] = useState(false)
  const [imageError, setImageError] = useState('')
  const [imageSavedHint, setImageSavedHint] = useState(false)

  const fullText = `${caption}\n\n🔗 ${url}`

  // Some cards (DuplasCard) size themselves to their content instead of a
  // fixed height — measure the actual rendered height so the preview
  // container matches exactly what exportPng() will rasterize, instead of
  // guessing a size upfront. ResizeObserver also catches late layout shifts
  // (e.g. a custom font finishing load after first paint).
  useEffect(() => {
    if (!imageCard) return
    const el = previewMeasureRef.current
    if (!el) return
    const update = () => setCardHeight(Math.max(CARD_H, el.scrollHeight))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [imageCard])

  const handleShareImage = async () => {
    setGeneratingImage(true)
    setImageError('')
    setImageSavedHint(false)
    try {
      const blob = await shareCardRef.current.exportPng()
      const file = new File([blob], 'alinho-mix.png', { type: 'image/png' })
      if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title, text: caption })
        } catch {
          // user cancelled the OS share sheet — nothing to do
        }
      } else {
        const objectUrl = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = objectUrl
        a.download = 'alinho-mix.png'
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(objectUrl)
        setImageSavedHint(true)
      }
    } catch (error) {
      console.error('Error generating share image:', error)
      setImageError('Não foi possível gerar a imagem. Tenta novamente.')
    } finally {
      setGeneratingImage(false)
    }
  }

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard API unavailable (older browsers, insecure context) — the
      // link is still visible in the textarea/preview for manual copy.
    }
  }

  const handleWhatsApp = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(fullText)}`, '_blank', 'noopener,noreferrer')
  }

  const handleNativeShare = async () => {
    try {
      await navigator.share({ title, text: caption, url })
    } catch {
      // user cancelled the OS share sheet — nothing to do
    }
  }

  // Rendered via portal straight into <body> — this modal is opened from
  // pages nested inside <main>, which carries a permanent (fill-mode:
  // both) animate-fade-up transform. An ancestor with any transform,
  // including a completed one, becomes the containing block for
  // descendant `fixed` elements on iOS Safari, so without the portal this
  // renders inline in the page instead of as a fullscreen overlay.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink-900/50 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-t-card sm:rounded-card shadow-lift w-full sm:max-w-md max-h-[90vh] overflow-y-auto animate-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-2">
            <Share2 size={20} className="text-ink-700" />
            <h3 className="text-lg text-ink-900">{title}</h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="w-9 h-9 flex items-center justify-center rounded-full text-muted hover:bg-ink-50 hover:text-ink-900 transition-colors duration-fast"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-5 pb-5 space-y-4">
          {imageCard && (
            <div className="space-y-3 pb-4 border-b border-line">
              <div className="flex justify-center">
                <div
                  style={{ width: CARD_W * 0.55, height: cardHeight * 0.55 }}
                  className="relative overflow-hidden rounded-ctrl shadow-card"
                >
                  <div style={{ transform: 'scale(0.55)', transformOrigin: 'top left', width: CARD_W }}>
                    <div ref={previewMeasureRef}>
                      <ShareCard ref={shareCardRef} {...imageCard} />
                    </div>
                  </div>
                </div>
              </div>

              {imageError && (
                <p className="text-danger text-sm font-extrabold text-center">{imageError}</p>
              )}
              {imageSavedHint && (
                <p className="text-ok text-sm font-extrabold text-center">
                  Imagem guardada — abre o Instagram e escolhe-a nos teus stories.
                </p>
              )}

              <PrimaryButton onClick={handleShareImage} disabled={generatingImage} className="w-full">
                <ImageDown size={20} />
                {generatingImage ? 'A gerar imagem…' : 'Partilhar imagem'}
              </PrimaryButton>
            </div>
          )}

          <div className="bg-canvas rounded-ctrl p-3.5 text-sm text-ink-900 whitespace-pre-line">
            {fullText}
          </div>

          {editingCaption ? (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-extrabold text-ink-900">Legenda</label>
                <div className="flex items-center gap-3">
                  {caption !== message && (
                    <button
                      onClick={() => setCaption(message)}
                      className="text-ink-700 text-xs font-extrabold"
                    >
                      Repor
                    </button>
                  )}
                  <button
                    onClick={() => setEditingCaption(false)}
                    className="text-ink-700 text-xs font-extrabold"
                  >
                    Concluído
                  </button>
                </div>
              </div>
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                rows={4}
                className="input-field resize-none"
                autoFocus
              />
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="flex-1 min-w-0 truncate text-sm text-muted">
                <span className="font-extrabold text-ink-900">Legenda: </span>
                {caption}
              </p>
              <button
                onClick={() => setEditingCaption(true)}
                className="text-ink-700 text-xs font-extrabold shrink-0"
              >
                Editar
              </button>
            </div>
          )}

          <button
            onClick={handleCopyLink}
            className="w-full flex items-center gap-2.5 rounded-ctrl border border-line px-3.5 py-3 min-h-[48px]
                       text-sm font-extrabold text-ink-900 hover:border-ink-200 transition-colors duration-fast"
          >
            <Link2 size={16} className="text-ink-700 shrink-0" />
            <span className="flex-1 min-w-0 text-left truncate text-muted font-normal">{url}</span>
            <span className="text-ink-700 shrink-0">{copied ? 'Copiado!' : 'Copiar'}</span>
          </button>

          <PrimaryButton variant="whatsapp" onClick={handleWhatsApp} className="w-full">
            <MessageCircle size={20} />
            Partilhar via WhatsApp
          </PrimaryButton>

          {typeof navigator !== 'undefined' && navigator.share && (
            <PrimaryButton variant="ghost" onClick={handleNativeShare} className="w-full">
              <Share2 size={20} />
              Mais opções
            </PrimaryButton>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

// Browsers only let an AudioContext actually produce sound if it was
// created/resumed during a genuine user gesture (click/tap) — one created
// later from a timer callback (the round hitting 00:00) is silently
// suspended forever, which is why the beep wasn't audible. Fix: keep ONE
// shared context alive for the page, and resume it on the admin's very
// first tap anywhere (RoundTimer wires this up below) — by the time the
// round actually expires, the context is already running, so the beep
// that fires later plays normally.
let sharedAudioCtx = null
function getSharedAudioContext() {
  if (!sharedAudioCtx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    sharedAudioCtx = new AudioCtx()
  }
  return sharedAudioCtx
}

// Three short beeps via the Web Audio API — no bundled audio asset, works
// offline as a PWA, and needs no license. Wrapped in try/catch: Web Audio
// can be unavailable on some browsers: the visual "00:00" state is still
// enough of a signal if the beep is silently skipped.
function playRoundEndBeep() {
  try {
    const ctx = getSharedAudioContext()
    if (ctx.state === 'suspended') ctx.resume()
    const now = ctx.currentTime
    ;[0, 0.25, 0.5].forEach((offset) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.001, now + offset)
      gain.gain.exponentialRampToValueAtTime(0.3, now + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.2)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + offset)
      osc.stop(now + offset + 0.25)
    })
  } catch {
    // Web Audio unavailable — silent fallback.
  }
}

/* Per-round countdown. Visible to everyone; the +/- adjust controls and
   the expiry beep are admin-only. `startedAt`/`durationMinutes` come
   straight from the `games` row, which every open device already receives
   live via the existing Realtime subscription on games UPDATE — no new
   sync mechanism needed here. */
export function RoundTimer({ startedAt, durationMinutes, isAdmin, onAdjust }) {
  const [now, setNow] = useState(Date.now())
  const alertedRef = useRef(false)

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  // Unlock the shared audio context on the admin's first tap anywhere on
  // the page — this IS a genuine user gesture, so it's allowed to start
  // the context running, unlike the expiry beep itself (fired from a
  // timer, not a click).
  useEffect(() => {
    if (!isAdmin) return
    const unlock = () => {
      const ctx = getSharedAudioContext()
      if (ctx.state === 'suspended') ctx.resume()
    }
    document.addEventListener('pointerdown', unlock, { once: true })
    return () => document.removeEventListener('pointerdown', unlock)
  }, [isAdmin])

  // Re-arm the alert whenever a new round starts, or the admin extends a
  // round that had already rung once (so it can ring again at the new end).
  useEffect(() => {
    alertedRef.current = false
  }, [startedAt, durationMinutes])

  const endTime = startedAt ? new Date(startedAt).getTime() + (durationMinutes || 0) * 60000 : null
  const remainingMs = endTime !== null ? Math.max(0, endTime - now) : null
  const expired = remainingMs !== null && remainingMs <= 0

  useEffect(() => {
    if (expired && isAdmin && !alertedRef.current) {
      alertedRef.current = true
      playRoundEndBeep()
    }
  }, [expired, isAdmin])

  if (!startedAt || !durationMinutes) return null

  const totalSeconds = Math.ceil(remainingMs / 1000)
  const mm = Math.floor(totalSeconds / 60).toString().padStart(2, '0')
  const ss = (totalSeconds % 60).toString().padStart(2, '0')

  // Ball-ring progress indicator — a nod to the logo's lime ring glyph,
  // sweeping clockwise from full down to empty as the round counts down.
  const totalDurationMs = (durationMinutes || 0) * 60000
  const remainingFraction = totalDurationMs > 0 ? Math.max(0, Math.min(1, remainingMs / totalDurationMs)) : 0
  const ringRadius = 8
  const ringCircumference = 2 * Math.PI * ringRadius
  const ringOffset = ringCircumference * (1 - remainingFraction)

  return (
    <div className={`inline-flex items-center gap-2 ${expired ? 'text-danger animate-pulse' : 'text-ink-900'}`}>
      <svg width="20" height="20" viewBox="0 0 20 20" className="shrink-0 -rotate-90">
        <circle cx="10" cy="10" r={ringRadius} fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="2.5" />
        <circle
          cx="10" cy="10" r={ringRadius} fill="none"
          stroke={expired ? '#EF4444' : '#C5DD01'}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={ringCircumference}
          strokeDashoffset={ringOffset}
        />
      </svg>
      <span className="font-extrabold tabular-nums text-sm">{mm}:{ss}</span>
      {isAdmin && onAdjust && (
        <div className="flex items-center gap-1 ml-1">
          <button
            type="button"
            onClick={() => onAdjust(-5)}
            aria-label="Menos 5 minutos"
            className="w-6 h-6 flex items-center justify-center rounded-full bg-ink-50 text-ink-700 text-xs font-extrabold hover:bg-ink-200 transition-colors duration-fast"
          >
            −5
          </button>
          <button
            type="button"
            onClick={() => onAdjust(5)}
            aria-label="Mais 5 minutos"
            className="w-6 h-6 flex items-center justify-center rounded-full bg-ink-50 text-ink-700 text-xs font-extrabold hover:bg-ink-200 transition-colors duration-fast"
          >
            +5
          </button>
        </div>
      )}
    </div>
  )
}

/* ─── Select ─────────────────────────────────────────────────────────────
   Replaces native <select> everywhere in the app: interaction is fine on
   every browser, but an open native dropdown renders in the browser's own
   unstyled default look with no reliable cross-browser way to restyle it.
   `options` is [{ value, label }]. Trades away one thing a native <select>
   gets for free — typing a letter to jump to a matching option — but none
   of this app's option lists are long enough for that to matter. */
export function Select({ value, onChange, options, placeholder = 'Seleciona…', className = '' }) {
  const [open, setOpen] = useState(false)
  const selected = options.find((o) => o.value === value)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`input-field flex items-center justify-between text-left ${selected ? 'text-ink-900' : 'text-muted'} ${className}`}
      >
        <span className="truncate">{selected ? selected.label : placeholder}</span>
        <ChevronDown size={20} className="text-ink-700 shrink-0 ml-2" />
      </button>

      {open && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink-900/50 animate-fade-in"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-surface rounded-t-card sm:rounded-card shadow-lift w-full sm:max-w-md max-h-[70vh] overflow-y-auto animate-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <h3 className="text-lg text-ink-900">{placeholder}</h3>
              <button
                onClick={() => setOpen(false)}
                aria-label="Fechar"
                className="w-9 h-9 flex items-center justify-center rounded-full text-muted hover:bg-ink-50 hover:text-ink-900 transition-colors duration-fast"
              >
                <X size={20} />
              </button>
            </div>
            <div className="px-2 pb-5">
              {options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => { onChange(o.value); setOpen(false) }}
                  className={`w-full text-left px-3.5 py-3 rounded-ctrl text-base font-extrabold transition-colors duration-fast ${
                    o.value === value ? 'bg-lime-400/20 text-ink-900' : 'text-ink-900 hover:bg-ink-50'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
