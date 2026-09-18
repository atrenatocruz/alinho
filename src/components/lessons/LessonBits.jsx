// Peças pequenas partilhadas pelos ecrãs das aulas (Trello #49). Cores do
// desenho aprovado (design-handoff/2026-09-18-aulas-com-treinadores, SPEC §9):
// aula = turquesa — fundo #CCFBF1, contorno #8FE3D6, texto #0F766E.
import { ratingBand } from '../../lib/elo'

export const TEAL = { bg: '#CCFBF1', border: '#8FE3D6', text: '#0F766E' }

/** "M5", "F2", "INI" — pastilha preta em mono, como nos wireframes. */
export function LevelPill({ label, className = '' }) {
  if (!label) return null
  return (
    <span className={`inline-flex items-center whitespace-nowrap font-mono text-[10px] font-bold bg-ink-900 text-white rounded-md px-1.5 py-0.5 leading-none ${className}`}>
      {label}
    </span>
  )
}

export const bandLabel = (rating, gender) => ratingBand(rating, gender)?.label || null

/** Etiqueta branca com texto turquesa ("Turma a 4", "Quintas", "Livre"). */
export function TealTag({ icon: Icon, children }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-white px-2 py-[3px] text-[11px] font-semibold" style={{ color: TEAL.text }}>
      {Icon && <Icon size={12} strokeWidth={2.2} />}
      {children}
    </span>
  )
}

/** Rótulo em mono maiúsculo ("PREÇOS · POR PESSOA", "QUINTA, 17 SET"). */
export function MonoLabel({ children, className = '' }) {
  return <p className={`font-mono text-[10.5px] font-bold uppercase tracking-[0.06em] text-ink-500 ${className}`}>{children}</p>
}

const pad = (n) => String(n).padStart(2, '0')
/** 9:00 / 18:30 — como nos wireframes (hora sem zero à esquerda). */
export const hm = (iso) => {
  const d = new Date(iso)
  return `${d.getHours()}:${pad(d.getMinutes())}`
}
/** 18:00 — hora com dois dígitos (hora grande dos cartões). */
export const hhmm = (iso) => {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
export const isoWeekday = (d) => ((d.getDay() + 6) % 7) + 1
export const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** Nível de uma banda (1..6, 7 = Iniciante) em texto curto. */
const levelNum = (t, n) => (n === 7 ? t('lessons.level_beginner') : String(n))

/** Texto dos níveis de um professor: "Níveis 6 a 3" · "Iniciação" · null. */
export function levelsText(t, from, to) {
  if (from === 7 && to === 7) return t('lessons.level_beginners_only')
  const range = levelRange(t, from, to)
  return range ? t('lessons.levels_label', { range }) : null
}

/** "6 a 3" · "Iniciação" · null (sem nível). */
export function levelRange(t, from, to) {
  if (from == null && to == null) return null
  if (from === 7 && to === 7) return t('lessons.level_beginners_only')
  if (from === to || to == null) return levelNum(t, from)
  return t('lessons.level_range', { from: levelNum(t, from), to: levelNum(t, to) })
}

/** Etiqueta do tipo: "Aula privada", "Aula a 2"… / "Turma a 4". */
export const lessonTypeLabel = (t, type, { series = false } = {}) =>
  t(`lessons.${series ? 'series' : 'lesson'}_type_${type}`)

export const euros = (v) => (v == null ? null : `${Number(v) % 1 === 0 ? Number(v) : Number(v).toFixed(2)} €`)

/** Chips de escolha única (os "chips" pretos dos wireframes). */
export function ChipGroup({ options, value, onChange, className = '' }) {
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={`min-h-[36px] px-3 rounded-full border text-[13px] font-semibold transition-colors duration-fast disabled:opacity-40 ${
            value === o.value ? 'bg-ink-900 text-white border-ink-900' : 'bg-canvas text-ink-700 border-line hover:bg-ink-50'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Interruptor preto com bola lima (como nos wireframes). */
export function Toggle({ label, checked, onChange, disabled = false }) {
  return (
    <label className={`flex items-center justify-between gap-3 py-2.5 border-b border-line text-sm text-ink-900 ${disabled ? 'opacity-40' : 'cursor-pointer'}`}>
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative w-10 h-6 rounded-full shrink-0 transition-colors duration-fast ${checked ? 'bg-ink-900' : 'bg-ink-200'}`}
      >
        <span className={`absolute top-1 w-4 h-4 rounded-full transition-all duration-fast ${checked ? 'right-1 bg-lime-400' : 'left-1 bg-white'}`} />
      </button>
    </label>
  )
}

/** Dia da semana + hora ("Terças 19:00–20:30"). */
export const seriesWhen = (t, s) => {
  const [h, m] = s.start_time.split(':').map(Number)
  const endMin = h * 60 + m + s.duration_minutes
  const end = `${pad(Math.floor(endMin / 60) % 24)}:${pad(endMin % 60)}`
  return { day: t(`lessons.wd_plural_${s.weekday}`), start: `${pad(h)}:${pad(m)}`, end }
}
