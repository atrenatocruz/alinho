import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, GraduationCap } from 'lucide-react'
import { acceptLessonProposal, cancelLessonRequest, emailLessonRequest, getTeacherBooking, proposeLessonTime, requestLesson } from '../lib/lessonsApi'
import ProposeTimeSheet from '../components/lessons/ProposeTimeSheet'
import {
  LESSON_TYPES, availableDurations, endTime, isPeak, lessonPrice, localDateTime, startOptions, upcomingBlocks,
} from '../lib/lessonBooking'
import { compactTime } from '../lib/teacherSchedule'
import { describeError, errorKind } from '../lib/errors'
import { Chips, ConfirmSheet, EmptyState, PrimaryButton } from '../components/ui'

/* ─── «Pedir aula ao <nome>» (Trello #392, assunto 1) ─────────────────────
   Desenho aprovado pelo Francisco a 26 set (design-handoff/2026-09-26-
   marcar-aulas). Um ecrã de cima para baixo: dia (próximos 14 dias, do
   horário semanal, com o clube), duração (só com preço), hora (só as que
   cabem; ocupadas riscadas), tipo com o preço, e como o professor fala
   contigo — nenhum vem escolhido. Uma aprovação só, a do professor.
   Atrás da bandeira das aulas (rota require="lessons") até 11 out.
   RGPD: o telefone só vai com «Pelo WhatsApp», dado pelo aluno para este
   pedido; o servidor apaga-o quando o pedido fecha. */

const label = 'block text-[11px] font-extrabold uppercase tracking-widest text-muted mb-2'
const euros = (v) => `${Number(v).toLocaleString('pt-PT', { maximumFractionDigits: 2 })} €`
const dayLabel = (t, dateIso) => {
  const d = new Date(`${dateIso}T12:00:00`)
  return `${t(`lessons.wd_short_${((d.getDay() + 6) % 7) + 1}`)} ${d.getDate()}/${d.getMonth() + 1}`
}
const shortHours = (a, b) => `${compactTime(a).replace(':00', '')}–${compactTime(b).replace(':00', '')}`

export default function RequestLesson() {
  const { t } = useTranslation()
  const { id } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [blockKey, setBlockKey] = useState(null)
  const [duration, setDuration] = useState(null)
  const [start, setStart] = useState(null)
  const [type, setType] = useState(null)
  const [contactVia, setContactVia] = useState(null)
  const [phone, setPhone] = useState('')
  const [missing, setMissing] = useState(null) // 'contact' | 'phone' | null
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(null) // o pedido acabado de enviar
  const [asking, setAsking] = useState(null) // pedido a cancelar
  const [proposing, setProposing] = useState(null) // pedido a que propõe outra hora
  const [cardError, setCardError] = useState('')
  const [booked, setBooked] = useState(null) // aula acabada de marcar (aceitou a proposta)

  const load = async () => {
    try {
      setData(await getTeacherBooking(id))
    } catch (err) {
      if (errorKind(err) !== 'not_ready') console.error('Error loading booking:', err)
      setData(null)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const blocks = useMemo(() => upcomingBlocks(data?.profiles || []), [data])
  const block = blocks.find((b) => b.key === blockKey) || null
  const profile = block ? data.profiles.find((p) => p.teacher_profile_id === block.tp) : null
  const durations = availableDurations(block, profile)
  const { options: starts, noFit } = startOptions(block, duration, data?.busy || [])
  const peak = block && start && duration ? isPeak(profile.peak_hours, block.weekday, start, duration) : false
  const priceOf = (ty) => (block && duration ? lessonPrice(profile.prices, block.tp, ty, duration, peak, block.date) : null)
  const price = type ? priceOf(type) : null

  // Mudar uma escolha de cima limpa as de baixo que deixaram de caber.
  const chooseBlock = (key) => { setBlockKey(key); setDuration(null); setStart(null); setType(null) }
  const chooseDuration = (d) => { setDuration(d); setStart(null); setType(null) }

  if (loading) {
    return <div className="flex items-center justify-center py-16"><div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div></div>
  }
  const back = (to, text) => (
    <button type="button" onClick={() => navigate(to)} className="inline-flex items-center gap-1.5 text-ink-900 font-extrabold text-sm hover:underline">
      <ArrowLeft size={16} /> {text}
    </button>
  )
  if (!data?.teacher) {
    return (
      <div className="space-y-5">
        {back(`/professor/${id}`, t('common.back'))}
        <EmptyState icon={GraduationCap} title={t('lessons.teacher_not_found_title')} subtitle={t('lessons.teacher_not_found_subtitle')} />
      </div>
    )
  }

  const first = (data.teacher.name || '').split(' ')[0]
  const female = data.teacher.gender === 'feminino'
  const shortName = (() => { const [a, b] = (data.teacher.name || '').split(' '); return b ? `${a} ${b[0]}.` : a })()
  const g = (key, vars) => t(female ? `${key}_f` : key, { name: first, ...vars })

  const send = async () => {
    setError('')
    if (!contactVia) { setMissing('contact'); return }
    if (contactVia === 'whatsapp' && !data.i_have_whatsapp && phone.replace(/\D/g, '').length < 9) { setMissing('phone'); return }
    setSending(true)
    try {
      const startsAt = localDateTime(block.date, start).toISOString()
      const reqId = await requestLesson({ teacherProfileId: block.tp, startsAt, duration, type, contactVia, phone: data.i_have_whatsapp ? null : phone })
      emailLessonRequest('lesson_request', reqId)
      setSent({ id: reqId, starts_at: startsAt, duration_minutes: duration, lesson_type: type, price_per_person: price, contact_via: contactVia, org_name: block.orgName })
      setPhone('')
    } catch (err) {
      console.error('Error requesting lesson:', err)
      setError(describeError(t, err, 'booking.error_send'))
    } finally {
      setSending(false)
    }
  }

  const pad2 = (n) => String(n).padStart(2, '0')
  const whenOf = (iso, minutes) => {
    const d = new Date(iso)
    const di = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
    const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
    return `${dayLabel(t, di)} · ${compactTime(hm)}–${compactTime(endTime(hm, minutes))}`
  }
  const acceptProposal = async (r) => {
    setCardError('')
    try {
      const lessonId = await acceptLessonProposal(r.id)
      setBooked({ ...r, lessonId })
      setSent(null)
      await load()
    } catch (err) {
      console.error('Error accepting proposal:', err)
      setCardError(describeError(t, err, 'proposal.error_accept'))
    }
  }

  // Um pedido meu por responder (acabado de enviar ou de antes).
  const card = (r) => {
    const d = new Date(r.starts_at)
    const pad = (n) => String(n).padStart(2, '0')
    const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
    // O professor propôs outra hora: quem recebe é que aceita (Francisco, 26 set).
    if (r.proposed_by === 'teacher' && r.proposed_starts_at) {
      return (
        <div key={r.id} className="rounded-2xl bg-white p-3.5 space-y-2" style={{ border: '1.5px dashed #9CA3AF' }}>
          <span className="inline-flex rounded-full bg-ink-900 px-2 py-[3px] text-[11px] font-extrabold text-white">{t('proposal.pill')}</span>
          <p className="font-display font-extrabold text-lg text-ink-900 leading-tight">{t('booking.sent_title', { name: shortName })}</p>
          <p className="text-sm text-ink-900">
            {g('proposal.teacher_proposed', { when: whenOf(r.proposed_starts_at, r.duration_minutes), asked: whenOf(r.original_starts_at || r.starts_at, r.duration_minutes) })}
          </p>
          {r.org_name && <p className="text-sm text-muted">{r.org_name}</p>}
          {cardError && <p role="alert" className="rounded-ctrl border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-bold text-danger">{cardError}</p>}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="button" onClick={() => acceptProposal(r)}
              className="inline-flex items-center justify-center min-h-[44px] px-5 rounded-full bg-ink-900 text-white text-sm font-extrabold">{t('myLessons.accept')}</button>
            <button type="button" onClick={() => setProposing(r)}
              className="inline-flex items-center justify-center min-h-[44px] px-4 rounded-full border-[1.5px] border-line bg-white text-ink-900 text-sm font-extrabold">{t('proposal.propose')}</button>
            <button type="button" onClick={() => setAsking(r)}
              className="min-h-[44px] px-3 text-sm font-extrabold text-muted hover:text-ink-900">{t('myLessons.reject')}</button>
          </div>
        </div>
      )
    }
    return (
      <div key={r.id} className="rounded-2xl bg-white p-3.5 space-y-2" style={{ border: '1.5px dashed #9CA3AF' }}>
        <span className="inline-flex rounded-full bg-ink-50 px-2 py-[3px] text-[11px] font-extrabold text-ink-700">{t('booking.sent_pill')}</span>
        <p className="font-display font-extrabold text-lg text-ink-900 leading-tight">{t('booking.sent_title', { name: shortName })}</p>
        <p className="text-sm text-muted">
          {dayLabel(t, iso)} · {compactTime(hm)}–{compactTime(endTime(hm, r.duration_minutes))} · {t(`lessons.price_row_${r.lesson_type}`)}
          {r.price_per_person != null && ` · ${t('booking.per_person', { price: euros(r.price_per_person) })}`}
        </p>
        {r.org_name && <p className="text-sm text-muted">{r.org_name}</p>}
        {r.proposed_by === 'student' && r.proposed_starts_at && (
          <p className="text-sm text-ink-900">{g('proposal.you_proposed_student', { when: whenOf(r.proposed_starts_at, r.duration_minutes) })}</p>
        )}
        <p className="rounded-ctrl bg-ink-50 px-3 py-2.5 text-sm text-ink-900 leading-snug">
          {g(r.contact_via === 'whatsapp' ? 'booking.sent_info_whatsapp' : 'booking.sent_info_email')}
        </p>
        <button type="button" onClick={() => setAsking(r)}
          className="w-full min-h-[48px] rounded-full border-[1.5px] border-line bg-white text-ink-900 font-extrabold hover:bg-ink-50">
          {t('booking.cancel')}
        </button>
      </div>
    )
  }

  const cancelSheet = (
    <ConfirmSheet
      open={!!asking}
      danger
      title={t('booking.cancel_title')}
      message={g('booking.cancel_text')}
      cancelLabel={t('booking.cancel_keep')}
      confirmLabel={t('booking.cancel_confirm')}
      onConfirm={async () => { await cancelLessonRequest(asking.id); setSent(null); await load() }}
      onClose={() => setAsking(null)}
      errorOf={(err) => describeError(t, err, 'booking.error_cancel')}
    />
  )

  // Depois de enviar (ou com um pedido meu por responder), o ecrã fica só com
  // o cartão do pedido — nunca o formulário outra vez (designer, 26 set).
  const pending = sent ? [sent] : (data.mine || [])
  const proposeSheet = (
    <ProposeTimeSheet
      open={!!proposing}
      teacherProfileId={proposing?.teacher_profile_id}
      durationMinutes={proposing?.duration_minutes}
      onSend={async (startsAt) => { await proposeLessonTime(proposing.id, startsAt); setSent(null); await load() }}
      onClose={() => setProposing(null)}
    />
  )
  if (booked) {
    return (
      <div className="space-y-4">
        {back(`/professor/${id}`, t('common.back'))}
        <div className="card space-y-2 border-2 border-ok">
          <span className="inline-flex items-center gap-1 rounded-full bg-ok px-2 py-[3px] text-[11px] font-semibold text-white">{t('lessons.state_enrolled')}</span>
          <p className="font-display font-extrabold text-lg text-ink-900 leading-tight">{t('booking.sent_title', { name: shortName })}</p>
          <p className="text-sm text-muted">{whenOf(booked.proposed_starts_at || booked.starts_at, booked.duration_minutes)}{booked.org_name ? ` · ${booked.org_name}` : ''}</p>
          {booked.lessonId && (
            <button type="button" onClick={() => navigate(`/aula/${booked.lessonId}`)}
              className="w-full min-h-[48px] rounded-full bg-ink-900 text-white font-extrabold">{t('proposal.see_lesson')}</button>
          )}
        </div>
      </div>
    )
  }
  if (pending.length > 0) {
    return (
      <div className="space-y-4">
        {back(`/professor/${id}`, t('common.back'))}
        {pending.map(card)}
        {cancelSheet}
        {proposeSheet}
      </div>
    )
  }

  const chip = (on) => `rounded-full border px-3.5 min-h-[40px] text-sm font-extrabold transition-colors duration-fast ${on ? 'border-ink-900 bg-ink-900 text-white' : 'border-line bg-canvas text-ink-700'}`
  const taken = starts.filter((o) => o.taken).map((o) => o.time)
  const reasons = [
    ...taken.slice(0, 1).map((h) => t('booking.start_taken', { time: compactTime(h) })),
    ...(noFit ? [t('booking.start_nofit', { time: compactTime(noFit), duration: t(`lessons.duration_${duration}`) })] : []),
  ]

  return (
    <div className="space-y-5 pb-4">
      {back(`/professor/${id}`, shortName)}
      <h2 className="text-2xl text-ink-900">{g('booking.title')}</h2>

      <section>
        <span className={label}>{t('booking.day')}</span>
        {blocks.length === 0 ? (
          <p className="text-sm text-muted">{g('booking.no_days')}</p>
        ) : (
          <div className="-mx-4 flex gap-2 overflow-x-auto no-scrollbar px-4">
            {blocks.map((b) => (
              <button key={b.key} type="button" aria-pressed={b.key === blockKey} onClick={() => chooseBlock(b.key)}
                className={`flex-none whitespace-nowrap text-left rounded-2xl border px-3 py-1.5 transition-colors duration-fast ${b.key === blockKey ? 'border-ink-900 bg-ink-900 text-white' : 'border-line bg-canvas text-ink-900'}`}>
                <span className="block text-sm font-extrabold">{dayLabel(t, b.date)}</span>
                <span className={`block text-xs ${b.key === blockKey ? 'text-white/80' : 'text-muted'}`}>
                  {shortHours(b.start, b.end)}{b.orgName ? ` · ${b.orgName}` : ''}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {block && (
        <section>
          <span className={label}>{t('booking.duration')}</span>
          {durations.length === 0
            ? <p className="text-sm text-muted">{t('booking.no_prices')}</p>
            : <Chips options={durations.map((d) => ({ value: d, label: t(`lessons.duration_${d}`) }))} value={duration} onChange={chooseDuration} />}
        </section>
      )}

      {block && duration && (
        <section>
          <span className={label}>{t('booking.start')}</span>
          <div className="flex flex-wrap gap-2">
            {starts.map((o) => (
              <button key={o.time} type="button" disabled={o.taken} aria-pressed={o.time === start}
                onClick={() => { setStart(o.time); setType(null) }}
                className={`${chip(o.time === start)} disabled:line-through disabled:text-muted disabled:bg-ink-50`}>
                {compactTime(o.time)}
              </button>
            ))}
          </div>
          {reasons.length > 0 && <p className="text-xs text-muted mt-2">{reasons.join(' · ')}</p>}
        </section>
      )}

      {block && duration && start && (
        <section>
          <span className={label}>{t('booking.type')}</span>
          <div className="grid grid-cols-2 gap-2">
            {LESSON_TYPES.filter((ty) => priceOf(ty) != null).map((ty) => (
              <button key={ty} type="button" aria-pressed={ty === type} onClick={() => setType(ty)}
                className={`flex items-center justify-between rounded-ctrl bg-white px-3.5 min-h-[48px] text-sm font-extrabold text-ink-900 ${ty === type ? 'border-2 border-ink-900' : 'border border-line'}`}>
                <span>{t(`lessons.price_row_${ty}`)}</span><span>{euros(priceOf(ty))}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {type && (
        <section>
          <span className={label}>{g('booking.contact_question')}</span>
          <div className="grid grid-cols-2 gap-2">
            {['whatsapp', 'email'].map((via) => (
              <button key={via} type="button" aria-pressed={contactVia === via} onClick={() => { setContactVia(via); setMissing(null) }}
                className={`min-h-[48px] rounded-ctrl text-sm font-extrabold ${contactVia === via ? 'border border-ink-900 bg-ink-900 text-white' : `border bg-white text-ink-900 ${missing === 'contact' ? 'border-danger' : 'border-line'}`}`}>
                {t(`booking.via_${via}`)}
              </button>
            ))}
          </div>
          {missing === 'contact' && <p role="alert" className="text-xs font-extrabold text-danger mt-1.5">{t('booking.missing_contact')}</p>}
          {contactVia === 'whatsapp' && !data.i_have_whatsapp && (
            <div className="mt-2">
              <input type="tel" inputMode="tel" value={phone} onChange={(e) => { setPhone(e.target.value); setMissing(null) }}
                placeholder={t('booking.phone_placeholder')} aria-invalid={missing === 'phone' || undefined}
                className={`input-field ${missing === 'phone' ? '!border-danger' : ''}`} />
              {missing === 'phone' && <p role="alert" className="text-xs font-extrabold text-danger mt-1">{t('booking.missing_phone')}</p>}
            </div>
          )}
          <p className="text-xs text-muted mt-1.5">{g('booking.contact_hint')}</p>
        </section>
      )}

      {type && (
        <div className="space-y-2">
          <p className="flex justify-between gap-3 text-sm text-ink-900">
            <span>{dayLabel(t, block.date)} · {compactTime(start)}–{compactTime(endTime(start, duration))} · {t(`lessons.price_row_${type}`)}</span>
            <b className="font-extrabold shrink-0">{t('booking.per_person', { price: euros(price) })}</b>
          </p>
          {error && <p role="alert" className="rounded-ctrl border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-bold text-danger">{error}</p>}
          <PrimaryButton className="w-full" onClick={send} disabled={sending}>{t('booking.send')}</PrimaryButton>
          <p className="text-xs text-muted text-center">{g('booking.send_hint')}</p>
        </div>
      )}

      {cancelSheet}
    </div>
  )
}
