// Avisos do torneio no sino (Trello #548). Vêm da mesma tabela
// `notifications` dos avisos de mix e de aulas, com o que o ecrã precisa em
// `data` (migration_tournament_suplente_aviso.sql, Dev 3).
//
// 'tournament_promoted': era suplente e subiu para dentro (alguém desistiu,
// uma vaga abriu). Antes ninguém lhe dizia — só dava conta quem voltasse à
// página do torneio. O parceiro que ainda tem de aceitar não recebe este
// aviso: já vê o convite no sino.
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Trophy } from 'lucide-react'
import { TOURNAMENT_TZ } from '../../lib/tournamentDay'

//
// 'tournament_correction_requested' (Trello #485, Dev 2): um jogador pediu a
// correção de um resultado; vai aos admins do torneio, que aceitam ou
// recusam no /marcar. O aviso leva direto a esse ecrã.
export const TOURNAMENT_NOTICE_KINDS = ['tournament_promoted', 'tournament_correction_requested']

/** «qui, 2 out» — o dia até ao qual o parceiro tem de aceitar, na hora do
 *  torneio. */
function dayOf(iso, locale) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const part = (opts) => d.toLocaleDateString(locale, { ...opts, timeZone: TOURNAMENT_TZ }).replace(/\./g, '')
  return `${part({ weekday: 'short' })}, ${part({ day: 'numeric' })} ${part({ month: 'short' })}`
}

export default function TournamentNoticeRow({ notice, onOpen }) {
  const { t, i18n } = useTranslation()
  const d = notice.data || {}
  const vars = {
    tournament: d.tournament_name || '',
    code: d.category_code || d.category_name || '',
    partner: d.partner_name || '',
    day: dayOf(d.respond_by, i18n.language),
    name: d.requester_name || '',
  }
  const correction = notice.kind === 'tournament_correction_requested'
  // Texto aprovado pelo Francisco (via PO, 25 set) — não mudar.
  const text = correction
    ? t('tournament.notice_correction_requested', vars)
    : d.partner_pending
    ? t('tournament.notice_promoted_partner_pending', vars)
    : t('tournament.notice_promoted', vars)
  const page = d.tournament_slug || d.tournament_id ? `/torneio/${d.tournament_slug || d.tournament_id}` : null
  const to = page ? (correction ? `${page}/marcar` : page) : '/'
  return (
    <Link to={to} onClick={() => onOpen(notice)}
      className="flex items-center gap-3 px-4 py-3 transition-colors duration-fast hover:bg-ink-50">
      <div className="w-9 h-9 rounded-full bg-[#E9E7FB] text-[#4338A8] flex items-center justify-center shrink-0">
        <Trophy size={16} />
      </div>
      <p className="flex-1 min-w-0 text-sm text-ink-900">{text}</p>
      <span aria-hidden="true" className="w-2 h-2 rounded-full bg-lime-400 shrink-0" />
    </Link>
  )
}
