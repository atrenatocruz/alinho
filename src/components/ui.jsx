import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight, ChevronDown, ChevronLeft, Lock, Calendar, X, Share2, MessageCircle, Link2, ImageDown, Trophy, Users, Ticket, Building2 } from 'lucide-react'
import ShareCard, { CARD_W, CARD_H } from './ShareCard'
import QRCode from 'qrcode'
import { ratingBand, groupRatingBand } from '../lib/elo'
import { planName } from '../lib/plans'
import { achievementIcon, RARITY_META } from '../lib/achievements'
import { formatDate } from '../lib/formatDate'
import { listFollowers, listFollowing } from '../lib/follows'
import { describeError } from '../lib/errors'

/* ─── Date fields ────────────────────────────────────────────────────────
   Native <input type=date/datetime-local> pickers open reliably on iOS
   Safari (any tap opens the full OS picker) but not on desktop Chrome/
   Edge/Firefox, where only a click on the browser's own tiny built-in
   calendar icon opens anything. Both fields below are fully custom instead
   — a styled trigger box (unchanged look) opens our own portal'd bottom
   sheet with a month-grid calendar, so behavior is identical everywhere. */

// Single-letter weekday headers for the calendar grid. Locale-specific
// lookup rather than Intl.DateTimeFormat('narrow') because pt-PT's narrow
// weekdays don't match the single-letter convention players expect here
// (e.g. distinct Tue/Thu letters aren't needed — repeats are fine, same as
// most calendar UIs), so an explicit table per language is clearer than
// coaxing it out of Intl.
const WEEKDAY_LABELS = {
  pt: ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'],
  en: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
}

// Month names for the quick month-jump Select, capitalized the same way as
// the header label (JS, not CSS — see the note below). Built per-render
// (not module scope) so it can pick up the active language.
function monthOptionsFor(lang) {
  return Array.from({ length: 12 }, (_, i) => {
    const label = formatDate(new Date(2000, i, 1), lang, { month: 'long' })
    return { value: i, label: label.charAt(0).toUpperCase() + label.slice(1) }
  })
}

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
  const { t, i18n } = useTranslation()
  const weekdayLabels = WEEKDAY_LABELS[i18n.language] || WEEKDAY_LABELS.pt
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
          aria-label={t('ui.previous_month')}
          className="w-9 h-9 shrink-0 flex items-center justify-center rounded-full text-ink-700 hover:bg-ink-50 transition-colors duration-fast"
        >
          <ChevronLeft size={20} />
        </button>
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <Select
            value={month}
            onChange={(m) => onJumpTo(year, Number(m))}
            options={monthOptionsFor(i18n.language)}
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
          aria-label={t('ui.next_month')}
          className="w-9 h-9 shrink-0 flex items-center justify-center rounded-full text-ink-700 hover:bg-ink-50 transition-colors duration-fast"
        >
          <ChevronRight size={20} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {weekdayLabels.map((w, i) => (
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

export function DateField({ value, onChange, max, min, placeholder }) {
  const { t, i18n } = useTranslation()
  const resolvedPlaceholder = placeholder ?? t('ui.select_date_placeholder')
  const [open, setOpen] = useState(false)
  const selectedDate = value ? new Date(value + 'T00:00:00') : null
  const minDate = min ? new Date(min + 'T00:00:00') : null
  const maxDate = max ? new Date(max + 'T00:00:00') : null
  const [viewDate, setViewDate] = useState(selectedDate || new Date())

  const display = value
    ? formatDate(value + 'T00:00:00', i18n.language, { day: '2-digit', month: 'long', year: 'numeric' })
    : resolvedPlaceholder

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
              <h3 className="text-lg text-ink-900">{resolvedPlaceholder}</h3>
              <button
                onClick={() => setOpen(false)}
                aria-label={t('ui.close')}
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

export function DateTimeField({ value, onChange, placeholder }) {
  const { t, i18n } = useTranslation()
  const resolvedPlaceholder = placeholder ?? t('ui.select_datetime_placeholder')
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
    ? formatDate(value, i18n.language, { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : resolvedPlaceholder

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
              <h3 className="text-lg text-ink-900">{resolvedPlaceholder}</h3>
              <button
                onClick={() => setOpen(false)}
                aria-label={t('ui.close')}
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
              <label className="block text-sm font-extrabold text-ink-900 mb-2">{t('ui.hour_label')}</label>
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
                aria-label={t('ui.hour_label')}
              />
            </div>
            <button
              type="button"
              onClick={confirm}
              disabled={!pendingDate}
              className="btn-primary w-full mt-4 disabled:opacity-40 disabled:pointer-events-none"
            >
              {t('ui.confirm')}
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
export function BadgePill({ text, title, me = false, size = 'sm', onDark = false }) {
  const sizes = {
    sm: 'text-[11px] px-2 py-0.5',
    md: 'text-sm px-3 py-1',
  }
  // O badge normal e uma pilula ink-900 com texto lime. Sobre uma superficie
  // ink-900 — o heroi do Perfil e o do PlayerDetails — isso e preto sobre
  // preto: a pilula desaparece e fica so o texto a flutuar. `onDark` da-lhe
  // uma superficie visivel sem lhe roubar a identidade: continua a ser texto
  // lime, e o lime cheio fica reservado ao `me`, que e o sinal "este es tu".
  const variant = me
    ? 'bg-lime-400 text-ink-900'
    : onDark
      ? 'bg-lime-400/20 text-lime-400 ring-1 ring-lime-400/60'
      : 'bg-ink-900 text-lime-400'
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-full font-mono font-extrabold tracking-wide uppercase
                  ${sizes[size]} ${variant}`}
    >
      {text}
    </span>
  )
}

/* ─── RatingBadge ────────────────────────────────────────────────────────
   Banda pública do Elo (M6, F4, INI…), derivada do rating do jogador. Não renderiza nada
   para contas ainda sem rating. */
export function RatingBadge({ rating, gender, me = false, size = 'sm', onDark = false }) {
  const { t } = useTranslation()
  const band = ratingBand(rating, gender)
  if (!band) return null
  return <BadgePill text={band.label} title={t(band.fullKey, band.fullVars)} me={me} size={size} onDark={onDark} />
}

/* ─── GroupLevelBadge ────────────────────────────────────────────────────
   Mesmo visual do RatingBadge, mas para a média de um clube/grupo (prefixo
   N em vez de M/F — ver groupRatingBand). Não renderiza nada sem rating. */
export function GroupLevelBadge({ rating, size = 'sm' }) {
  const { t } = useTranslation()
  const band = groupRatingBand(rating)
  if (!band) return null
  return <BadgePill text={band.label} title={t(band.fullKey, band.fullVars)} size={size} />
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
  const { t } = useTranslation()
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
      title={t('ui.global_ranking_position')}
      className={`inline-flex items-center rounded-full font-extrabold tabular-nums ${sizes[size]} ${style}`}
    >
      <Trophy size={size === 'sm' ? 12 : 14} />
      #{rank}
    </span>
  )
}

/* ─── GuestBadge ─────────────────────────────────────────────────────────
   Marks non-regular players inside game participant lists. */
export function GuestBadge({ size = 'sm', label, isTest = false }) {
  const { t } = useTranslation()
  const resolvedLabel = label ?? t('ui.guest_badge_default_label')
  const sizes = {
    sm: 'text-[11px] px-2 py-0.5',
    md: 'text-sm px-3 py-1',
  }
  return (
    <span
      title={isTest ? t('ui.test_player_admin') : t('ui.guest_player')}
      className={`inline-flex items-center rounded-full font-mono font-extrabold tracking-wide uppercase
                  border border-dashed border-ink-200 bg-canvas text-muted ${sizes[size]}`}
    >
      {resolvedLabel}
    </span>
  )
}

/* ─── Avatar ─────────────────────────────────────────────────────────────
   Shows the person's photo when they have one, otherwise the existing
   colored-circle-with-initial. `size` carries width/height/text-size (and
   any extra utility classes a call site needs, e.g. a ring); `colorClass`
   is the fallback bg/text pair — each call site keeps its own current
   look for people with no photo yet.

   Escudo de assiduidade (XP): passa `xp` (e `lastPlayedAt`) e o avatar
   ganha o anel do nível + brilho se a pessoa jogou nos últimos 7 dias.
   Default null = sem escudo, todos os call sites existentes intactos.
   Call sites que já passam um ring próprio no `size` (PlayerAvatarRow)
   não devem passar `xp` — dois rings sobrepõem-se. */
export function Avatar({ name, url, size = 'w-10 h-10 text-sm', colorClass = 'bg-ink-700 text-white', provisional = false, shape = 'round' }) {
  // Nota: o aro de XP que aqui viveu foi removido a pedido do Ruben —
  // criava confusão com o ranking. O nível de XP mostra-se no painel do
  // perfil, no tab Assiduidade e nos troféus; no avatar só fica a pill
  // NOVO (provisório do ranking).
  const { t } = useTranslation()
  // shape='square' is for a club's logo: a physical club reads as a business,
  // a group as people, so the two never look alike at a glance (Trello #177).
  const radius = shape === 'square' ? 'rounded-xl' : 'rounded-full'
  const base = `${size} ${radius} flex items-center justify-center shrink-0 font-extrabold overflow-hidden`
  const core = url
    ? <img src={url} alt={name || ''} className={`${base} object-cover`} />
    : <div className={`${base} ${colorClass}`}>{(name || '?').charAt(0).toUpperCase()}</div>

  // Jogador provisório (<8 jogos de Elo): mini-pill "NOVO" sobre a borda
  // inferior — só quando pedido, para não mudar o layout dos ~40 call
  // sites existentes.
  if (!provisional) return core
  return (
    <span className="relative inline-flex shrink-0">
      {core}
      <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-1.5 py-px rounded-full bg-lime-400 text-ink-900 text-[8px] leading-tight font-mono font-extrabold tracking-wide uppercase whitespace-nowrap ring-1 ring-surface">
        {t('elo.provisional_short')}
      </span>
    </span>
  )
}

/* ─── OrgKindBadge ────────────────────────────────────────────────────────
   Clube vs Grupo, the same mark everywhere (Trello #177). A club is the
   physical venue (solid black, building icon, and a square logo via
   Avatar shape="square"); a group is a community of players (light outline,
   people icon, round logo). Plan level is a separate thing and does not
   change which one it is: a Community-plan group is still a group. */
export function OrgKindBadge({ kind, className = '' }) {
  const { t } = useTranslation()
  const isGroup = kind === 'group'
  const Icon = isGroup ? Users : Building2
  const look = isGroup ? 'bg-surface text-ink-700 border border-line' : 'bg-ink-900 text-white border border-ink-900'
  return (
    <span className={`inline-flex items-center gap-1 rounded-full pl-2 pr-[7px] py-0.5 text-[10px] leading-[11px] font-extrabold uppercase tracking-widest shrink-0 ${look} ${className}`}>
      <Icon size={11} strokeWidth={2.5} className="block shrink-0" aria-hidden="true" />
      {isGroup ? t('ui.org_kind_group') : t('ui.org_kind_club')}
    </span>
  )
}

export const orgAvatarShape = (kind) => (kind === 'group' ? 'round' : 'square')

/* ─── PlanBadge ───────────────────────────────────────────────────────────
   O plano do clube/grupo (organizations.plan_tier). Os nomes são nomes de
   produto e não se traduzem (fechados 15 set 2026); as chaves internas não
   mudam. Free fica discreto; os pagos no lime suave — nunca o lime cheio,
   que é a cor dos botões. Sem maiúsculas, para não se confundir com a
   etiqueta CLUBE/GRUPO ao lado. O plano não muda o tipo: um grupo pode
   subscrever o Club e continua a ser grupo. */
export { PLAN_TIERS, PLAN_NAMES, planName } from '../lib/plans'

export function PlanBadge({ tier, className = '' }) {
  const { t } = useTranslation()
  const isFree = !tier || tier === 'free'
  const look = isFree ? 'bg-canvas text-muted border border-line' : 'bg-lime-100 text-ink-900 border border-lime-400'
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] leading-none font-extrabold shrink-0 normal-case tracking-normal ${look} ${className}`}>
      {t('ui.plan_label', { name: planName(tier) })}
    </span>
  )
}

/* ─── AchievementCard ─────────────────────────────────────────────────────────
   Um troféu da estante: moldura e cores pela raridade (RARITY_META),
   ícone por key (achievementIcon), nome/descrição dos locales. Bloqueado =
   silhueta com cadeado e o critério visível (a descrição É o critério) —
   o "para onde subir". rarityPct = % de jogadores que o têm (PSN-style). */
export function AchievementCard({ achievementKey, category, rarity, earned = false, rarityPct = null }) {
  const { t } = useTranslation()
  const Icon = achievementIcon(achievementKey, category)
  const meta = RARITY_META[rarity] || RARITY_META.comum

  // GANHO grita, BLOQUEADO sussurra: o ganho tem medalhão preenchido da
  // cor da raridade, borda sólida e brilho nos tiers altos; o bloqueado é
  // tracejado, tudo cinza, com o cadeado dentro do medalhão — ninguém
  // confunde os dois numa grelha mista.
  if (!earned) {
    return (
      <div className="rounded-ctrl border border-dashed border-ink-200 bg-canvas p-3 text-center">
        <span className="inline-flex w-11 h-11 rounded-full bg-ink-50 items-center justify-center">
          <Lock size={16} className="text-ink-200" />
        </span>
        <p className="mt-1.5 text-[12px] font-extrabold text-muted leading-tight">{t(`achievements.${achievementKey}_name`)}</p>
        <p className="mt-0.5 text-[10px] text-ink-200 leading-tight">{t(`achievements.${achievementKey}_desc`)}</p>
        <div className="mt-1.5">
          <span className="px-1.5 py-px rounded-full text-[9px] font-mono font-extrabold uppercase tracking-wide bg-ink-50 text-muted">
            {t(meta.labelKey)}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className={`rounded-ctrl border-2 p-3 text-center bg-surface ${meta.frame} ${meta.glow}`}>
      <span className={`inline-flex w-11 h-11 rounded-full items-center justify-center ${meta.medal}`}>
        <Icon size={22} className={meta.icon} />
      </span>
      <p className="mt-1.5 text-[12px] font-extrabold text-ink-900 leading-tight">{t(`achievements.${achievementKey}_name`)}</p>
      <p className="mt-0.5 text-[10px] text-muted leading-tight">{t(`achievements.${achievementKey}_desc`)}</p>
      <div className="mt-1.5 flex items-center justify-center gap-1.5">
        <span className={`px-1.5 py-px rounded-full text-[9px] font-mono font-extrabold uppercase tracking-wide ${meta.pill}`}>
          {t(meta.labelKey)}
        </span>
        {rarityPct != null && (
          <span className="text-[9px] text-muted tabular-nums">{t('achievements.rarity_pct', { pct: rarityPct })}</span>
        )}
      </div>
    </div>
  )
}

/* ─── VoucherCard ─────────────────────────────────────────────────────────
   A voucher won for finishing a has_voucher mix as the winning team.
   Presentational only — gameDate/usedAtLabel arrive pre-formatted from the
   caller (Profile.jsx already has a formatMixDate-style helper for mix
   dates; reuse it, and the same formatting for usedAt), so this component
   needs i18n only for its own status/action labels.

   Visual grammar borrows two things already established elsewhere rather
   than inventing new ones: MixCard's left-edge accent bar for "this one
   needs you" (here: near-black, not lime — see below), and .card's own
   header/body divider convention (a plain `line` hairline, not a dashed
   one — dashed is reserved system-wide for empty/provisional/guest, and a
   won voucher is never that). One Ball Rule: lime is spent once per card,
   on the actual call to action — not repeated across a border, a bar and
   a pill, which would just be the same "this is actionable" fact said
   three times. */
export function VoucherCard({ prizeText, gameTitle, gameDate, organizationName, status, usedAtLabel, onMarkUsed, onShowQR }) {
  const { t } = useTranslation()
  const used = status === 'usado'
  return (
    <div
      className={`card relative overflow-hidden ${used ? 'shadow-none' : 'shadow-lift cursor-pointer'}`}
      onClick={!used ? onShowQR : undefined}
      role={!used ? 'button' : undefined}
      tabIndex={!used ? 0 : undefined}
    >
      <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${used ? 'bg-ink-100' : 'bg-ink-900'}`} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`flex items-center gap-1.5 text-[11px] font-mono font-extrabold uppercase tracking-wide truncate ${used ? 'text-ink-200' : 'text-muted'}`}>
            <Ticket size={12} className="shrink-0" />
            {organizationName}
          </p>
          <p className={`mt-1 text-base font-extrabold truncate ${used ? 'text-ink-200' : 'text-ink-900'}`}>{gameTitle}</p>
          <p className={`text-[11px] ${used ? 'text-ink-200' : 'text-muted'}`}>{gameDate}</p>
        </div>
        <span className={`shrink-0 px-2 py-1 rounded-full text-[9px] font-mono font-extrabold uppercase tracking-wide ${used ? 'bg-ink-50 text-ink-200' : 'bg-ink-900 text-canvas'}`}>
          {t(`profile.voucher_status_${status}`)}
        </span>
      </div>

      {prizeText && (
        <p className={`mt-3 pt-3 border-t border-line text-sm leading-snug ${used ? 'text-ink-200' : 'text-ink-900 font-semibold'}`}>
          {prizeText}
        </p>
      )}

      {!used ? (
        <PrimaryButton onClick={(e) => { e.stopPropagation(); onMarkUsed() }} className="mt-3 w-full">
          {t('profile.voucher_mark_used_action')}
        </PrimaryButton>
      ) : (
        <p className="mt-3 text-[10px] text-ink-200">{t('profile.voucher_used_at', { date: usedAtLabel })}</p>
      )}
    </div>
  )
}

/* ─── VoucherQRModal ─────────────────────────────────────────────────────
   Shown when a player taps a por_usar VoucherCard. Purely presentational
   beyond generating the QR image itself — the caller (Profile.jsx) passes
   a small { id, gameTitle, organizationName } object built from the row
   it already has, not something this modal re-fetches. Renders nothing
   without a voucher, matching PhotoViewerModal's own "always mounted,
   inert without its subject" convention. The QR encodes the bare voucher
   id string — no signed token, no wrapping URL (see the design spec's Key
   Decisions for why: this is a convenience carrier, not a security
   boundary — the real authorization check happens server-side in
   admin_redeem_voucher when an admin's scan reaches the redeem RPC). */
export function VoucherQRModal({ voucher, onClose }) {
  const { t } = useTranslation()
  const [qrDataUrl, setQrDataUrl] = useState(null)

  useEffect(() => {
    if (!voucher) return
    let cancelled = false
    setQrDataUrl(null)
    QRCode.toDataURL(voucher.id, { margin: 1, width: 256 })
      .then((url) => { if (!cancelled) setQrDataUrl(url) })
      .catch((err) => console.error('Error generating voucher QR code:', err))
    return () => { cancelled = true }
  }, [voucher])

  if (!voucher) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 animate-fade-in p-4" onClick={onClose}>
      <div className="card max-w-xs w-full text-center relative" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          aria-label={t('ui.close')}
          className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full text-muted hover:text-ink-900 hover:bg-ink-50 transition-colors duration-fast"
        >
          <X size={18} />
        </button>
        {qrDataUrl && <img src={qrDataUrl} alt="" className="mx-auto rounded-lg" width={256} height={256} />}
        <p className="mt-3 text-sm font-extrabold text-ink-900">{voucher.gameTitle}</p>
        <p className="text-[11px] text-muted">{voucher.organizationName}</p>
        <p className="mt-2 text-xs text-muted">{t('profile.voucher_qr_hint')}</p>
      </div>
    </div>,
    document.body
  )
}

/* ─── DangerConfirmModal ─────────────────────────────────────────────────
   Confirmation for an action that destroys data and can't be undone.
   The rest of the app confirms destructive actions with the browser's
   native confirm() — fine for "delete this mix", but on a phone it's a small
   grey system box that's easy to tap through. Deleting a whole group gets a
   window that names what's being lost (Trello #241, Francisco 15 set 2026).

   Tapping the backdrop does NOT confirm, and is ignored while `busy` so a
   slow request can't be abandoned half-way with the page in an odd state. */
export function DangerConfirmModal({ open, title, message, emphasis, confirmLabel, cancelLabel, busy = false, error = '', onConfirm, onClose }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  if (!open) return null
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 animate-fade-in p-4"
      onClick={() => { if (!busy) onClose() }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="danger-confirm-title"
        className="card bg-white max-w-xs w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <p id="danger-confirm-title" className="text-lg font-extrabold text-ink-900">{title}</p>
        <p className="mt-2 text-sm text-muted leading-relaxed">{message}</p>
        {emphasis && <p className="mt-2 text-sm font-extrabold text-ink-900">{emphasis}</p>}
        {error && <p className="mt-3 bg-danger/10 text-danger px-4 py-3 rounded-ctrl text-sm font-extrabold">{error}</p>}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="btn-secondary w-full disabled:opacity-40">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="w-full bg-danger text-white px-4 py-3 rounded-ctrl text-sm font-extrabold hover:opacity-90 transition-opacity duration-fast disabled:opacity-40"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

/* ─── PhotoViewerModal ───────────────────────────────────────────────────
   Full-screen tap-to-zoom viewer for a profile photo, Instagram-style —
   dark backdrop, image scaled to fit, tap anywhere or the X to close.
   Renders nothing without a url, so callers can mount it unconditionally. */
export function PhotoViewerModal({ url, alt = '', onClose }) {
  const { t } = useTranslation()
  if (!url) return null
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 animate-fade-in"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        aria-label={t('ui.close')}
        className="absolute top-4 right-4 w-11 h-11 flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors duration-fast"
      >
        <X size={22} />
      </button>
      <img
        src={url}
        alt={alt}
        className="max-w-full max-h-full object-contain animate-pop"
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body
  )
}

/* ─── FollowListModal ────────────────────────────────────────────────────
   Followers/following for any player — public, tappable from that
   player's hero card on both Profile.jsx (own profile) and
   PlayerDetails.jsx (anyone else's). Same portal-to-body pattern as
   PhotoViewerModal, for the same reason (escapes Layout.jsx header's
   backdrop-blur containing block for fixed descendants). */
export function FollowListModal({ userId, initialTab = 'followers', onClose }) {
  const { t } = useTranslation()
  const [tab, setTab] = useState(initialTab)
  const [followers, setFollowers] = useState(null)
  const [following, setFollowing] = useState(null)

  useEffect(() => {
    let cancelled = false
    setFollowers(null)
    setFollowing(null)
    Promise.all([listFollowers(userId), listFollowing(userId)])
      .then(([followersData, followingData]) => {
        if (cancelled) return
        setFollowers(followersData)
        setFollowing(followingData)
      })
      .catch((error) => {
        console.error('Error loading follow list:', error)
        if (!cancelled) {
          setFollowers([])
          setFollowing([])
        }
      })
    return () => { cancelled = true }
  }, [userId])

  const rows = tab === 'followers' ? followers : following
  const emptyText = tab === 'followers' ? t('followlist.empty_followers') : t('followlist.empty_following')

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink-900/70 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-t-card sm:rounded-card shadow-lift w-full sm:max-w-sm max-h-[75vh] flex flex-col animate-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-line shrink-0">
          <div className="flex gap-1 p-1 bg-ink-50 rounded-ctrl">
            <button
              onClick={() => setTab('followers')}
              className={`px-3.5 py-1.5 rounded-ctrl text-sm font-extrabold transition-colors duration-fast ${
                tab === 'followers' ? 'bg-canvas text-ink-900 shadow-lift' : 'text-muted'
              }`}
            >
              {t('followlist.tab_followers')}
            </button>
            <button
              onClick={() => setTab('following')}
              className={`px-3.5 py-1.5 rounded-ctrl text-sm font-extrabold transition-colors duration-fast ${
                tab === 'following' ? 'bg-canvas text-ink-900 shadow-lift' : 'text-muted'
              }`}
            >
              {t('followlist.tab_following')}
            </button>
          </div>
          <button
            onClick={onClose}
            aria-label={t('ui.close')}
            className="w-9 h-9 flex items-center justify-center rounded-full text-muted hover:bg-ink-50"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto">
          {rows === null ? (
            <div className="flex items-center justify-center py-10">
              <div className="animate-spin rounded-full h-8 w-8 border-[3px] border-ink-50 border-t-ink-700"></div>
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted text-center py-10">{emptyText}</p>
          ) : (
            <div className="divide-y divide-line">
              {rows.map((p) => (
                <Link
                  key={p.id}
                  to={`/jogador/${p.id}`}
                  onClick={onClose}
                  className="flex items-center gap-3 px-4 py-3 transition-colors duration-fast hover:bg-ink-50"
                >
                  <Avatar name={p.name} url={p.avatar_url} size="w-10 h-10 text-sm" />
                  <p className="flex-1 min-w-0 font-extrabold text-ink-900 text-sm truncate">{p.name}</p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
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

/* ─── ShareModal ─────────────────────────────────────────────────────────
   Share sheet used for mixes: editable caption + link, WhatsApp + native
   share (when the device supports it) + copy-link fallback. */
export function ShareModal({ title, message, url, onClose, imageCard }) {
  const { t } = useTranslation()
  const resolvedTitle = title ?? t('ui.share_default_title')
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
          await navigator.share({ files: [file], title: resolvedTitle, text: caption })
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
      setImageError(describeError(t, error, 'ui.image_generation_error'))
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
      await navigator.share({ title: resolvedTitle, text: caption, url })
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
            <h3 className="text-lg text-ink-900">{resolvedTitle}</h3>
          </div>
          <button
            onClick={onClose}
            aria-label={t('ui.close')}
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
                  {t('ui.image_saved_hint')}
                </p>
              )}

              <PrimaryButton onClick={handleShareImage} disabled={generatingImage} className="w-full">
                <ImageDown size={20} />
                {generatingImage ? t('ui.generating_image') : t('ui.share_image')}
              </PrimaryButton>
            </div>
          )}

          <div className="bg-canvas rounded-ctrl p-3.5 text-sm text-ink-900 whitespace-pre-line">
            {fullText}
          </div>

          {editingCaption ? (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-extrabold text-ink-900">{t('ui.caption_label')}</label>
                <div className="flex items-center gap-3">
                  {caption !== message && (
                    <button
                      onClick={() => setCaption(message)}
                      className="text-ink-700 text-xs font-extrabold"
                    >
                      {t('ui.reset')}
                    </button>
                  )}
                  <button
                    onClick={() => setEditingCaption(false)}
                    className="text-ink-700 text-xs font-extrabold"
                  >
                    {t('ui.done')}
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
                <span className="font-extrabold text-ink-900">{t('ui.caption_prefix')}</span>
                {caption}
              </p>
              <button
                onClick={() => setEditingCaption(true)}
                className="text-ink-700 text-xs font-extrabold shrink-0"
              >
                {t('ui.edit')}
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
            <span className="text-ink-700 shrink-0">{copied ? t('ui.copied') : t('ui.copy')}</span>
          </button>

          <PrimaryButton variant="whatsapp" onClick={handleWhatsApp} className="w-full">
            <MessageCircle size={20} />
            {t('ui.share_via_whatsapp')}
          </PrimaryButton>

          {typeof navigator !== 'undefined' && navigator.share && (
            <PrimaryButton variant="ghost" onClick={handleNativeShare} className="w-full">
              <Share2 size={20} />
              {t('ui.more_options')}
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
  const { t } = useTranslation()
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
            aria-label={t('ui.decrease_5_minutes')}
            className="w-6 h-6 flex items-center justify-center rounded-full bg-ink-50 text-ink-700 text-xs font-extrabold hover:bg-ink-200 transition-colors duration-fast"
          >
            −5
          </button>
          <button
            type="button"
            onClick={() => onAdjust(5)}
            aria-label={t('ui.increase_5_minutes')}
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
export function Select({ value, onChange, options, placeholder, className = '' }) {
  const { t } = useTranslation()
  const resolvedPlaceholder = placeholder ?? t('ui.select_placeholder')
  const [open, setOpen] = useState(false)
  const selected = options.find((o) => o.value === value)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`input-field flex items-center justify-between text-left ${selected ? 'text-ink-900' : 'text-muted'} ${className}`}
      >
        <span className="truncate">{selected ? selected.label : resolvedPlaceholder}</span>
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
              <h3 className="text-lg text-ink-900">{resolvedPlaceholder}</h3>
              <button
                onClick={() => setOpen(false)}
                aria-label={t('ui.close')}
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
