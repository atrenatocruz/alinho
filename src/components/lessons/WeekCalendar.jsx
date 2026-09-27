// O horário do professor numa semana pequena (Francisco, 27 set: «Fica o
// calendário»). Desenho: design-handoff/2026-09-27-horario-em-semana. Um só
// componente para o cartão «Professor» do Perfil e para a página pública.
// Só para ver: tocar não faz nada. As colunas são brancas porque os cartões
// da app são cinzentos (no desenho o cartão era branco e as colunas cinzentas).
import { useTranslation } from 'react-i18next'
import { mergeSlots } from '../../lib/teacherSchedule'

const HOUR_PX = 18
// Uma cor por clube: a das aulas e, no 2.º, lilás (SPEC ponto 5).
const COLORS = [
  { bg: '#99E2D6', border: '#5CC7B6' },
  { bg: '#E9E7FB', border: '#B7AEF0' },
]
const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
// «18:00» → «18»; «18:30» → «18:30»
const label = (hhmm) => { const [h, m] = hhmm.split(':'); return m === '00' ? String(Number(h)) : `${Number(h)}:${m}` }

/**
 * slots: [{ weekday 1..7, start 'HH:MM', end 'HH:MM', club }] — `club` é o
 * índice do clube (0, 1…); clubs: nomes para a legenda (só com mais de um).
 */
export default function WeekCalendar({ slots = [], clubs = [] }) {
  const { t } = useTranslation()
  if (slots.length === 0) return null

  // Blocos seguidos juntam-se, por dia e por clube.
  const blocks = []
  for (let wd = 1; wd <= 7; wd++) {
    const clubIds = [...new Set(slots.filter((s) => s.weekday === wd).map((s) => s.club || 0))]
    for (const club of clubIds) {
      for (const m of mergeSlots(slots.filter((s) => s.weekday === wd && (s.club || 0) === club))) {
        blocks.push({ weekday: wd, club, ...m })
      }
    }
  }

  // Só as horas que interessam: da hora cheia antes do primeiro bloco à
  // hora cheia depois do último.
  const fromH = Math.floor(Math.min(...blocks.map((b) => toMin(b.start))) / 60)
  const toH = Math.ceil(Math.max(...blocks.map((b) => toMin(b.end))) / 60)
  const span = toH - fromH
  const step = span <= 8 ? 2 : 3
  const marks = []
  for (let h = fromH; h < toH; h += step) marks.push(h)
  // A última hora fica sempre; a penúltima sai se colar a ela (designer, 27 set).
  if (marks[marks.length - 1] !== toH) {
    if (marks.length > 1 && toH - marks[marks.length - 1] < step) marks.pop()
    marks.push(toH)
  }
  const height = span * HOUR_PX
  const days = new Set(blocks.map((b) => b.weekday))

  return (
    <div>
      <div className="grid grid-cols-[28px_repeat(7,minmax(0,1fr))] gap-x-1">
        <span />
        {[1, 2, 3, 4, 5, 6, 7].map((wd) => (
          <span key={wd} className={`text-center text-xs font-extrabold capitalize ${days.has(wd) ? 'text-ink-900' : 'text-ink-200'}`}>
            {t(`lessons.wd_short_${wd}`)}
          </span>
        ))}
        <div className="relative mt-1" style={{ height }}>
          {marks.map((h) => (
            <span key={h} className="absolute right-1 -translate-y-1/2 text-[10px] tabular-nums text-muted" style={{ top: (h - fromH) * HOUR_PX }}>
              {h}h
            </span>
          ))}
        </div>
        {[1, 2, 3, 4, 5, 6, 7].map((wd) => (
          <div key={wd} className="relative mt-1 overflow-hidden rounded-[6px] bg-white" style={{ height }}>
            {marks.slice(1, -1).map((h) => (
              <span key={h} className="absolute inset-x-0 border-t border-dashed border-ink-200/60" style={{ top: (h - fromH) * HOUR_PX }} />
            ))}
            {blocks.filter((b) => b.weekday === wd).map((b) => {
              const top = ((toMin(b.start) - fromH * 60) / 60) * HOUR_PX
              const h = ((toMin(b.end) - toMin(b.start)) / 60) * HOUR_PX
              const c = COLORS[b.club] || COLORS[0]
              return (
                <div key={`${b.club}-${b.start}`} className="absolute inset-x-0.5 flex flex-col justify-between rounded-[5px] border px-0.5 py-px text-center text-[9px] font-extrabold leading-tight tabular-nums text-ink-900"
                  style={{ top, height: h, background: c.bg, borderColor: c.border }}>
                  <span>{label(b.start)}</span>
                  {toMin(b.end) - toMin(b.start) > 60 && <span>{label(b.end)}</span>}
                </div>
              )
            })}
          </div>
        ))}
      </div>
      {clubs.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 pl-8 text-xs text-ink-700">
          {clubs.map((name, i) => (
            <span key={name} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm border" style={{ background: (COLORS[i] || COLORS[0]).bg, borderColor: (COLORS[i] || COLORS[0]).border }} />
              {name}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
