// As janelas dos prémios dos parceiros (design-handoff/2026-10-22-premios-
// parceiros-avisos, aprovado pelo Francisco a 26 out):
//   1. Início do mês: «Prémios de novembro», com o parceiro, a zona e as três
//      percentagens. Uma vez por pessoa e por mês (get_my_month_prize_offers;
//      ao fechar, mark_month_prize_offer_seen deixa-a no sino, já lida).
//   2. A quem ganhou: o Alino do troféu, o lugar, o desconto e a medalha
//      «Pódio do Mês» dentro da mesma janela (a celebração da conquista não
//      abre a seguir; quem a corta é o Layout).
// Uma janela de cada vez, nunca por cima de outra folha nem de um jogo.
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Trans, useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { useNoOverlayOpen } from '../../lib/useNoOverlayOpen'
import Alino from '../Alino'

const OFFERS_CHECKED_KEY = 'monthPrizeOffersChecked'
const wonShownKey = (id) => `prizeWonShown:${id}`

// Páginas de um jogo: a janela espera que a pessoa saia delas.
const GAME_PATHS = /^\/(jogo|torneio|liga|jogos-privados|m)\//

const localeOf = (lang) => (lang?.startsWith('en') ? 'en-GB' : lang?.startsWith('es') ? 'es-ES' : 'pt-PT')
const asDate = (d) => new Date(`${String(d).slice(0, 10)}T12:00:00`)
export const monthLabel = (month, lang) => (month ? asDate(month).toLocaleDateString(localeOf(lang), { month: 'long' }) : '')
const dayMonth = (d, lang) => (d
  ? `${asDate(d).getDate()} ${asDate(d).toLocaleDateString(localeOf(lang), { month: 'short' }).replace('.', '')}`
  : '')
// «Desconto numa massagem desportiva» → «numa massagem desportiva» (a frase
// já diz «desconto»). Sem descrição, a frase fica sem o «em quê».
// A descrição só existe em português na ficha do parceiro: noutra língua a
// frase diz só «desconto».
export const prizeWhat = (description, lang) => (lang && !lang.startsWith('pt') ? ''
  : String(description || '').trim().replace(/^desconto\s+/i, ''))

const POS = { 1: 'bg-[#F5C518]', 2: 'bg-[#C9CDD3]', 3: 'bg-[#D9A066]' }

function Shell({ children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/55 px-4 animate-fade-in" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-[22px] bg-white px-4 pb-4 pt-[18px] shadow-lift animate-pop" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

function Buttons({ main, onMain, onClose }) {
  const { t } = useTranslation()
  return (
    <>
      <button type="button" onClick={onMain}
        className="press mt-3 flex min-h-[46px] w-full items-center justify-center rounded-ctrl bg-ink-900 font-display text-[15px] font-extrabold text-white">
        {main}
      </button>
      <button type="button" onClick={onClose}
        className="press mt-2 flex min-h-[46px] w-full items-center justify-center rounded-ctrl border-[1.5px] border-[#D7D9D2] bg-white font-display text-[15px] font-extrabold text-ink-900">
        {t('prizewin.close')}
      </button>
    </>
  )
}

export function MonthOfferWindow({ offer, onSee, onClose }) {
  const { t, i18n } = useTranslation()
  const what = prizeWhat(offer.prizes?.[0]?.description, i18n.language)
  const vars = { name: offer.partner_name, zone: offer.district, what }
  return (
    <Shell onClose={onClose}>
      <div className="flex items-center gap-2 text-[11.5px] font-bold text-muted">
        {offer.logo_url && <img src={offer.logo_url} alt="" className="h-[26px] w-[26px] rounded-[7px] object-cover" />}
        {t('prizewin.offer_with', { name: offer.partner_name })}
      </div>
      <h3 className="mt-3 mb-1.5 font-display text-[21px] font-extrabold leading-[1.1] text-ink-900">
        {t('prizewin.offer_title', { month: monthLabel(offer.month, i18n.language) })}
      </h3>
      <p className="text-[13px] leading-[1.45] text-ink-700">{t(what ? 'prizewin.offer_text_what' : 'prizewin.offer_text', vars)}</p>
      <div className="mt-3 rounded-xl bg-[#F4F5F1] px-3 py-1.5">
        {(offer.prizes || []).map((p) => (
          <div key={p.place} className="flex items-center justify-between border-b border-[#E7E8E3] py-1.5 text-[13px] font-semibold text-ink-900 last:border-0">
            <span className="flex items-center">
              <span aria-hidden="true" className={`mr-2 grid h-[22px] w-[22px] place-items-center rounded-full font-display text-[11px] font-extrabold ${POS[p.place] || 'bg-white'}`}>{p.place}</span>
              {t('partner.place', { place: p.place })}
            </span>
            <b className="font-display text-[14px] font-extrabold tabular-nums">{p.discount_pct}%</b>
          </div>
        ))}
      </div>
      <Buttons main={t('prizewin.see_ranking')} onMain={onSee} onClose={onClose} />
    </Shell>
  )
}

export function PrizeWonWindow({ notice, onSee, onClose }) {
  const { t, i18n } = useTranslation()
  const d = notice.data || {}
  const what = prizeWhat(d.description, i18n.language)
  const vars = {
    place: d.prize_place, month: monthLabel(d.prize_month, i18n.language), zone: d.prize_district || '',
    pct: d.discount_pct, what, name: d.partner_name || '', until: dayMonth(d.valid_until, i18n.language),
  }
  return (
    <Shell onClose={onClose}>
      <div className="text-center">
        <Alino pose="trofeu" size={150} className="-mt-1.5" />
        <h3 className="mt-1 mb-1.5 font-display text-[21px] font-extrabold leading-[1.1] text-ink-900">{t('prizewin.won_title', vars)}</h3>
        <p className="text-[13px] leading-[1.45] text-ink-700">
          <Trans i18nKey={d.prize_district ? (what ? 'prizewin.won_text_what' : 'prizewin.won_text') : (what ? 'prizewin.won_text_what_nozone' : 'prizewin.won_text_nozone')}
            values={vars} components={{ b: <b className="text-ink-900" /> }} />
        </p>
        <div className="mt-3 flex items-center gap-2.5 rounded-xl bg-[#F4F5F1] px-2.5 py-2 text-left">
          <img src="/medalhas/podio_do_mes.webp" alt="" className="h-[46px] w-[46px]" />
          <span>
            <b className="block font-display text-[13.5px] font-extrabold text-ink-900">{t('achievements.podio_do_mes_name')}</b>
            <span className="text-[11.5px] text-muted">{t('prizewin.medal_new')}</span>
          </span>
        </div>
      </div>
      <Buttons main={t('prizewin.see_voucher')} onMain={onSee} onClose={onClose} />
    </Shell>
  )
}

/** Mostra as janelas. `wonNotices`: os avisos partner_prize_won por ler.
    `onBusy(true)` enquanto houver uma janela por mostrar (o Layout segura a
    celebração das conquistas até lá). */
export default function PartnerPrizeWindows({ profileId, wonNotices, blocked, onBusy }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [offers, setOffers] = useState([])
  const [shownIds, setShownIds] = useState(() => new Set())

  useEffect(() => {
    if (!profileId) return
    try { if (sessionStorage.getItem(OFFERS_CHECKED_KEY) === profileId) return } catch { /* sem storage */ }
    supabase.rpc('get_my_month_prize_offers').then(({ data, error }) => {
      try { sessionStorage.setItem(OFFERS_CHECKED_KEY, profileId) } catch { /* sem storage */ }
      if (error) return // sem a migração, não há janela
      if (Array.isArray(data) && data.length) setOffers(data)
    })
  }, [profileId])

  const won = useMemo(() => (wonNotices || []).filter((n) => {
    if (shownIds.has(n.id)) return false
    try { return !localStorage.getItem(wonShownKey(n.id)) } catch { return true }
  }), [wonNotices, shownIds])

  // A quem ganhou primeiro; depois a do início do mês.
  const next = won[0] ? { kind: 'won', item: won[0] } : offers[0] ? { kind: 'offer', item: offers[0] } : null
  const pending = Boolean(next)
  useEffect(() => { onBusy?.(pending) }, [pending, onBusy])

  const onGame = GAME_PATHS.test(location.pathname)
  const free = useNoOverlayOpen(pending && !blocked && !onGame)
  const [open, setOpen] = useState(null)
  useEffect(() => {
    if (!open && next && free && !blocked && !onGame) setOpen(next)
  }, [open, next, free, blocked, onGame])

  if (!open) return null

  const close = () => {
    if (open.kind === 'won') {
      // Fica no sino por ler; a janela não volta.
      try { localStorage.setItem(wonShownKey(open.item.id), '1') } catch { /* sem storage */ }
      setShownIds((s) => new Set(s).add(open.item.id))
    } else {
      supabase.rpc('mark_month_prize_offer_seen', { p_partner_id: open.item.partner_id }).then(({ error }) => {
        if (error) console.error('Error marking prize offer seen:', error)
      })
      // Pelo parceiro, não pelo objeto: em dev o StrictMode pede a lista
      // duas vezes e a segunda resposta traz objetos novos.
      setOffers((list) => list.filter((o) => o.partner_id !== open.item.partner_id))
    }
    setOpen(null)
  }

  if (open.kind === 'won') {
    return <PrizeWonWindow notice={open.item} onClose={close}
      onSee={() => { close(); navigate('/perfil?tab=vouchers') }} />
  }
  return <MonthOfferWindow offer={open.item} onClose={close}
    onSee={() => { close(); navigate('/rankings', { state: { tab: 'do-mes', scope: `district:${open.item.district}`, scale: 'all' } }) }} />
}
