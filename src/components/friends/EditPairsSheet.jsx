// «⇄ Editar duplas · ronda N» (SPEC amigos-por-rondas, 27 set): Equipa 1 /
// Equipa 2 de cada campo e Descansam (tracejado). Toca numa pessoa e depois
// noutra para trocarem de lugar, também com quem descansa. Muda só esta
// ronda: as seguintes nascem com as duplas dela até nova troca (SPEC
// 2026-10-07-amigos-a-jogar, ponto 6).
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet } from '../agenda/AgendaControls'
import { Avatar } from '../ui'
import { setFriendMatchRoundTeams } from '../../lib/privateMatches'
import { describeError } from '../../lib/errors'
import { setsOf } from './roundsData'

const ERRORS = ['already_counted', 'same_person_twice', 'bad_courts', 'has_results']

export default function EditPairsSheet({ match, round, players, onClose, onSaved }) {
  const { t } = useTranslation()
  const byId = new Map(players.map((p) => [p.invitee_id, p]))
  const person = (x) => byId.get(x.invitee_id) || { invitee_id: x.invitee_id, name: x.name }
  // Lugares: [campo][0 = equipa 1 | 1 = equipa 2][0|1], e os que descansam.
  const [slots, setSlots] = useState(() => round.courts.map((g) => [(g.team_a || []).map(person), (g.team_b || []).map(person)]))
  const [resting, setResting] = useState(() => round.resting)
  const [picked, setPicked] = useState(null) // { court, team, i } | { rest: i }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const at = (pos) => (pos.rest != null ? resting[pos.rest] : slots[pos.court][pos.team][pos.i])
  const put = (pos, p, s, r) => {
    if (pos.rest != null) r[pos.rest] = p
    else s[pos.court][pos.team][pos.i] = p
  }
  const tap = (pos) => {
    if (!picked) { setPicked(pos); return }
    const a = at(picked); const b = at(pos)
    const s = slots.map((c) => c.map((team) => [...team])); const r = [...resting]
    put(picked, b, s, r); put(pos, a, s, r)
    setSlots(s); setResting(r); setPicked(null)
  }
  const same = (x, y) => x && y && JSON.stringify(x) === JSON.stringify(y)

  const save = async () => {
    setBusy(true); setError('')
    try {
      const ids = (team) => team.map((p) => p.invitee_id)
      await setFriendMatchRoundTeams(match.id, round.number, round.courts.map((g, c) => ({
        game_id: g.id, team_a: ids(slots[c][0]), team_b: ids(slots[c][1]),
      })))
      onSaved()
    } catch (err) {
      console.error('Error editing friend match pairs:', err)
      const code = ERRORS.find((k) => String(err?.message || '').includes(k))
      setError(code ? t(`friends.pairs_error_${code}`) : describeError(t, err))
    } finally { setBusy(false) }
  }

  const row = (p, pos) => (
    <button key={p?.invitee_id || JSON.stringify(pos)} type="button" onClick={() => tap(pos)}
      className={`press flex min-h-[48px] w-full items-center gap-3 rounded-ctrl px-3 py-2 text-left ${same(picked, pos) ? 'bg-ink-900 text-white' : 'bg-surface text-ink-900'}`}>
      <Avatar name={p?.name} url={p?.avatar_url} size={`w-8 h-8 text-[11px] ${same(picked, pos) ? 'ring-2 ring-lime-400' : ''}`} />
      <span className="min-w-0 flex-1 truncate text-sm font-extrabold">{p?.name}</span>
    </button>
  )
  const box = (title, children, dashed = false) => (
    <div className={`rounded-card border p-3 ${dashed ? 'border-dashed border-ink-200' : 'border-line'}`}>
      <p className="mb-2 font-mono text-[11px] font-extrabold uppercase tracking-wider text-ink-500">{title}</p>
      <div className="space-y-2">{children}</div>
    </div>
  )
  const setsDone = round.courts.flatMap((g) => setsOf(g).map((s) => `${s.score_a}-${s.score_b}`))

  return (
    <Sheet title={t('friends.edit_pairs_title', { n: round.number })} onClose={onClose}>
      <div className="space-y-3">
        <p className="-mt-2 text-xs text-muted">{t('friends.edit_pairs_hint')}</p>
        {slots.map((court, c) => (
          <div key={c} className="space-y-2">
            {slots.length > 1 && <p className="font-mono text-[11px] font-extrabold uppercase tracking-wider text-ink-700">{t('friends.court_n', { n: c + 1 })}</p>}
            {court.map((team, k) => box(t('friends.team_n', { n: k + 1 }), team.map((p, i) => row(p, { court: c, team: k, i }))))}
          </div>
        ))}
        {resting.length > 0 && box(t('friends.resting_plural'), resting.map((p, i) => row(p, { rest: i })), true)}
        <p className="text-xs text-muted">
          {setsDone.length ? `${t('friends.edit_pairs_note_sets', { sets: setsDone.join(', ') })} ` : ''}{t('friends.edit_pairs_note_this_round')}
        </p>
        {error && <p className="rounded-ctrl border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-extrabold text-danger">{error}</p>}
        <button type="button" disabled={busy} onClick={save}
          className="press min-h-[52px] w-full rounded-ctrl bg-ink-900 px-4 text-[15px] font-extrabold text-white disabled:opacity-40">
          {t('friends.save_pairs')}
        </button>
      </div>
    </Sheet>
  )
}
