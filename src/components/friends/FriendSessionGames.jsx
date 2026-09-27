// Os jogos da sessão, todos pela ordem (amigos sem bloquear, UX 27 set): os
// registados com o resultado e «Conta para o ranking quando confirmarem:
// <nomes>»; os por marcar com «Marcar resultado». Com pessoas por responder,
// a caixa cinzenta e «↗ Partilhar com quem falta». Por baixo, «Marcar o
// próximo» e, quando a rotação acaba, «Juntar mais um jogo».
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Share2 } from 'lucide-react'
import FriendResultSheet from './FriendResultSheet'
import AddGameSheet from './AddGameSheet'
import { shareWithMissing, sessionLink, shortName } from './friendShare'
import { dayText } from './dayText'

const hasScore = (g) => g.score_a != null && g.score_b != null
const pair = (team) => (team || []).map((p) => shortName(p.name)).join(' / ')

export function ShareMissingButton({ match, creatorName }) {
  const { t, i18n } = useTranslation()
  const text = t('friends.share_text', {
    name: creatorName || '', day: dayText(match.scheduled_date, i18n.language), link: sessionLink(match.id),
  })
  return (
    <div>
      <button type="button" onClick={() => shareWithMissing(text)}
        className="press flex min-h-[48px] w-full items-center justify-center gap-2 rounded-ctrl border-[1.5px] border-line bg-white px-4 text-[15px] font-extrabold text-ink-900">
        <Share2 size={16} /> {t('friends.share_missing')}
      </button>
      <p className="mt-1.5 text-center text-xs text-muted">{t('friends.share_missing_hint')}</p>
    </div>
  )
}

export default function FriendSessionGames({ match, games, invitees, players, iAmCreator, myUserId, onChanged, resultFor, setResultFor }) {
  const { t } = useTranslation()
  const [adding, setAdding] = useState(false)
  const pending = invitees.filter((i) => i.status === 'pending').length
  const creator = invitees.find((i) => i.is_creator)
  const me = invitees.find((i) => i.user_id && i.user_id === myUserId)
  // Pode marcar: quem criou, ou um jogador com conta desse jogo que aceitou.
  const canRecord = (g) => iAmCreator || (me?.status === 'accepted'
    && [...(g.team_a || []), ...(g.team_b || [])].some((p) => p.user_id === myUserId))
  const next = games.find((g) => !hasScore(g) && canRecord(g))

  return (
    <div className="space-y-3">
      {games.map((g) => (hasScore(g) ? (
        // Um resultado corrige-se enquanto não contou (editar e sets, 27 set).
        <div key={g.id} className={`rounded-card border border-line bg-white p-3.5 ${!g.counts && canRecord(g) ? 'press cursor-pointer' : ''}`}
          {...(!g.counts && canRecord(g) ? { role: 'button', tabIndex: 0, onClick: () => setResultFor(g),
            onKeyDown: (e) => { if (e.key === 'Enter') setResultFor(g) }, 'aria-label': t('friends.correct_result', { n: g.n }) } : {})}>
          <p className="text-sm font-extrabold text-ink-900">
            {pair(g.team_a)} <span className="tabular-nums">{g.score_a}–{g.score_b}</span> {pair(g.team_b)}
          </p>
          {g.sets?.length > 1 && (
            <p className="mt-0.5 text-xs tabular-nums text-ink-700">{g.sets.map((x) => `${x.score_a}–${x.score_b}`).join(' · ')}</p>
          )}
          {!g.counts && g.waiting_for?.length > 0 && (
            <p className="mt-1 text-xs text-muted">
              {t('friends.counts_when', { names: g.waiting_for.map((w) => String(w.name || '').split(/\s+/)[0]).join(', ') })}
            </p>
          )}
        </div>
      ) : (
        <div key={g.id} className="flex items-center gap-3 rounded-card border border-line bg-white p-3.5">
          <p className="min-w-0 flex-1 text-sm text-ink-900">
            <span className="font-extrabold">{t('friends.game_n', { n: g.n })}</span> · {pair(g.team_a)} <span className="text-muted">×</span> {pair(g.team_b)}
          </p>
          {canRecord(g) && (
            <button type="button" onClick={() => setResultFor(g)}
              className="press min-h-[44px] shrink-0 rounded-full border-[1.5px] border-line bg-white px-3 text-xs font-extrabold text-ink-900">
              {t('friends.mark_result')}
            </button>
          )}
        </div>
      )))}

      {pending > 0 && (
        <p className="rounded-card bg-ink-50 p-3.5 text-sm text-ink-700">
          <b className="text-ink-900">{t('friends.not_answered_bold', { count: pending })}</b> {t('friends.not_answered_rest')}
        </p>
      )}
      {pending > 0 && iAmCreator && <ShareMissingButton match={match} creatorName={creator?.name} />}

      {next ? (
        <button type="button" onClick={() => setResultFor(next)}
          className="press min-h-[52px] w-full rounded-ctrl bg-ink-900 px-4 text-[15px] font-extrabold text-white">
          {t('friends.mark_next')}
        </button>
      ) : iAmCreator && (
        <button type="button" onClick={() => setAdding(true)}
          className="press min-h-[52px] w-full rounded-ctrl border-[1.5px] border-line bg-white px-4 text-[15px] font-extrabold text-ink-900">
          {t('friends.add_game')}
        </button>
      )}

      {resultFor && (
        <FriendResultSheet match={match} game={resultFor} onClose={() => setResultFor(null)}
          onSaved={() => { setResultFor(null); onChanged() }} />
      )}
      {adding && (
        <AddGameSheet matchId={match.id} players={players} onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); onChanged() }} />
      )}
    </div>
  )
}
