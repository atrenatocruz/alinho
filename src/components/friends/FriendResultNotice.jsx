// O aviso no sino quando alguém envia o resultado de um jogo entre amigos
// (SPEC 2026-10-09-amigos-o-fim, pontos 5 e 6): «<Nome> enviou o resultado
// do jogo entre amigos de <dia>: ganhaste 3 rondas a 1.», com «Está certo»
// (preto) e «Não está certo» (contorno), empilhados, no próprio aviso. «Está
// certo» não é obrigatório: sem resposta, conta. «Não está certo» abre a
// folha «O que não está certo?» com as rondas do jogo.
// Dados (Dev 3): 'friend_match_result_sent' { match_id, sender_name,
// scheduled_date, my_rounds, their_rounds, outcome: 'won'|'lost'|'draw' }.
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Trophy } from 'lucide-react'
import FriendResultButtons from './FriendResultButtons'
import { shortName } from './friendShare'
import { dayText } from './dayText'

/** «ganhaste 3 rondas a 1.» — as rondas de quem lê, a partir do aviso. Com
 *  vários pares de duplas, ganhas e perdidas (UX, 10 out): «ganhaste 2
 *  rondas e perdeste 2.». Também na página do jogo (UX, 13 out). */
export function resultHow(t, d) {
  const multi = (d.pairs_count || 1) > 1
  return multi
    ? (d.my_rounds === d.their_rounds && d.outcome === 'draw' ? t('friends.notice_result_draw_multi')
      : t('friends.notice_result_mixed', { count: d.my_rounds ?? 0, lost: d.their_rounds ?? 0 }))
    : d.outcome === 'draw' ? t('friends.notice_result_draw')
      : t(d.outcome === 'won' ? 'friends.notice_result_won' : 'friends.notice_result_lost', { count: d.my_rounds ?? 0, b: d.their_rounds ?? 0 })
}

export default function FriendResultNotice({ notice, onOpen }) {
  const { t, i18n } = useTranslation()
  const d = notice.data || {}
  const day = d.scheduled_date ? dayText(d.scheduled_date, i18n.language).toLocaleLowerCase(i18n.language) : ''
  const how = resultHow(t, d)

  return (
    <div className="space-y-2.5 px-4 py-3">
      <Link to={`/jogos-privados/sessao/${d.match_id}`} onClick={() => onOpen(notice, { keep: true })} className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-lime-100 text-ink-900"><Trophy size={16} /></span>
        <span className="min-w-0 flex-1 text-sm text-ink-900">
          {t('friends.notice_result_sent', { name: shortName(d.sender_name || ''), day })} {how}
        </span>
        <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-lime-400" />
      </Link>
      <FriendResultButtons matchId={d.match_id} senderName={d.sender_name} onDone={() => onOpen(notice)} />
    </div>
  )
}
