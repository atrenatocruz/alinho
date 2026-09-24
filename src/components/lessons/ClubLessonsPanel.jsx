// Gerir → clube → «Aulas» (Trello #49, Fase 1a). Professores (ordem na
// página do clube) e Preços (tabela ponta / fora de ponta + horas de ponta,
// print 08, 1.º telemóvel) e Turmas (Fase 1b). Pedidos entram na Fase 3.
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, GraduationCap } from 'lucide-react'
import { Avatar, EmptyState, PrimaryButton } from '../ui'
import {
  listClubTeachers, getClubLessonSettings, saveClubLessonPrices, saveClubPeakHours, saveTeacherOrder,
} from '../../lib/lessonsApi'
import { priceRowFor, LESSON_CAPACITY, LESSON_DURATIONS } from '../../lib/lessons'
import { describeError } from '../../lib/errors'
import { MonoLabel, levelsText, euros } from './LessonBits'
import ClubSeriesPanel from './ClubSeriesPanel'

const pad = (n) => String(n).padStart(2, '0')
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const ROWS = Object.keys(LESSON_CAPACITY).flatMap((type) => LESSON_DURATIONS.map((duration) => ({ type, duration })))
const keyOf = (type, duration, peak) => `${type}-${duration}-${peak ? 'p' : 'o'}`
const timeCls = 'min-w-0 flex-1 rounded-lg border border-line bg-canvas px-2 py-2 text-sm tabular-nums text-ink-900 focus:outline-none focus:ring-2 focus:ring-lime-400'
const num = (v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.')))

export default function ClubLessonsPanel({ organizationId, orgName }) {
  const { t } = useTranslation()
  const [section, setSection] = useState('teachers')
  const [teachers, setTeachers] = useState([])
  const [loading, setLoading] = useState(true)
  const [settings, setSettings] = useState({ prices: [], peakHours: [] })

  useEffect(() => {
    let alive = true
    getClubLessonSettings(organizationId)
      .then((res) => { if (alive) setSettings(res) })
      .catch((error) => console.error('Error loading lesson settings:', error))
    listClubTeachers(organizationId)
      .then((rows) => { if (alive) setTeachers(rows) })
      .catch((error) => console.error('Error loading club teachers:', error))
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [organizationId])

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5 flex-wrap">
        {[
          ['teachers', t('lessons.gerir_tab_teachers', { count: teachers.length })],
          ['series', t('lessons.gerir_tab_series')],
        ].map(([key, label]) => (
          <button key={key} type="button" onClick={() => setSection(key)}
            className={`min-h-[40px] px-3.5 rounded-full border text-sm font-extrabold transition-colors duration-fast ${
              section === key ? 'bg-ink-900 text-white border-ink-900' : 'bg-canvas text-ink-700 border-line hover:bg-ink-50'
            }`}>
            {label}
          </button>
        ))}
      </div>
      {section === 'teachers' && <TeachersOrder organizationId={organizationId} teachers={teachers} setTeachers={setTeachers} loading={loading} />}
      {section === 'series' && <ClubSeriesPanel organizationId={organizationId} teachers={teachers} prices={settings.prices} peakHours={settings.peakHours} />}
    </div>
  )
}

function TeachersOrder({ organizationId, teachers, setTeachers, loading }) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)

  const move = async (index, delta) => {
    const next = [...teachers]
    const [row] = next.splice(index, 1)
    next.splice(index + delta, 0, row)
    const before = teachers
    setTeachers(next)
    setSaving(true)
    try {
      await saveTeacherOrder(organizationId, next.map((x) => x.teacher_profile_id))
    } catch (error) {
      setTeachers(before)
      alert(describeError(t, error, 'lessons.error_save_order'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return null
  if (teachers.length === 0) {
    return <EmptyState icon={GraduationCap} title={t('lessons.gerir_no_teachers_title')} subtitle={t('lessons.gerir_no_teachers_subtitle')} />
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">{t('lessons.gerir_order_hint')}</p>
      <div className="card p-0 divide-y divide-line">
        {teachers.map((teacher, i) => {
          const levels = levelsText(t, teacher.level_from, teacher.level_to)
          return (
            <div key={teacher.teacher_profile_id} className="flex items-center gap-3 px-3.5 py-3">
              <span className="w-5 text-center font-mono text-xs font-bold text-ink-500">{i + 1}</span>
              <Avatar name={teacher.name} url={teacher.avatar_url} size="w-9 h-9 text-xs" colorClass="bg-ink-50 text-ink-500" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-ink-900 truncate">{teacher.name}</p>
                <p className="text-xs text-muted truncate">
                  {[levels, teacher.from_price != null && t('lessons.from_price', { price: euros(teacher.from_price) })]
                    .filter(Boolean).join(' · ')}
                </p>
              </div>
              <div className="flex gap-1 shrink-0">
                <button type="button" disabled={saving || i === 0} onClick={() => move(i, -1)} aria-label={t('lessons.move_up')}
                  className="w-9 h-9 rounded-full border border-line flex items-center justify-center text-ink-700 hover:bg-ink-50 disabled:opacity-30">
                  <ArrowUp size={15} />
                </button>
                <button type="button" disabled={saving || i === teachers.length - 1} onClick={() => move(i, 1)} aria-label={t('lessons.move_down')}
                  className="w-9 h-9 rounded-full border border-line flex items-center justify-center text-ink-700 hover:bg-ink-50 disabled:opacity-30">
                  <ArrowDown size={15} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Usado tambem no separador «Clube» do Gerir, que e onde os precos vivem
// desde 24 set: sao configuracao do clube, nao um evento.
export function Prices({ organizationId, orgName }) {
  const { t } = useTranslation()
  const [view, setView] = useState('peak') // peak | off | hours
  const [loaded, setLoaded] = useState(null)
  const [draft, setDraft] = useState({})
  const [hours, setHours] = useState({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    let alive = true
    getClubLessonSettings(organizationId)
      .then((res) => {
        if (!alive) return
        const on = todayIso()
        const d = {}
        for (const peak of [true, false]) {
          for (const { type, duration } of [...ROWS, { type: 'trial', duration: 60 }]) {
            const row = priceRowFor(res.prices, { lessonType: type, durationMinutes: duration, peak, onIso: on })
            d[keyOf(type, duration, peak)] = { month: row?.price_month ?? '', lesson: row?.price_lesson ?? '' }
          }
        }
        const h = {}
        for (let wd = 1; wd <= 7; wd++) {
          const r = res.peakHours.find((x) => Number(x.day_of_week) === wd)
          h[wd] = { start: r?.start_time?.slice(0, 5) || '', end: r?.end_time?.slice(0, 5) || '' }
        }
        setDraft(d)
        setHours(h)
        setLoaded(res)
      })
      .catch((error) => console.error('Error loading lesson prices:', error))
    return () => { alive = false }
  }, [organizationId])

  const lastChange = useMemo(() => {
    const dates = (loaded?.prices || []).map((p) => p.valid_from).filter(Boolean).sort()
    return dates.length ? dates[dates.length - 1] : null
  }, [loaded])

  if (!loaded) return null
  const peak = view === 'peak'

  const setCell = (k, field, value) => {
    setMessage(null)
    setDraft((d) => ({ ...d, [k]: { ...d[k], [field]: value.replace(/[^\d.,]/g, '') } }))
  }

  const savePrices = async () => {
    const rows = []
    for (const [k, v] of Object.entries(draft)) {
      const [type, duration, p] = k.split('-')
      const month = type === 'trial' ? null : num(v.month)
      const lesson = num(v.lesson)
      if (month == null && lesson == null) continue
      rows.push({ lesson_type: type, duration_minutes: Number(duration), peak: p === 'p', price_month: month, price_lesson: lesson })
    }
    setSaving(true)
    setMessage(null)
    try {
      await saveClubLessonPrices(organizationId, rows)
      setMessage({ ok: true, text: t('lessons.prices_saved') })
    } catch (error) {
      setMessage({ ok: false, text: describeError(t, error, 'lessons.error_save_prices') })
    } finally {
      setSaving(false)
    }
  }

  const saveHours = async () => {
    const ranges = Object.entries(hours)
      .filter(([, v]) => v.start && v.end)
      .map(([wd, v]) => ({ day_of_week: Number(wd), start_time: v.start, end_time: v.end }))
    if (ranges.some((r) => r.end_time <= r.start_time)) {
      setMessage({ ok: false, text: t('lessons.error_peak_order') })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      await saveClubPeakHours(organizationId, ranges)
      setMessage({ ok: true, text: t('lessons.peak_saved') })
    } catch (error) {
      setMessage({ ok: false, text: describeError(t, error, 'lessons.error_save_prices') })
    } finally {
      setSaving(false)
    }
  }

  const cell = (k, field) => (
    <input
      inputMode="decimal"
      value={draft[k]?.[field] ?? ''}
      onChange={(e) => setCell(k, field, e.target.value)}
      placeholder="—"
      aria-label={field}
      className="w-[72px] rounded-lg border border-line bg-canvas px-2 py-1.5 text-right text-sm tabular-nums text-ink-900 placeholder:text-ink-200 focus:outline-none focus:ring-2 focus:ring-lime-400"
    />
  )

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{t('lessons.prices_agreed', { name: orgName })}</p>

      <div className="grid grid-cols-3 rounded-xl bg-ink-50 p-[3px] text-xs font-semibold text-center">
        {[['peak', t('lessons.peak')], ['off', t('lessons.off_peak')], ['hours', t('lessons.peak_hours_tab')]].map(([key, label]) => (
          <button key={key} type="button" onClick={() => { setView(key); setMessage(null) }}
            className={`py-2 rounded-[9px] transition-colors duration-fast ${view === key ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500'}`}>
            {label}
          </button>
        ))}
      </div>

      {view === 'hours' ? (
        <div className="card space-y-2">
          <MonoLabel>{t('lessons.peak_hours_title')}</MonoLabel>
          {[1, 2, 3, 4, 5, 6, 7].map((wd) => (
            <div key={wd} className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-sm font-semibold text-ink-900">{t(`lessons.wd_long_${wd}`)}</span>
              <input type="time" value={hours[wd]?.start || ''} aria-label={t('lessons.peak_start')} className={timeCls}
                onChange={(e) => setHours((h) => ({ ...h, [wd]: { ...h[wd], start: e.target.value } }))} />
              <span className="text-muted">–</span>
              <input type="time" value={hours[wd]?.end || ''} aria-label={t('lessons.peak_end')} className={timeCls}
                onChange={(e) => setHours((h) => ({ ...h, [wd]: { ...h[wd], end: e.target.value } }))} />
            </div>
          ))}
          <p className="text-xs text-muted pt-1">{t('lessons.peak_hours_hint')}</p>
        </div>
      ) : (
        <div className="card p-3">
          <table className="w-full text-sm tabular-nums border-collapse">
            <thead>
              <tr>
                <th />
                <th />
                <th className="font-mono text-[10.5px] text-ink-500 text-right font-bold pb-1">{t('lessons.col_month')}</th>
                <th className="font-mono text-[10.5px] text-ink-500 text-right font-bold pb-1">{t('lessons.col_lesson')}</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map(({ type, duration }, i) => {
                const k = keyOf(type, duration, peak)
                const firstOfType = i % LESSON_DURATIONS.length === 0
                return (
                  <tr key={k} className={firstOfType ? 'border-t border-line' : ''}>
                    <td className="py-1 font-semibold text-ink-900">{firstOfType ? t(`lessons.price_row_${type}`) : ''}</td>
                    <td className="py-1 pr-1 text-ink-500">{t(`lessons.duration_${duration}`)}</td>
                    <td className="py-1 text-right">{cell(k, 'month')}</td>
                    <td className="py-1 pl-1.5 text-right">{cell(k, 'lesson')}</td>
                  </tr>
                )
              })}
              <tr className="border-t border-line">
                <td className="py-1 font-semibold text-ink-900" colSpan={2}>{t('lessons.trial')}</td>
                <td className="py-1 text-right text-ink-500">—</td>
                <td className="py-1 pl-1.5 text-right">{cell(keyOf('trial', 60, peak), 'lesson')}</td>
              </tr>
            </tbody>
          </table>
          <p className="text-xs text-muted mt-2">{t('lessons.prices_table_hint')}</p>
        </div>
      )}

      {message && <p className={`text-sm font-semibold ${message.ok ? 'text-ok' : 'text-danger'}`}>{message.text}</p>}
      <PrimaryButton className="w-full" disabled={saving} onClick={view === 'hours' ? saveHours : savePrices}>
        {t('lessons.save')}
      </PrimaryButton>
      {lastChange && (
        <p className="text-xs text-muted">
          {t('lessons.prices_last_change', { date: `${t(`lessons.month_short_${Number(lastChange.slice(5, 7))}`)} ${lastChange.slice(0, 4)}` })}
        </p>
      )}
    </div>
  )
}
