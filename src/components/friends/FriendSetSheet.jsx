// Set a set (SPEC amigos-por-rondas, 27 set): «Ronda N · Campo C», os sets já
// marcados e o seguinte. «Guardar set N» (preto) e, em «Sets à vontade», «O
// jogo acabou assim» (contorno). Em «Melhor de 3» fecha sozinho quando alguém
// ganha 2 (base de dados do Dev 3). Um set corrige-se enquanto o jogo não
// contou para o ranking.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet } from '../agenda/AgendaControls'
import { saveFriendMatchSet, finishFriendMatchGame } from '../../lib/privateMatches'
import { describeError } from '../../lib/errors'
import { shortName } from './friendShare'
import { setsOf, setsWon } from './roundsData'

const pair = (team) => (team || []).map((p) => shortName(p.name)).join(' / ')
const ERRORS = ['bad_score', 'already_counted', 'not_allowed']
const clean = (v) => String(v).replace(/\D/g, '').slice(0, 2)

export default function FriendSetSheet({ game, roundNumber, format, onClose, onSaved }) {
  const { t } = useTranslation()
  const saved = setsOf(game).map((s) => ({ a: String(s.score_a), b: String(s.score_b) }))
  const [wa, wb] = setsWon(game)
  // Melhor de 3 já decidido (2 sets de um lado): não há set seguinte.
  const decided = format === 'best3' && Math.max(wa, wb) >= 2
  const [rows, setRows] = useState(() => (decided ? saved : [...saved, { a: '', b: '' }]))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const next = rows.length
  const last = rows[rows.length - 1]
  const newFilled = !decided && last && last.a !== '' && last.b !== ''
  const changed = rows.slice(0, saved.length).some((r, i) => r.a !== saved[i].a || r.b !== saved[i].b)

  const persist = async () => {
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i]
      const isNew = i >= saved.length
      if (isNew && (r.a === '' || r.b === '')) continue
      if (!isNew && r.a === saved[i].a && r.b === saved[i].b) continue
      // eslint-disable-next-line no-await-in-loop
      await saveFriendMatchSet(game.id, i + 1, Number(r.a), Number(r.b))
    }
  }
  const run = async (finish) => {
    setBusy(true); setError('')
    try {
      await persist()
      if (finish) await finishFriendMatchGame(game.id)
      onSaved()
    } catch (err) {
      console.error('Error saving a friend match set:', err)
      const code = ERRORS.find((k) => String(err?.message || '').includes(k))
      setError(code ? t(`friends.set_error_${code}`) : describeError(t, err))
    } finally { setBusy(false) }
  }

  const cell = 'input-field h-12 w-full text-center text-lg font-extrabold tabular-nums'
  return (
    <Sheet title={t('friends.set_sheet_title', { round: roundNumber, court: game.court_number || 1 })} onClose={onClose}>
      <div className="space-y-2.5">
        <p className="-mt-2 text-xs text-muted">{t(format === 'best3' ? 'friends.set_sheet_hint_best3' : 'friends.set_sheet_hint_free')}</p>
        <div className="grid grid-cols-[52px_1fr_16px_1fr] items-end gap-2 text-center text-xs font-semibold text-muted">
          <span /><span className="truncate">{pair(game.team_a)}</span><span /><span className="truncate">{pair(game.team_b)}</span>
        </div>
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[52px_1fr_16px_1fr] items-center gap-2">
            <span className="text-sm font-extrabold text-ink-900">{t('privatematches.set_label', { number: i + 1 })}</span>
            {['a', '-', 'b'].map((side) => (side === '-'
              ? <span key={side} className="text-center font-extrabold text-muted">–</span>
              : (
                <input key={side} inputMode="numeric" value={r[side]} placeholder="0"
                  aria-label={t('friends.set_score_aria', { n: i + 1, team: pair(side === 'a' ? game.team_a : game.team_b) })}
                  onChange={(e) => setRows((list) => list.map((x, j) => (j === i ? { ...x, [side]: clean(e.target.value) } : x)))}
                  className={`${cell} ${i >= saved.length ? 'border-ink-900 bg-white' : ''}`} />
              )))}
          </div>
        ))}
        {error && <p className="rounded-ctrl border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-extrabold text-danger">{error}</p>}
        <button type="button" disabled={busy || (!newFilled && !changed)} onClick={() => run(false)}
          className="press min-h-[52px] w-full rounded-ctrl bg-ink-900 px-4 text-[15px] font-extrabold text-white disabled:opacity-40">
          {changed && !newFilled ? t('friends.save_sets') : t('friends.save_set', { n: next })}
        </button>
        {format === 'free' && (
          <button type="button" disabled={busy || (saved.length === 0 && !newFilled)} onClick={() => run(true)}
            className="press min-h-[52px] w-full rounded-ctrl border-[1.5px] border-line bg-white px-4 text-[15px] font-extrabold text-ink-900 disabled:opacity-40">
            {t('friends.game_ended_like_this')}
          </button>
        )}
        <p className="text-xs text-muted">{t('friends.set_correct_note')}</p>
      </div>
    </Sheet>
  )
}
