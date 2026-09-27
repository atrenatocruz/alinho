// «Juntar mais um jogo» (UX, 27 set): quando a rotação acaba e jogaram mais,
// quem criou escolhe as equipas na hora — toca-se numa pessoa para a passar
// de fora → Equipa 1 → Equipa 2 → fora. Grava com add_friend_match_game.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet } from '../agenda/AgendaControls'
import { Avatar, PrimaryButton } from '../ui'
import { addFriendMatchGame } from '../../lib/privateMatches'
import { describeError } from '../../lib/errors'

const NEXT = { out: 'a', a: 'b', b: 'out' }

export default function AddGameSheet({ matchId, players, onClose, onSaved }) {
  const { t } = useTranslation()
  const [side, setSide] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const of = (k) => players.filter((p) => (side[p.id] || 'out') === k)
  const valid = of('a').length === 2 && of('b').length === 2

  const save = async () => {
    setBusy(true); setError('')
    try {
      await addFriendMatchGame(matchId, { teamA: of('a').map((p) => p.id), teamB: of('b').map((p) => p.id) })
      onSaved()
    } catch (err) {
      console.error('Error adding a friend match game:', err)
      setError(err?.code === 'P0001' && err?.message ? err.message : describeError(t, err))
    } finally { setBusy(false) }
  }

  const tag = { a: t('friends.team_n', { n: 1 }), b: t('friends.team_n', { n: 2 }) }
  return (
    <Sheet title={t('friends.add_game_title')} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-muted">{t('friends.add_game_hint')}</p>
        <div className="space-y-2">
          {players.map((p) => {
            const s = side[p.id] || 'out'
            return (
              <button key={p.id} type="button" onClick={() => setSide((x) => ({ ...x, [p.id]: NEXT[s] }))}
                className={`press flex min-h-[48px] w-full items-center gap-3 rounded-ctrl border px-3 py-2 text-left ${s === 'out' ? 'border-line bg-white' : 'border-ink-900 bg-ink-50'}`}>
                <Avatar name={p.name} url={p.avatar_url} size="w-8 h-8 text-[11px]" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-900">{p.name}</span>
                {s !== 'out' && <span className="shrink-0 font-mono text-[11px] font-extrabold uppercase tracking-wider text-ink-700">{tag[s]}</span>}
              </button>
            )
          })}
        </div>
        {error && <p className="rounded-ctrl border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-extrabold text-danger">{error}</p>}
        <PrimaryButton onClick={save} disabled={!valid || busy} className="w-full">{t('friends.add_game_save')}</PrimaryButton>
        {!valid && <p className="-mt-1 text-center text-xs text-muted">{t('friends.teams_need_two')}</p>}
      </div>
    </Sheet>
  )
}
