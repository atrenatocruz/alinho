import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { BackBar, Tabs, Chips } from '../components/ui'
import { Sheet } from '../components/agenda/AgendaControls'
import { useFeatureFlag } from '../lib/useFeatureFlag'
import { getPartner } from '../lib/partners'
import {
  myManagedPartners, partnerListVouchers, partnerRedeemVoucher, updatePartnerProfile,
  uploadPartnerImage, imageProblem, normalizeCode,
} from '../lib/partnerAdmin'

/* Gerir um parceiro (a Rita, da RM Terapias): design-handoff/2026-10-22-
   parceiro-gerir (UX, 22 out). Dois separadores: «Códigos» (os vouchers dos
   prémios, SEM nomes de quem ganhou, e «Validar um código» na receção) e
   «Ficha» (o que aparece na página do parceiro, um campo de cada vez). Os
   dados são do Dev 3 (migration_parceiros_3_pagina_do_parceiro.sql). */

const STATUS_PILL = {
  por_usar: 'bg-[#E7F6D5] text-[#3F6212]',
  usado: 'bg-[#EEF0EC] text-ink-700',
  expirado: 'bg-[#FDE8E6] text-[#B42318]',
  anulado: 'bg-[#EEF0EC] text-muted line-through',
}
// O parceiro gere tudo menos os prémios e a zona (Francisco, 22 out).
const FIELDS = ['name', 'tagline', 'address', 'hours', 'phones', 'email', 'instagram_url', 'website_url']

const ymd = (v) => String(v || '').slice(0, 10)
const asDate = (v) => new Date(`${ymd(v)}T12:00:00`)
/** «4 dez» ou «31 dez 2026»: o dia e o mês por extenso curto, nunca «4/12». */
const dayMonth = (d, loc, year = false) => {
  const date = d instanceof Date ? d : new Date(d)
  const m = date.toLocaleDateString(loc, { month: 'short' }).replace('.', '')
  return year ? `${date.getDate()} ${m} ${date.getFullYear()}` : `${date.getDate()} ${m}`
}

function PartnerLogo({ partner, size = 'h-11 w-11 text-sm' }) {
  if (partner?.logo_url) return <img src={partner.logo_url} alt="" className={`${size} shrink-0 rounded-[28%] object-cover`} />
  const initials = String(partner?.name || '?').split(/\s+/)[0].slice(0, 2).toUpperCase()
  return <span className={`${size} flex shrink-0 items-center justify-center rounded-[28%] bg-ink-900 font-display font-extrabold text-lime-400`}>{initials}</span>
}

export default function PartnerManage() {
  const { t, i18n } = useTranslation()
  const { slug } = useParams()
  const navigate = useNavigate()
  const flag = useFeatureFlag('parceiros')
  const loc = i18n.language?.startsWith('en') ? 'en-GB' : i18n.language?.startsWith('es') ? 'es-ES' : 'pt-PT'

  const [allowed, setAllowed] = useState(undefined) // undefined = a carregar
  const [partner, setPartner] = useState(null)
  const [tab, setTab] = useState('codes')
  const [vouchers, setVouchers] = useState(null)
  const [month, setMonth] = useState(null)
  const [validating, setValidating] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    let alive = true
    Promise.all([myManagedPartners(), getPartner(slug)])
      .then(([mine, p]) => {
        if (!alive) return
        const m = mine.find((x) => x.slug === slug)
        setAllowed(!!m)
        setPartner(p ? { ...p, id: p.id || m?.id } : null)
      })
      .catch(() => { if (alive) setAllowed(false) })
    return () => { alive = false }
  }, [slug])

  const load = () => {
    if (!partner?.id) return
    partnerListVouchers(partner.id, null).then(setVouchers).catch(() => setVouchers([]))
  }
  useEffect(load, [partner?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Os meses que têm códigos (o de agora por omissão, ou o mais recente).
  const months = useMemo(() => {
    const set = [...new Set((vouchers || []).map((v) => ymd(v.prize_month)))].sort()
    return set
  }, [vouchers])
  useEffect(() => {
    if (month || !months.length) return
    const now = `${new Date().toISOString().slice(0, 7)}-01`
    setMonth(months.includes(now) ? now : months[months.length - 1])
  }, [months, month])

  if (flag.loading || allowed === undefined) return <div className="h-60" aria-hidden="true" />
  if (!flag.on || !allowed || !partner) return <Navigate to="/gerir" replace />

  const monthLabel = (m, opts) => asDate(m).toLocaleDateString(loc, opts)
  const pillLabel = (m) => {
    const d = asDate(m)
    const short = d.toLocaleDateString(loc, { month: 'short' }).replace('.', '')
    const label = short.charAt(0).toUpperCase() + short.slice(1)
    return d.getFullYear() !== new Date().getFullYear() || m === month ? `${label} ${d.getFullYear()}` : label
  }
  const inMonth = (vouchers || []).filter((v) => ymd(v.prize_month) === month)
  const active = inMonth.filter((v) => v.status === 'por_usar' || v.status === 'usado')
  const others = (vouchers || []).filter((v) => v.status === 'expirado' || v.status === 'anulado')
  const validUntil = active.map((v) => v.valid_until).filter(Boolean).sort().pop()

  const statusText = (v) => {
    if (v.status === 'usado' && v.used_at) return t('partneradmin.status_used_on', { date: dayMonth(v.used_at, loc) })
    return t(`partneradmin.status_${v.status}`)
  }
  const line = (v, withMonth) => [
    t('partner.place', { place: v.prize_place }), `−${v.discount_pct}%`,
    withMonth ? monthLabel(v.prize_month, { month: 'long' }) : (v.prize_district || partner.district),
  ].filter(Boolean).join(' · ')

  const Row = ({ v, withMonth }) => (
    <div className="flex items-center gap-3 border-b border-line px-3.5 py-3 last:border-b-0">
      <span className="min-w-0 flex-1">
        <span className="block font-mono text-[15px] font-bold tracking-[0.06em] text-ink-900">{v.code}</span>
        <span className="block text-[12.5px] text-muted">{line(v, withMonth)}</span>
      </span>
      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-extrabold ${STATUS_PILL[v.status] || STATUS_PILL.usado}`}>{statusText(v)}</span>
    </div>
  )

  return (
    <div className="space-y-5 pb-6">
      <BackBar onBack={() => navigate('/gerir')} title={partner.name} />
      <div className="flex items-center gap-3">
        <PartnerLogo partner={partner} />
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-extrabold leading-tight text-ink-900">{partner.name}</h1>
          <p className="text-sm text-muted">{[t('partneradmin.label'), partner.city].filter(Boolean).join(' · ')}</p>
        </div>
      </div>

      <Tabs value={tab} onChange={setTab} label={partner.name}
        options={[{ value: 'codes', label: t('partneradmin.tab_codes') }, { value: 'profile', label: t('partneradmin.tab_profile') }]} />

      {toast && <p role="status" className="rounded-ctrl bg-[#E7F6D5] px-3.5 py-2.5 text-[14px] font-bold text-[#3F6212]">{toast}</p>}

      {tab === 'codes' ? (
        <div className="space-y-4">
          {months.length > 0 && (
            <Chips value={month} onChange={setMonth} label={t('partneradmin.month')}
              options={months.map((m) => ({ value: m, label: pillLabel(m) }))} />
          )}
          <button type="button" onClick={() => setValidating(true)}
            className="flex min-h-[52px] w-full items-center justify-center rounded-ctrl bg-ink-900 font-extrabold text-white">
            {t('partneradmin.validate')}
          </button>

          {vouchers === null ? <div className="h-40" aria-hidden="true" /> : (
            <>
              <section>
                <p className="mb-2 font-mono text-[11px] font-bold uppercase tracking-widest text-ink-500">
                  {t('partneradmin.prizes_of', { month: month ? monthLabel(month, { month: 'long' }) : '', count: active.length })}
                </p>
                {active.length ? (
                  <div className="overflow-hidden rounded-card bg-white shadow-[0_1px_2px_rgba(17,17,17,0.06)]">
                    {active.map((v) => <Row key={v.voucher_id} v={v} />)}
                  </div>
                ) : (
                  <p className="rounded-card bg-white px-3.5 py-3 text-[14px] text-muted shadow-[0_1px_2px_rgba(17,17,17,0.06)]">{t('partneradmin.none_yet')}</p>
                )}
                <p className="mt-2 text-[13px] text-muted">
                  {[validUntil && t('partneradmin.valid_until', { date: dayMonth(asDate(validUntil), loc) }), t('partneradmin.no_names')].filter(Boolean).join(' ')}
                </p>
              </section>
              {others.length > 0 && (
                <section>
                  <p className="mb-2 font-mono text-[11px] font-bold uppercase tracking-widest text-ink-500">{t('partneradmin.other_states')}</p>
                  <div className="overflow-hidden rounded-card bg-white shadow-[0_1px_2px_rgba(17,17,17,0.06)]">
                    {others.map((v) => <Row key={v.voucher_id} v={v} withMonth />)}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      ) : (
        <ProfileTab partner={partner} onSaved={(p) => { setPartner((old) => ({ ...old, ...p })); setToast(t('partneradmin.saved')) }} />
      )}

      {validating && (
        <ValidateSheet partner={partner} vouchers={vouchers || []} loc={loc}
          onClose={() => setValidating(false)}
          onUsed={(pct) => { setValidating(false); setToast(t('partneradmin.used_toast', { pct })); load() }} />
      )}
    </div>
  )
}

/* «Validar um código»: escreve-se o código que a pessoa mostra; a app mostra
   o desconto e o lugar antes de «Marcar como usado» (SPEC ponto 4). Os erros
   ficam por baixo da caixa, sem botão de marcar (SPEC ponto 5). */
function ValidateSheet({ partner, vouchers, loc, onClose, onUsed }) {
  const { t } = useTranslation()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  const norm = normalizeCode(code)
  const found = norm.length >= 4 ? vouchers.find((v) => normalizeCode(v.code) === norm) : null
  const shortDate = (v) => dayMonth(v, loc)
  const preview = found && found.status === 'por_usar' ? found : null
  const localError = !found ? null
    : found.status === 'usado' ? t('partneradmin.err_used', { date: shortDate(found.used_at), time: new Date(found.used_at).toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' }) })
    : found.status === 'expirado' ? t('partneradmin.err_expired', { date: shortDate(`${String(found.valid_until).slice(0, 10)}T12:00:00`) })
    : found.status === 'anulado' ? t('partneradmin.err_not_found') : null
  const shown = error || localError

  const confirm = async () => {
    setBusy(true)
    setError('')
    try {
      const r = await partnerRedeemVoucher(norm)
      onUsed(r?.discount_pct ?? preview?.discount_pct)
    } catch (e) {
      const k = String(e?.message || '')
      // O Dev 3 manda a data no hint: used_at (already_used) e valid_until (expired).
      const when = e?.hint ? new Date(String(e.hint).replace(' ', 'T').replace(/\+00$/, 'Z')) : null
      const ok = when && !Number.isNaN(when.getTime())
      setError(k.includes('already_used') ? (ok ? t('partneradmin.err_used', { date: shortDate(when), time: when.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' }) }) : t('partneradmin.err_used_generic'))
        : k.includes('expired') ? (ok ? t('partneradmin.err_expired', { date: shortDate(when) }) : t('partneradmin.err_expired_generic'))
        : k.includes('other_partner') ? t('partneradmin.err_other', { name: partner.name })
        : t('partneradmin.err_not_found'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title={t('partneradmin.validate')} onClose={onClose}>
      <p className="text-[14px] text-muted">{t('partneradmin.validate_hint')}</p>
      <input ref={inputRef} value={code} onChange={(e) => { setCode(e.target.value); setError('') }}
        autoCapitalize="characters" autoComplete="off" spellCheck="false" aria-label={t('partneradmin.code')}
        className="mt-3 w-full rounded-ctrl border-[1.5px] border-ink-900 bg-white px-4 py-3 font-mono text-[20px] font-bold tracking-[0.08em] text-ink-900 outline-none" />

      {shown && <p className="mt-3 rounded-ctrl bg-[#FDE8E6] px-3.5 py-3 text-[14px] font-bold text-[#B42318]">{shown}</p>}
      {!shown && norm.length >= 8 && !found && (
        <p className="mt-3 rounded-ctrl bg-[#FDE8E6] px-3.5 py-3 text-[14px] font-bold text-[#B42318]">{t('partneradmin.err_not_found')}</p>
      )}

      {preview && !error && (
        <>
          <div className="mt-3 rounded-[16px] bg-[#F4F5F1] px-4 py-4">
            <p className="font-display text-[40px] font-black leading-none tracking-[-0.03em] text-ink-900">−{preview.discount_pct}%</p>
            <p className="mt-1 text-[14px] text-ink-900">{t('partneradmin.discount_at', { name: partner.name })}</p>
            <div className="mt-3 space-y-1.5 text-[13.5px]">
              <p className="flex justify-between gap-3"><span className="text-muted">{t('partneradmin.prize')}</span>
                <span className="text-right font-bold text-ink-900">{[t('partner.place', { place: preview.prize_place }), new Date(`${String(preview.prize_month).slice(0, 10)}T12:00:00`).toLocaleDateString(loc, { month: 'long' }), preview.prize_district || partner.district].filter(Boolean).join(' · ')}</span></p>
              <p className="flex justify-between gap-3"><span className="text-muted">{t('partneradmin.valid_until_label')}</span>
                <span className="font-bold text-ink-900">{dayMonth(asDate(preview.valid_until), loc, true)}</span></p>
            </div>
          </div>
          <button type="button" onClick={confirm} disabled={busy}
            className="mt-4 flex min-h-[52px] w-full items-center justify-center rounded-ctrl bg-ink-900 font-extrabold text-white disabled:opacity-60">
            {t('partneradmin.mark_used')}
          </button>
        </>
      )}
      <button type="button" onClick={onClose}
        className="mt-2 flex min-h-[52px] w-full items-center justify-center rounded-ctrl border-[1.5px] border-ink-200 bg-white font-extrabold text-ink-900">
        {t('steps.cancel')}
      </button>
    </Sheet>
  )
}

/* «Ficha»: a capa e o logótipo trocam-se como no clube; cada campo é uma
   linha que abre uma folha só para esse campo (SPEC ponto 6: nada de
   formulário comprido). */
function ProfileTab({ partner, onSaved }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(null)
  const [imgError, setImgError] = useState('')
  const coverInput = useRef(null)
  const logoInput = useRef(null)

  const valueOf = (f) => (f === 'phones' ? (partner.phones || []).join(' · ') : f === 'instagram_url' && partner.instagram_url
    ? `@${partner.instagram_url.replace(/\/$/, '').split('/').pop()}`
    : f === 'website_url' && partner.website_url ? partner.website_url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
    : partner[f]) || ''

  const pickImage = async (kind, file) => {
    setImgError('')
    const problem = imageProblem(file)
    if (problem) { setImgError(t(`partneradmin.img_${problem}`)); return }
    try {
      const url = await uploadPartnerImage(partner.id, file, kind)
      onSaved(await updatePartnerProfile(partner.id, { [kind === 'logo' ? 'logo_url' : 'cover_url']: url }))
    } catch {
      setImgError(t('partneradmin.img_failed'))
    }
  }

  return (
    <div className="space-y-4">
      <div className="relative h-32 overflow-hidden rounded-card bg-[#2E6B45]">
        {partner.cover_url && <img src={partner.cover_url} alt="" className="absolute inset-0 h-full w-full object-cover object-[50%_12%]" />}
        <button type="button" onClick={() => coverInput.current?.click()}
          className="absolute right-3 top-3 rounded-full bg-white px-3 py-1.5 text-[13px] font-extrabold text-ink-900 shadow-card">{t('partneradmin.change_cover')}</button>
        <span className="absolute bottom-3 left-3 rounded-[28%] bg-white p-[3px]"><PartnerLogo partner={partner} /></span>
      </div>
      <button type="button" onClick={() => logoInput.current?.click()} className="text-[14px] font-extrabold text-ink-900 underline underline-offset-2">{t('partneradmin.change_logo')}</button>
      <input ref={coverInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => pickImage('cover', e.target.files?.[0])} />
      <input ref={logoInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => pickImage('logo', e.target.files?.[0])} />
      {imgError && <p className="rounded-ctrl bg-[#FDE8E6] px-3.5 py-2.5 text-[14px] font-bold text-[#B42318]">{imgError}</p>}

      <section>
        <p className="mb-2 font-mono text-[11px] font-bold uppercase tracking-widest text-ink-500">{t('partneradmin.what_shows')}</p>
        <div className="overflow-hidden rounded-card bg-white shadow-[0_1px_2px_rgba(17,17,17,0.06)]">
          {FIELDS.map((f) => (
            <button key={f} type="button" onClick={() => setEditing(f)}
              className="press flex w-full items-center gap-3 border-b border-line px-3.5 py-3 text-left last:border-b-0">
              <span className="min-w-0 flex-1">
                <span className="block font-display text-[15px] font-extrabold text-ink-900">{t(`partneradmin.field_${f}`)}</span>
                <span className="block truncate text-[13px] text-muted">{valueOf(f) || t('partneradmin.empty')}</span>
              </span>
              <ChevronRight size={16} className="shrink-0 text-ink-500" />
            </button>
          ))}
        </div>
      </section>

      <button type="button" onClick={() => navigate(`/parceiro/${partner.slug}`)}
        className="flex min-h-[52px] w-full items-center justify-center rounded-ctrl border-[1.5px] border-ink-200 bg-white font-extrabold text-ink-900">
        {t('partneradmin.see_page')}
      </button>

      {editing && <FieldSheet field={editing} partner={partner} onClose={() => setEditing(null)} onSaved={(p) => { setEditing(null); onSaved(p) }} />}
    </div>
  )
}

function FieldSheet({ field, partner, onClose, onSaved }) {
  const { t } = useTranslation()
  const phones = field === 'phones'
  const [value, setValue] = useState(phones ? [...(partner.phones || []), '', ''].slice(0, 2) : (partner[field] || ''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const v = phones ? value.map((x) => x.trim()).filter(Boolean) : value.trim()
      onSaved(await updatePartnerProfile(partner.id, { [field]: phones ? v : v }))
    } catch (e) {
      const k = String(e?.message || '')
      setError(t(k.includes('bad_email') ? 'partneradmin.err_bad_email' : k.includes('bad_url') ? 'partneradmin.err_bad_url' : k.includes('too_long') ? 'partneradmin.err_too_long' : 'partneradmin.err_save'))
    } finally {
      setBusy(false)
    }
  }
  const box = 'w-full rounded-ctrl border-[1.5px] border-ink-200 bg-white px-4 py-3 text-[16px] text-ink-900 outline-none focus:border-ink-900'
  return (
    <Sheet title={t(`partneradmin.field_${field}`)} onClose={onClose}>
      {phones ? (
        <div className="space-y-2">
          {value.map((v, i) => (
            <input key={i} value={v} inputMode="tel" onChange={(e) => setValue(value.map((x, j) => (j === i ? e.target.value : x)))}
              aria-label={t('partneradmin.phone_n', { n: i + 1 })} className={box} />
          ))}
        </div>
      ) : field === 'tagline' ? (
        <textarea value={value} onChange={(e) => setValue(e.target.value)} rows={3} aria-label={t(`partneradmin.field_${field}`)} className={box} />
      ) : (
        <input value={value} onChange={(e) => setValue(e.target.value)} aria-label={t(`partneradmin.field_${field}`)}
          inputMode={field === 'email' ? 'email' : field.endsWith('_url') ? 'url' : 'text'} className={box} />
      )}
      {field === 'instagram_url' && <p className="mt-2 text-[13px] text-muted">{t('partneradmin.instagram_hint')}</p>}
      {error && <p className="mt-3 rounded-ctrl bg-[#FDE8E6] px-3.5 py-2.5 text-[14px] font-bold text-[#B42318]">{error}</p>}
      <button type="button" onClick={save} disabled={busy}
        className="mt-4 flex min-h-[52px] w-full items-center justify-center rounded-ctrl bg-ink-900 font-extrabold text-white disabled:opacity-60">
        {t('partneradmin.save')}
      </button>
    </Sheet>
  )
}
