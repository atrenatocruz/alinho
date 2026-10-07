// «Vouchers» — a lista do admin do clube (#406; design-handoff/2026-09-26-
// vouchers, assunto 2, aprovado pelo Francisco). Abre no ícone do QR no topo
// do Gerir, que antes ia direto ao «Validar voucher»: esse continua igual,
// atrás do «Ler QR code».
//
// O email e o telemóvel só aparecem de quem aceitou partilhar (#556, assunto
// 1). O «Dar baixa» é para todos (Francisco, 27 set).
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { QrCode } from 'lucide-react'
import { Avatar, Chips, ConfirmSheet, Select } from '../ui'
import { listClubVouchers, redeemVoucher, voucherTotals, voucherWithoutAccount } from '../../lib/vouchers'
import { describeError } from '../../lib/errors'

const FILTERS = ['all', 'por_usar', 'usado']
// «Por dia · Por pessoa» (Francisco, 7 out — SPEC pontos 5 a 8). A mesma
// lista, arrumada de outra forma: pastilhas soltas, abre em «Por dia».
const VIEWS = ['day', 'person']

// Quem é a mesma pessoa: pelo id, quando a função o devolver; até lá pelo
// nome e pelo email partilhado.
const personKey = (v) => v.user_id || `${v.player_name || ''}|${v.email || ''}`

// `initialFilter`: o botão «Vouchers» do topo do Gerir abre já em «Por usar»
// (Francisco, 7 out). `onUnusedChange`: o número do botão desce ao dar baixa.
export default function VouchersAdmin({ organizationId, onScan, initialFilter = 'all', onUnusedChange }) {
  const { t, i18n } = useTranslation()
  const [rows, setRows] = useState(null) // null = a carregar
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState(initialFilter)
  const [mix, setMix] = useState('all')
  const [view, setView] = useState('day')
  const [personOpen, setPersonOpen] = useState(null) // a chave da pessoa com a folha aberta
  const [ask, setAsk] = useState(null) // o voucher a dar baixa
  const [toast, setToast] = useState('')
  useEffect(() => {
    if (!toast) return undefined
    const id = setTimeout(() => setToast(''), 3000)
    return () => clearTimeout(id)
  }, [toast])

  const load = () => {
    if (!organizationId) return
    listClubVouchers(organizationId)
      .then(({ rows: list, consent: live }) => { setRows(list); setConsent(live); setError('') })
      .catch((err) => { console.error('Error loading club vouchers:', err); setRows([]); setError(describeError(t, err)) })
  }
  useEffect(load, [organizationId]) // eslint-disable-line react-hooks/exhaustive-deps

  // «ter 29 set» e «30 set», como no desenho.
  const fmt = (iso, opts) => (iso ? new Intl.DateTimeFormat(i18n.language, { timeZone: 'Europe/Lisbon', ...opts })
    .format(new Date(iso)).replace(/\./g, '').replace(/ de /g, ' ').replace(',', '') : '')
  const day = (iso) => fmt(iso, { weekday: 'short', day: 'numeric', month: 'short' })
  const shortDay = (iso) => fmt(iso, { day: 'numeric', month: 'short' })

  const list = rows || []
  const totals = voucherTotals(list)
  useEffect(() => { if (rows) onUnusedChange?.(totals.unused) }, [rows]) // eslint-disable-line react-hooks/exhaustive-deps
  const mixes = useMemo(() => {
    const seen = new Map()
    for (const v of list) if (v.game_id && !seen.has(v.game_id)) seen.set(v.game_id, `${v.game_title || '—'} · ${day(v.game_date)}`)
    return [...seen.entries()].map(([value, label]) => ({ value, label }))
  }, [rows]) // eslint-disable-line react-hooks/exhaustive-deps
  const shown = list
    .filter((v) => filter === 'all' || v.status === filter)
    .filter((v) => mix === 'all' || v.game_id === mix)

  const newestFirst = (a, b) => new Date(b.game_date || 0) - new Date(a.game_date || 0)

  // Por dia: um grupo por mix (dia + nome), do mais recente para o mais antigo.
  const byDay = useMemo(() => {
    const groups = new Map()
    for (const v of [...shown].sort(newestFirst)) {
      const key = v.game_id || v.game_date || '—'
      if (!groups.has(key)) {
        groups.set(key, { key, label: [day(v.game_date), v.game_title].filter(Boolean).join(' · '), items: [] })
      }
      groups.get(key).items.push(v)
    }
    return [...groups.values()]
  }, [shown]) // eslint-disable-line react-hooks/exhaustive-deps

  // Por pessoa: quem tem mais por usar primeiro, depois por nome. Com o
  // filtro «Por usar», só quem ainda tem algum (o `shown` já vem filtrado).
  const people = useMemo(() => {
    const map = new Map()
    for (const v of shown) {
      const key = personKey(v)
      if (!map.has(key)) map.set(key, { key, name: v.player_name, contact: '', sharedAt: null, items: [], unused: 0, used: 0 })
      const p = map.get(key)
      p.items.push(v)
      if (v.status === 'por_usar') p.unused += 1
      else p.used += 1
      const contact = v.contact_shared_at ? [v.email, v.phone].filter(Boolean).join(' · ') : ''
      if (contact && !p.contact) { p.contact = contact; p.sharedAt = v.contact_shared_at }
    }
    for (const p of map.values()) p.items.sort(newestFirst)
    return [...map.values()].sort((a, b) => (b.unused - a.unused) || String(a.name || '').localeCompare(String(b.name || ''), 'pt'))
  }, [shown])
  const byPerson = people
  const openPerson = personOpen ? people.find((p) => p.key === personOpen) || null : null

  // «Dar baixa» sempre, também a quem não aceitou partilhar e a convidados
  // sem conta («não queremos obrigar a ter a app», Francisco, 27 set). O
  // contacto continua a aparecer só de quem aceitou.
  const canRedeem = (v) => v.status === 'por_usar'

  // Um voucher. «Dar baixa» em contorno (SPEC ponto 8): o preto fica só na
  // confirmação. Na folha da pessoa o nome já está no título: mostra o mix,
  // o dia e o prémio; os usados a cinzento e sem botão.
  const VoucherCard = ({ v, inSheet = false }) => {
    const used = v.status === 'usado'
    const noAccount = voucherWithoutAccount(v)
    const contact = [v.email, v.phone].filter(Boolean).join(' · ')
    return (
      <div className={`card space-y-2 ${inSheet && used ? 'opacity-60' : ''}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-extrabold text-ink-900">{inSheet ? (v.game_title || '—') : (v.player_name || '—')}</p>
            <p className="truncate text-xs text-muted">
              {(inSheet ? [day(v.game_date), v.prize] : [v.game_title, day(v.game_date)]).filter(Boolean).join(' · ')}
            </p>
            {noAccount && <p className="mt-1 text-xs text-warning">{t('vouchers.no_account')}</p>}
          </div>
          {used
            ? <span className="shrink-0 rounded-full bg-ink-50 px-2 py-[3px] text-[11px] font-extrabold text-muted">{t('vouchers.used_on', { date: shortDay(v.used_at) })}</span>
            : <span className="shrink-0 rounded-full bg-ink-900 px-2 py-[3px] text-[11px] font-extrabold text-white">{t('vouchers.unused')}</span>}
        </div>
        {consent && !inSheet && !noAccount && (
          <div className="border-t border-line pt-2">
            {v.contact_shared_at ? (
              <>
                {contact && <p className="text-sm text-ink-900">{contact}</p>}
                <p className="text-xs text-muted">{t('vouchers.shared_on', { date: shortDay(v.contact_shared_at) })}</p>
              </>
            ) : (
              <p className="text-sm text-muted">{t('vouchers.not_shared')}</p>
            )}
          </div>
        )}
        {canRedeem(v) && (
          <button type="button" onClick={() => setAsk(v)}
            className="inline-flex min-h-[48px] w-full items-center justify-center rounded-ctrl border-[1.5px] border-ink-900 bg-white px-5 text-base font-extrabold text-ink-900">
            {t('vouchers.redeem')}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h3 className="text-xl font-semibold text-ink-900">{t('vouchers.title')}</h3>

      {/* Os totais, do clube todo. */}
      <div className="grid grid-cols-3 gap-2">
        {[[totals.given, 'vouchers.total_given'], [totals.unused, 'vouchers.total_unused'], [totals.used, 'vouchers.total_used']].map(([n, key]) => (
          <div key={key} className="card !p-3">
            <b className="block font-display text-2xl font-extrabold leading-none text-ink-900">{rows ? n : '–'}</b>
            <span className="text-xs text-muted">{t(key)}</span>
          </div>
        ))}
      </div>

      {/* O validar de hoje, sem mudanças. */}
      <button type="button" onClick={onScan} className="btn-secondary w-full inline-flex items-center justify-center gap-2">
        <QrCode size={18} /> {t('vouchers.scan')}
      </button>

      {error && <p className="rounded-ctrl border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-extrabold text-danger">{error}</p>}

      {rows && list.length === 0 ? (
        <div className="card text-center">
          <p className="font-display text-lg font-extrabold text-ink-900">{t('vouchers.empty_title')}</p>
          <p className="mt-1 text-sm text-muted">{t('vouchers.empty_subtitle')}</p>
        </div>
      ) : rows && (
        <>
          <Chips value={view} onChange={setView} label={t('vouchers.view_label')}
            options={VIEWS.map((v) => ({ value: v, label: t(`vouchers.view_${v}`) }))} />
          <Chips value={filter} onChange={setFilter} label={t('vouchers.filter_label')}
            options={FILTERS.map((f) => ({ value: f, label: t(`vouchers.filter_${f}`) }))} />
          {mixes.length > 1 && (
            <Select value={mix} onChange={setMix}
              options={[{ value: 'all', label: t('vouchers.all_mixes') }, ...mixes]} />
          )}

          {view === 'day' ? (
            // Por dia: debaixo do dia do mix, do mais recente para o mais antigo.
            <div className="space-y-4">
              {byDay.map((group) => (
                <div key={group.key} className="space-y-2">
                  <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted">{group.label}</p>
                  {group.items.map((v) => <VoucherCard key={v.voucher_id} v={v} />)}
                </div>
              ))}
            </div>
          ) : (
            // Por pessoa: uma linha por pessoa; tocar abre a folha dela.
            <div className="space-y-2">
              {byPerson.map((p) => (
                <button key={p.key} type="button" onClick={() => setPersonOpen(p.key)}
                  className="card flex w-full items-center gap-3 text-left">
                  <Avatar name={p.name} size="w-10 h-10 text-sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-extrabold text-ink-900">{p.name || '—'}</span>
                    <span className="block truncate text-xs text-muted">{p.contact || t('vouchers.no_contact')}</span>
                  </span>
                  <span className={`shrink-0 text-sm font-extrabold ${p.unused ? 'text-ink-900' : 'text-muted'}`}>
                    {p.unused ? t('vouchers.person_unused', { count: p.unused }) : t('vouchers.person_used', { count: p.used })}
                  </span>
                  <span aria-hidden className="shrink-0 text-ink-500">›</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {openPerson && createPortal(
        <div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/50 animate-fade-in sm:items-center sm:p-4"
          onClick={() => setPersonOpen(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="voucher-person-title"
            className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-[24px] bg-white px-5 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+20px)] shadow-lift sm:rounded-[24px]"
            onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-ink-200" />
            <p id="voucher-person-title" className="text-[20px] font-extrabold leading-tight text-ink-900">{openPerson.name || '—'}</p>
            <p className="mt-1 text-sm text-muted">
              {openPerson.contact
                ? [openPerson.contact, openPerson.sharedAt && t('vouchers.shared_on', { date: shortDay(openPerson.sharedAt) })].filter(Boolean).join(' · ')
                : t('vouchers.no_contact')}
            </p>
            <div className="mt-4 space-y-2">
              {openPerson.items.map((v) => <VoucherCard key={v.voucher_id} v={v} inSheet />)}
            </div>
          </div>
        </div>,
        document.body,
      )}

      <ConfirmSheet
        open={!!ask}
        title={ask ? t('vouchers.redeem_title', { name: ask.player_name || '—' }) : ''}
        message={ask ? `${[ask.game_title, day(ask.game_date), ask.prize].filter(Boolean).join(' · ')}. ${t('vouchers.redeem_body')}` : ''}
        confirmLabel={t('vouchers.redeem')}
        cancelLabel={t('common.back')}
        errorOf={(err) => describeError(t, err, 'gerirclube.redeem_confirm_error')}
        onConfirm={async () => {
          const v = ask
          await redeemVoucher(v.voucher_id)
          setRows((prev) => prev.map((x) => (x.voucher_id === v.voucher_id ? { ...x, status: 'usado', used_at: new Date().toISOString() } : x)))
          setToast(t('vouchers.redeemed', { name: v.player_name || '—' }))
        }}
        onClose={() => setAsk(null)}
      />

      {toast && createPortal(
        <div role="status" className="fixed top-4 left-1/2 z-[60] -translate-x-1/2 w-max max-w-[calc(100vw-32px)] rounded-full bg-ink-900 px-4 py-2.5 text-sm font-extrabold text-white shadow-lift animate-fade-in">
          {toast}
        </div>,
        document.body,
      )}
    </div>
  )
}
