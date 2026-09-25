// Aulas com professores (Trello #49) — duas vistas do mesmo professor:
//  · view="profile"      /professor/:id              perfil público (print 06, 1.º)
//  · view="availability" /professor/:id/disponibilidade  dia a dia (print 05, 2.º)
// "Pedir para entrar" e "Pedir aula" ligam-se nas fases seguintes (1b e 3).
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Check, ChevronLeft, Clock, GraduationCap, Phone, Repeat } from 'lucide-react'
import { useGoBack } from '../lib/useGoBack'
import { useAuth } from '../contexts/AuthContext'
import { cancelEnrolment, confirmEnrolment, getTeacherPage } from '../lib/lessonsApi'
import EnrolSheet from '../components/lessons/EnrolSheet'
import { describeError, errorKind } from '../lib/errors'
import { priceRowFor, LESSON_CAPACITY, LESSON_DURATIONS } from '../lib/lessons'
import { weeklyFromItems } from '../lib/teacherSchedule'
import { Avatar, EmptyState, PrimaryButton } from '../components/ui'
import {
  LevelPill, MonoLabel, TealTag, TEAL, bandLabel, levelRange, hm, hhmm, isoWeekday, sameDay, euros, lessonTypeLabel,
} from '../components/lessons/LessonBits'

const pad = (n) => String(n).padStart(2, '0')
const localIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const minutesBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 60000)
const waLink = (contact) => {
  const digits = (contact || '').replace(/\D/g, '')
  if (digits.length < 9) return null
  return `https://wa.me/${digits.length === 9 ? `351${digits}` : digits}`
}

export default function TeacherPage({ view = 'profile' }) {
  const { t } = useTranslation()
  const { id } = useParams()
  const navigate = useNavigate()
  const goBack = useGoBack('/comunidade')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [day, setDay] = useState(null)
  // Com as aulas escondidas a pagina fica so com quem e e o contacto:
  // sem precos, sem «Pedir aula» e sem a semana das aulas.
  const { isLessonsEnabled } = useAuth()

  // Semana corrente (perfil) ou as próximas duas semanas (disponibilidade).
  const range = useMemo(() => {
    const today = startOfDay(new Date())
    if (view === 'profile') {
      const monday = addDays(today, 1 - isoWeekday(today))
      return { from: monday, to: addDays(monday, 6) }
    }
    return { from: today, to: addDays(today, 13) }
  }, [view])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setFailed(false)
    getTeacherPage(id, localIso(range.from), localIso(range.to))
      .then((res) => { if (alive) setData(res) })
      .catch((error) => {
        if (errorKind(error) !== 'not_ready') console.error('Error loading teacher page:', error)
        if (alive) setFailed(true)
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [id, range])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
      </div>
    )
  }
  if (failed || !data?.teacher) {
    return (
      <div className="space-y-5">
        <button type="button" onClick={goBack} className="inline-flex items-center gap-1.5 text-ink-700 font-extrabold text-sm hover:underline">
          <ArrowLeft size={16} /> {t('common.back')}
        </button>
        <EmptyState icon={GraduationCap} title={t('lessons.teacher_not_found_title')} subtitle={t('lessons.teacher_not_found_subtitle')} />
      </div>
    )
  }

  const { teacher, prices = [], items = [] } = data
  const today = localIso(new Date())

  if (view === 'availability') {
    return <Availability teacher={teacher} prices={prices} items={items} day={day} setDay={setDay} goBack={goBack} today={today} />
  }

  const levels = levelRange(t, teacher.level_from, teacher.level_to)
  const whatsapp = waLink(teacher.contact)
  const role = t(teacher.gender === 'feminino' ? 'lessons.teacher_role_f' : 'lessons.teacher_role')
  const where = [teacher.org_name || t('lessons.no_club'), teacher.org_city || teacher.zone].filter(Boolean).join(' · ')
  const priceFor = (type, dur) => priceRowFor(prices, {
    teacherProfileId: teacher.teacher_profile_id, lessonType: type, durationMinutes: dur, peak: true, onIso: today,
  })?.price_lesson
  // Sem nenhum preço, a grelha seria só travessões: esconde-se o bloco
  // inteiro (Francisco, 22 set — Trello #385). Com alguns, mostra-se e os
  // que faltam ficam com travessão.
  const hasPrices = Object.keys(LESSON_CAPACITY).some((type) => LESSON_DURATIONS.some((d) => priceFor(type, d) != null))

  const weekly = weeklyFromItems(items)

  // "Esta semana": seg–dom; domingo só aparece se tiver alguma coisa.
  const days = [1, 2, 3, 4, 5, 6, 7].filter((wd) => wd < 7 || items.some((it) => it.weekday === 7))

  return (
    <div className="space-y-5">
      <button type="button" onClick={goBack} className="inline-flex items-center gap-1.5 text-ink-700 font-extrabold text-sm hover:underline">
        <ArrowLeft size={16} /> {t('common.back')}
      </button>

      <div className="flex items-center gap-3.5">
        <Avatar name={teacher.name} url={teacher.avatar_url} size="w-16 h-16 text-xl" colorClass="bg-ink-50 text-ink-500" />
        <div className="min-w-0">
          <h2 className="text-2xl text-ink-900 truncate">{teacher.name}</h2>
          <p className="text-sm text-muted">{role} · {where}</p>
          {(bandLabel(teacher.rating, teacher.gender) || levels) && (
            <p className="text-sm text-muted flex items-center gap-1.5 mt-0.5">
              <LevelPill label={bandLabel(teacher.rating, teacher.gender)} />
              {levels && <span>{t('lessons.teaches_levels', { range: levels })}</span>}
            </p>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        {isLessonsEnabled && (
          <PrimaryButton className="flex-1 !px-3" onClick={() => navigate(`/professor/${id}/disponibilidade`)}>
            {t('lessons.request_lesson')}
          </PrimaryButton>
        )}
        {whatsapp && (
          <a href={whatsapp} target="_blank" rel="noopener noreferrer"
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-ctrl min-h-[48px] bg-ink-50 text-ink-900 font-extrabold hover:bg-ink-200 transition-colors duration-fast">
            <Phone size={16} /> WhatsApp
          </a>
        )}
      </div>

      {/* Horário da semana (Trello #418): fica à vista mesmo com as aulas
          escondidas (Francisco, 25 set) — só o horário, sem «Pedir aula».
          Com as aulas à vista, o mesmo horário aparece na grelha em baixo. */}
      {!isLessonsEnabled && weekly.length > 0 && (
        <div>
          <MonoLabel>{t('teacher.public_schedule_heading')}</MonoLabel>
          <ul className="mt-1.5 text-sm">
            {weekly.map((s, i) => (
              <li key={i} className="flex justify-between gap-3 border-t border-line py-1.5 first:border-t-0">
                <span className="font-semibold text-ink-900">{t(`lessons.wd_long_${s.weekday}`)}</span>
                <span className="tabular-nums text-ink-900">{s.start}–{s.end}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isLessonsEnabled && hasPrices && (
      <div>
        <MonoLabel>{t('lessons.prices_per_person')}</MonoLabel>
        <table className="w-full mt-1.5 text-sm tabular-nums border-collapse">
          <thead>
            <tr>
              <th />
              {LESSON_DURATIONS.map((d) => (
                <th key={d} className="font-mono text-[10.5px] text-ink-500 text-right font-bold px-1 py-1">{t(`lessons.duration_${d}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.keys(LESSON_CAPACITY).map((type) => (
              <tr key={type} className="border-t border-line">
                <td className="font-semibold text-ink-900 py-1.5">{t(`lessons.price_row_${type}`)}</td>
                {LESSON_DURATIONS.map((d) => {
                  const v = priceFor(type, d)
                  return <td key={d} className="text-right px-1 py-1.5 text-ink-900">{v == null ? '—' : euros(v)}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-muted mt-1.5">
          {teacher.org_name ? t('lessons.prices_of', { name: teacher.org_name }) : t('lessons.prices_own')} · {t('lessons.peak_lower')}
        </p>
      </div>
      )}

      {isLessonsEnabled && (
      <div>
        <MonoLabel>{t('lessons.this_week')}</MonoLabel>
        <div className="grid gap-1 mt-2" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
          {days.map((wd) => (
            <div key={wd} className="flex flex-col gap-[3px] text-center">
              <span className="font-mono text-[10.5px] font-bold text-ink-500 capitalize">{t(`lessons.wd_short_${wd}`)}</span>
              {items.filter((it) => it.weekday === wd).map((it, i) => <WeekBlock key={i} item={it} />)}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 mt-2.5 text-[11px] text-ink-500">
          <span className="inline-flex items-center gap-1"><i className="inline-block w-3 h-[9px] rounded-[3px] bg-white" style={{ border: `1.5px dashed ${TEAL.text}` }} />{t('lessons.legend_free')}</span>
          <span className="inline-flex items-center gap-1"><i className="inline-block w-3 h-[9px] rounded-[3px]" style={{ background: TEAL.bg }} />{t('lessons.legend_open')}</span>
          <span className="inline-flex items-center gap-1"><i className="inline-block w-3 h-[9px] rounded-[3px] bg-ink-50" />{t('lessons.legend_busy')}</span>
        </div>
      </div>
      )}
    </div>
  )
}

/** Bloco da grelha "Esta semana": altura proporcional à duração (4h ≈ 60px). */
function WeekBlock({ item }) {
  const { t } = useTranslation()
  const mins = minutesBetween(item.starts_at, item.ends_at)
  const height = Math.max(22, Math.round(mins / 4))
  const full = item.kind === 'series' && item.taken >= item.capacity
  const base = 'rounded-md text-[10px] font-semibold flex items-center justify-center'
  if (item.kind === 'free') {
    const label = mins >= 240 ? `${hm(item.starts_at).replace(':00', '')}–${hm(item.ends_at).replace(':00', '')}` : t('lessons.free_lower')
    return <span className={`${base} bg-white`} style={{ height, border: `1.5px dashed ${TEAL.text}`, color: TEAL.text }}>{label}</span>
  }
  if (item.kind === 'series' && !full) {
    return <span className={base} style={{ height, background: TEAL.bg, color: TEAL.text }}>{t(`lessons.short_type_${item.lesson_type}`)}</span>
  }
  return <span className={`${base} bg-ink-50`} style={{ height }} />
}

function Availability({ teacher, prices, items, day, setDay, goBack, today }) {
  const { t } = useTranslation()
  // Estado do aluno em cada turma depois de agir aqui (pedido enviado,
  // confirmado…), por cima do que veio do servidor.
  const [mine, setMine] = useState({})
  const [enrolItem, setEnrolItem] = useState(null)
  const [acting, setActing] = useState(null)
  const statusOf = (it) => (it.series_id in mine ? mine[it.series_id] : { status: it.my_status, id: it.my_enrolment_id })
  const act = async (it, fn, next) => {
    const { id } = statusOf(it)
    setActing(it.series_id)
    try {
      await fn(id)
      setMine((m) => ({ ...m, [it.series_id]: next === null ? { status: null, id: null } : { status: next, id } }))
    } catch (error) {
      alert(describeError(t, error, 'lessons.error_request'))
    } finally {
      setActing(null)
    }
  }
  // Dias com alguma coisa, até 5 chips (o print mostra Hoje, Sex, Sáb, Seg, Ter).
  const dayKeys = [...new Set(items.map((it) => localIso(new Date(it.starts_at))))].sort().slice(0, 5)
  const selected = day && dayKeys.includes(day) ? day : dayKeys[0]
  const dayItems = items.filter((it) => localIso(new Date(it.starts_at)) === selected)
    .sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1))
  const selDate = selected ? new Date(`${selected}T12:00:00`) : null

  // "desde X €": o preço por aula mais baixo que cabe no bloco livre.
  const freeFrom = (it) => {
    const mins = minutesBetween(it.starts_at, it.ends_at)
    let min = null
    for (const type of Object.keys(LESSON_CAPACITY)) {
      for (const d of LESSON_DURATIONS.filter((x) => x <= mins)) {
        for (const peak of [true, false]) {
          const v = priceRowFor(prices, { teacherProfileId: teacher.teacher_profile_id, lessonType: type, durationMinutes: d, peak, onIso: today })?.price_lesson
          if (v != null && (min == null || Number(v) < min)) min = Number(v)
        }
      }
    }
    return min
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5">
        <button type="button" onClick={goBack} aria-label={t('common.back')}
          className="w-10 h-10 shrink-0 rounded-full border border-line flex items-center justify-center text-ink-900 hover:bg-ink-50">
          <ChevronLeft size={18} />
        </button>
        <div className="min-w-0">
          <h2 className="text-xl text-ink-900 truncate">{teacher.name}</h2>
          <p className="text-xs text-muted">{teacher.org_name ? t('lessons.at_club', { name: teacher.org_name }) : t('lessons.no_club')}</p>
        </div>
      </div>

      {dayKeys.length === 0 ? (
        <EmptyState icon={Clock} title={t('lessons.no_availability_title')} subtitle={t('lessons.no_availability_subtitle')} />
      ) : (
        <>
          <div className="flex gap-1.5">
            {dayKeys.map((key) => {
              const d = new Date(`${key}T12:00:00`)
              const on = key === selected
              return (
                <button key={key} type="button" onClick={() => setDay(key)}
                  className={`flex-1 min-w-0 rounded-xl border py-1.5 flex flex-col items-center text-[11px] transition-colors duration-fast ${
                    on ? 'bg-ink-900 border-ink-900 text-white' : 'border-line text-ink-500 hover:bg-ink-50'
                  }`}>
                  <span className="capitalize">{sameDay(d, new Date()) ? t('lessons.today') : t(`lessons.wd_short_${isoWeekday(d)}`)}</span>
                  <b className={`text-base font-extrabold ${on ? 'text-white' : 'text-ink-900'}`}>{d.getDate()}</b>
                </button>
              )
            })}
          </div>

          <MonoLabel>
            {t(`lessons.wd_long_${isoWeekday(selDate)}`)}, {selDate.getDate()} {t(`lessons.month_short_${selDate.getMonth() + 1}`)}
          </MonoLabel>

          <div className="space-y-2">
            {dayItems.map((it, i) => {
              const full = it.kind === 'series' && it.taken >= it.capacity
              const my = it.kind === 'series' ? statusOf(it) : {}
              if (it.kind === 'series' && (!full || my.status === 'confirmed')) {
                const left = it.capacity - it.taken
                const enrolled = my.status === 'confirmed'
                const btn = 'rounded-full px-3 py-1.5 text-xs font-bold disabled:opacity-40'
                return (
                  <div key={i} className={`rounded-2xl p-3 ${enrolled ? 'border-2 border-ok' : 'border'}`} style={{ background: TEAL.bg, borderColor: enrolled ? undefined : TEAL.border }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex flex-wrap gap-1">
                        <TealTag icon={GraduationCap}>{lessonTypeLabel(t, it.lesson_type, { series: true })}</TealTag>
                        <TealTag icon={Repeat}>{t(`lessons.wd_plural_${it.weekday}`)}</TealTag>
                      </span>
                      {enrolled ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-ok px-2 py-[3px] text-[11px] font-semibold text-white"><Check size={12} />{t('lessons.state_enrolled')}</span>
                      ) : my.status === 'requested' ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-[3px] text-[11px] font-semibold text-ink-700"><Clock size={12} />{t('lessons.state_requested')}</span>
                      ) : my.status === 'accepted' ? (
                        <span className="rounded-full bg-ink-900 px-2 py-[3px] text-[11px] font-semibold text-white">{t('lessons.state_confirm')}</span>
                      ) : (
                        <span className="text-xs text-ink-500 shrink-0">{t('lessons.seats_left', { count: left })}</span>
                      )}
                    </div>
                    <p className="font-display font-extrabold text-lg text-ink-900 mt-2 leading-none">
                      {hhmm(it.starts_at)}<span className="text-sm text-ink-500 font-bold">–{hhmm(it.ends_at)}</span>
                    </p>
                    {my.status === 'accepted' && (
                      <p className="text-xs text-ink-700 mt-1.5">{t('lessons.accepted_line', { name: teacher.name.split(' ')[0] })}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-2 mt-2.5 pt-2 border-t border-ink-900/10">
                      {my.status === 'requested' ? (
                        <>
                          <span className="text-xs text-ink-500">{t('lessons.waiting_teacher', { name: teacher.name.split(' ')[0] })}</span>
                          <button type="button" disabled={acting === it.series_id} onClick={() => act(it, cancelEnrolment, null)}
                            className={`ml-auto border border-ink-900 bg-white text-ink-900 hover:bg-ink-50 ${btn}`}>{t('lessons.cancel_request')}</button>
                        </>
                      ) : my.status === 'accepted' ? (
                        <>
                          <span className="text-xs text-ink-500">{t('lessons.do_you_confirm')}</span>
                          <span className="ml-auto flex gap-1.5">
                            <button type="button" disabled={acting === it.series_id} onClick={() => act(it, (id) => confirmEnrolment(id, false), null)}
                              className={`border border-ink-900 bg-white text-ink-900 hover:bg-ink-50 ${btn}`}>{t('lessons.give_up')}</button>
                            <button type="button" disabled={acting === it.series_id} onClick={() => act(it, (id) => confirmEnrolment(id, true), 'confirmed')}
                              className={`bg-lime-400 text-ink-900 hover:bg-lime-600 ${btn}`}>{t('lessons.confirm')}</button>
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="text-xs text-ink-500 inline-flex items-center gap-1">
                            {it.taken}/{it.capacity} · {t('lessons.average')} <LevelPill label={bandLabel(it.avg_rating, it.avg_gender)} /> · {t('lessons.per_month', { price: euros(it.price_month) })}
                          </span>
                          {!enrolled && (
                            <button type="button" onClick={() => setEnrolItem(it)} className={`ml-auto bg-lime-400 text-ink-900 hover:bg-lime-600 ${btn}`}>
                              {t('lessons.ask_to_join')}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )
              }
              if (it.kind === 'free') {
                const from = freeFrom(it)
                return (
                  <div key={i} className="rounded-2xl bg-white p-3" style={{ border: `1.5px dashed ${TEAL.text}` }}>
                    <div className="flex items-center justify-between gap-2">
                      <TealTag icon={Clock}>{t('lessons.free')}</TealTag>
                      {from != null && <span className="text-xs text-ink-500">{t('lessons.from_price', { price: euros(from) })}</span>}
                    </div>
                    <p className="font-display font-extrabold text-lg text-ink-900 mt-2 leading-none">
                      {hhmm(it.starts_at)}<span className="text-sm text-ink-500 font-bold">–{hhmm(it.ends_at)}</span>
                    </p>
                    <div className="flex flex-wrap items-center gap-2 mt-2.5 pt-2 border-t border-ink-900/10">
                      <span className="text-xs text-ink-500">{t('lessons.choose_time_hint')}</span>
                      <button type="button" className="ml-auto rounded-full bg-lime-400 px-3 py-1.5 text-xs font-bold text-ink-900 hover:bg-lime-600">
                        {t('lessons.request_lesson')}
                      </button>
                    </div>
                  </div>
                )
              }
              return (
                <div key={i} className="rounded-2xl bg-ink-50 p-3">
                  <p className="text-xs text-ink-500">{t('lessons.busy')}</p>
                  <p className="font-display font-extrabold text-lg text-ink-500 mt-2 leading-none">
                    {hhmm(it.starts_at)}<span className="text-sm font-bold">–{hhmm(it.ends_at)}</span>
                  </p>
                </div>
              )
            })}
          </div>
        </>
      )}
      {enrolItem && (
        <EnrolSheet item={enrolItem} teacher={teacher} onClose={() => setEnrolItem(null)}
          onSent={(id) => { setMine((m) => ({ ...m, [enrolItem.series_id]: { status: 'requested', id } })); setEnrolItem(null) }} />
      )}
    </div>
  )
}
