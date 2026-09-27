// O calendário do professor em semanas a sério (esta e a próxima), com o que
// está livre, ocupado e já passou (Francisco, 27 set; SPEC-calendario-2.md,
// assunto 1; desenho semanas-a-serio.png). Mesma cor e mesmos blocos do
// calendário da semana-tipo (WeekCalendar).
//   mode 'public'  — quem marca: livre / ocupado (sem dizer porquê) / já passou;
//                    tocar num bloco livre chama onPickFree(tp, dia, hora).
//   mode 'teacher' — o próprio: livre / aula marcada / pedido / já passou;
//                    tocar num dia chama onPickDay(dia, segmentos).
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { daySegments, isoDate, pickTime, weekDays, weekHourRange } from '../../lib/teacherWeek'

const HOUR_PX = 18
const FREE = { background: '#99E2D6', borderColor: '#5CC7B6' }
// Fechado pelo professor: às riscas (SPEC-calendario-2, assunto 2).
const CLOSED = { background: 'repeating-linear-gradient(135deg, #F3F4F6 0 4px, #D1D5DB 4px 6px)', borderColor: '#D1D5DB' }
const label = (m) => { const h = Math.floor(m / 60); const mm = m % 60; return mm ? `${h}:${String(mm).padStart(2, '0')}` : String(h) }

export default function RealWeekCalendar({ booking, mode = 'public', now = new Date(), onPickFree = null, onPickDay = null }) {
  const { t } = useTranslation()
  // Abre nesta semana; se já não há nada por passar nela (ao domingo à
  // noite, por exemplo), abre na próxima.
  const [offset, setOffset] = useState(() => (weekDays(now, 0)
    .some((d) => daySegments(d, booking?.profiles || [], booking?.busy || [], now).some((s) => !s.past)) ? 0 : 1))
  const days = useMemo(() => weekDays(now, offset), [now, offset])
  const profiles = booking?.profiles || []
  const segs = useMemo(() => days.map((d) => daySegments(d, profiles, booking?.busy || [], now)), [days, profiles, booking, now])
  // As horas: as mesmas nas duas semanas, para o calendário não saltar.
  const range = useMemo(() => weekHourRange([0, 1].flatMap((o) => weekDays(now, o).map((d) => daySegments(d, profiles, booking?.busy || [], now)))),
    [now, profiles, booking])
  if (!range) return null

  const span = range.to - range.from
  const step = span <= 8 ? 2 : 3
  const marks = []
  for (let h = range.from; h < range.to; h += step) marks.push(h)
  if (marks[marks.length - 1] !== range.to) {
    if (marks.length > 1 && range.to - marks[marks.length - 1] < step) marks.pop()
    marks.push(range.to)
  }
  const height = span * HOUR_PX
  const today = isoDate(now)
  const month = (d) => t(`lessons.month_short_${d.getMonth() + 1}`)
  const title = `${t(offset === 0 ? 'calendar.this_week' : 'calendar.next_week')} · ${days[0].getDate()} ${days[0].getMonth() === days[6].getMonth() ? '' : `${month(days[0])} `}– ${days[6].getDate()} ${month(days[6])}`.replace('  ', ' ')

  const look = (s) => {
    if (s.kind === 'free') return { style: FREE, cls: 'text-ink-900' }
    if (mode === 'public') return { style: { background: '#D1D5DB', borderColor: '#9CA3AF' }, cls: 'text-transparent' }
    if (s.kind === 'closed') return { style: CLOSED, cls: 'text-ink-500' }
    if (s.kind === 'lesson') return { style: { background: '#0F766E', borderColor: '#0F766E' }, cls: 'text-white' }
    return { style: { background: '#CCF3EC', borderColor: '#5CC7B6', borderStyle: 'dashed' }, cls: 'text-[#0F766E]' }
  }
  const tag = (s) => (mode !== 'teacher' ? null : s.kind === 'lesson' ? t('calendar.lesson_short') : s.kind === 'request' ? t('calendar.request_short') : s.kind === 'closed' ? t('calendar.closed') : null)

  const onBlock = (e, day, s) => {
    if (mode !== 'public' || s.kind !== 'free' || s.past || !onPickFree) return
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const minute = s.start + ((e.clientY - rect.top) / HOUR_PX) * 60
    onPickFree(s.tp, isoDate(day), pickTime(s, minute))
  }

  const legend = mode === 'public'
    ? [['free', t('calendar.free')], ['busy', t('calendar.busy')], ['past', t('calendar.past')]]
    : [['free', t('calendar.free')], ['lesson', t('calendar.lesson')], ['request', t('calendar.request')], ['closed', t('calendar.closed')], ['past', t('calendar.past')]]
  const swatch = {
    free: FREE, busy: { background: '#D1D5DB', borderColor: '#9CA3AF' }, lesson: { background: '#0F766E', borderColor: '#0F766E' },
    request: { background: '#CCF3EC', borderColor: '#5CC7B6', borderStyle: 'dashed' }, closed: CLOSED, past: { background: '#fff', borderColor: '#E5E7EB' },
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <button type="button" disabled={offset === 0} onClick={() => setOffset(0)} aria-label={t('calendar.this_week')}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-ink-900 disabled:opacity-30"><ChevronLeft size={18} /></button>
        <p className="text-sm font-extrabold text-ink-900">{title}</p>
        <button type="button" disabled={offset === 1} onClick={() => setOffset(1)} aria-label={t('calendar.next_week')}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-ink-900 disabled:opacity-30"><ChevronRight size={18} /></button>
      </div>
      <div className="grid grid-cols-[28px_repeat(7,minmax(0,1fr))] gap-x-1">
        <span />
        {days.map((d, i) => {
          const isToday = isoDate(d) === today
          const has = segs[i].length > 0
          return (
            <span key={i} className="flex flex-col items-center leading-tight">
              <span className={`rounded-full px-1.5 text-xs font-extrabold capitalize ${isToday ? 'bg-ink-900 text-white' : has ? 'text-ink-900' : 'text-ink-200'}`}>
                {t(`lessons.wd_short_${i + 1}`)}
              </span>
              <span className={`text-[10px] tabular-nums ${has ? 'text-ink-500' : 'text-ink-200'}`}>{d.getDate()}</span>
            </span>
          )
        })}
        <div className="relative mt-1" style={{ height }}>
          {marks.map((h) => (
            <span key={h} className="absolute right-1 -translate-y-1/2 text-[10px] tabular-nums text-muted" style={{ top: (h - range.from) * HOUR_PX }}>{h}h</span>
          ))}
        </div>
        {days.map((d, i) => {
          const Col = mode === 'teacher' && onPickDay && segs[i].length > 0 ? 'button' : 'div'
          return (
            <Col key={i} type={Col === 'button' ? 'button' : undefined} onClick={Col === 'button' ? () => onPickDay(d, segs[i]) : undefined}
              aria-label={Col === 'button' ? `${t(`lessons.wd_long_${i + 1}`)} ${d.getDate()}` : undefined}
              className="relative mt-1 block w-full overflow-hidden rounded-[6px] bg-white text-left" style={{ height }}>
              {marks.slice(1, -1).map((h) => (
                <span key={h} className="absolute inset-x-0 border-t border-dashed border-ink-200/60" style={{ top: (h - range.from) * HOUR_PX }} />
              ))}
              {segs[i].map((s) => {
                const lk = look(s)
                const clickable = mode === 'public' && s.kind === 'free' && !s.past && onPickFree
                const B = clickable ? 'button' : 'span'
                return (
                  <B key={`${s.kind}-${s.start}-${s.past}`} type={clickable ? 'button' : undefined}
                    onClick={clickable ? (e) => onBlock(e, d, s) : undefined}
                    aria-label={clickable ? t('calendar.pick_aria', { from: label(s.start), to: label(s.end) }) : undefined}
                    className={`absolute inset-x-0.5 flex flex-col justify-between overflow-hidden rounded-[5px] border px-0.5 py-px text-center text-[9px] font-extrabold leading-tight tabular-nums ${lk.cls} ${s.past ? 'opacity-35' : ''}`}
                    style={{ ...lk.style, top: ((s.start - range.from * 60) / 60) * HOUR_PX, height: ((s.end - s.start) / 60) * HOUR_PX }}>
                    {mode === 'public' && s.kind !== 'free' ? null : (
                      <>
                        <span>{tag(s) || label(s.start)}</span>
                        {s.end - s.start > 60 && s.kind !== 'closed' && <span>{tag(s) ? label(s.start) : label(s.end)}</span>}
                      </>
                    )}
                  </B>
                )
              })}
            </Col>
          )
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 pl-8 text-xs text-ink-700">
        {legend.map(([k, text]) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm border" style={swatch[k]} />{text}
          </span>
        ))}
      </div>
      {mode === 'public' && onPickFree && <p className="mt-1.5 pl-8 text-xs text-muted">{t('calendar.tap_free')}</p>}
    </div>
  )
}
