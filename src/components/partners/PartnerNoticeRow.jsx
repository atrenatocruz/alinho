// Os avisos dos parceiros no sino (Dev 3, migration_parceiros_3; UX, 22 out):
//   · partner_month_vouchers, para quem gere o parceiro: «Os códigos de
//     novembro saíram» / «3 códigos para a RM Terapias. Vê-os em Gerir › RM
//     Terapias.», que abre os Códigos;
//   · partner_prize_won, para quem ganhou: abre os Vouchers do Perfil.
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export const PARTNER_NOTICE_KINDS = ['partner_month_vouchers', 'partner_prize_won']

const monthName = (month, lang) => (month
  ? new Date(`${String(month).slice(0, 10)}T12:00:00`).toLocaleDateString(lang?.startsWith('en') ? 'en-GB' : lang?.startsWith('es') ? 'es-ES' : 'pt-PT', { month: 'long' })
  : '')

export default function PartnerNoticeRow({ notice, onOpen }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const d = notice.data || {}
  const manager = notice.kind === 'partner_month_vouchers'
  const vars = {
    month: monthName(manager ? d.month : d.prize_month, i18n.language), name: d.partner_name || '',
    count: d.issued ?? 0, place: d.prize_place, pct: d.discount_pct,
  }
  const to = manager ? (d.partner_slug ? `/gerir/parceiro/${d.partner_slug}` : '/gerir') : '/perfil?tab=vouchers'
  return (
    <button type="button" className="flex min-h-[52px] w-full items-center gap-3 px-3.5 py-2.5 text-left"
      onClick={() => { onOpen?.(notice); navigate(to) }}>
      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-lime-400" />
      <span className="min-w-0 text-sm text-ink-900">
        <span className="block font-extrabold">{t(`notif.${notice.kind}_title`, vars)}</span>
        <span className="block text-ink-700">{t(`notif.${notice.kind}_line`, vars)}</span>
      </span>
    </button>
  )
}
