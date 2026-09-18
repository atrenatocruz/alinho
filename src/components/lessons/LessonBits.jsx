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
