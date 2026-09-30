// Set a set (SPEC amigos-por-rondas, 27 set): «Ronda N · Campo C», os sets já
// marcados e o seguinte. «Guardar set N» (preto) e «O jogo acabou assim»
// (contorno), em todos os modos (28 set). Em «Melhor de 3» fecha sozinho quando
// alguém ganha 2 (base de dados do Dev 3). Um set corrige-se enquanto o jogo não
// contou para o ranking.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet } from '../agenda/AgendaControls'
import { saveFriendMatchSet, finishFriendMatchGame } from '../../lib/privateMatches'
import { describeError } from '../../lib/errors'
import { shortName } from './friendShare'
import { setsOf, setsWon } from './roundsData'
import { friendSetProblem, setsState } from './friendScoring'

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
  // Sets por acabar valem (Francisco, 28 set): só não passa de 7-6.
  const setProb = rows.map((r) => friendSetProblem(r.a, r.b)).find(Boolean) || null
  // Quem ganha se o jogo acabar assim: mais sets e, empatados, mais jogos —
  // a mesma frase verde do resultado (28 set).
  const st = setsState(rows.filter((r) => r.a !== '' && r.b !== ''), 'free')
  const lead = st.winner === 'a' ? pair(game.team_a) : pair(game.team_b)
  // A frase de quem ganha (ou do empate) só quando o jogo ACABA (UX, 30 set;
  // com 6-4, 4-6 e o 3.º por jogar aparecia «Empate»): em «Melhor de 3»,
  // quando alguém ganha 2 sets; em qualquer modo, na pergunta do «O jogo
  // acabou assim». Com 1-1 em «Melhor de 3», só a linha cinzenta a dizer que
  // segue para o 3.º set. Com um set a meio, nada.
  const allRowsFilled = rows.length > 0 && rows.every((r) => r.a !== '' && r.b !== '')
  const endedBest3 = format === 'best3' && allRowsFilled && Math.max(st.winsA, st.winsB) >= 2
  const oneSetEach = format === 'best3' && allRowsFilled && rows.length === 2 && st.winsA === 1 && st.winsB === 1
  const [askFinish, setAskFinish] = useState(false)
  const resultLine = !st.winner ? t('friends.result_draw')
    : st.bySets ? t('friends.winner_line', { team: lead, count: Math.max(st.winsA, st.winsB), a: Math.max(st.winsA, st.winsB), b: Math.min(st.winsA, st.winsB) })
      : t('friends.winner_games_line', { team: lead, a: Math.max(st.gamesA, st.gamesB), b: Math.min(st.gamesA, st.gamesB) })

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
      // A trava do #588 no servidor (Dev 3): a mesma frase do ecrã.
      if (String(err?.message || '').includes('set_invalid')) setError(t('friends.set_problem_set_max'))
      else setError(code ? t(`friends.set_error_${code}`) : describeError(t, err))
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
        {setProb && <p className="text-xs font-extrabold text-danger" role="status">{t(`friends.set_problem_${setProb}`)}</p>}
        {!setProb && endedBest3 && (
          <p className="rounded-ctrl bg-lime-100 px-3 py-2.5 text-sm text-ink-900">{resultLine}</p>
        )}
        {!setProb && oneSetEach && <p className="text-sm text-muted">{t('friends.one_set_each')}</p>}
        {error && <p className="rounded-ctrl border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-extrabold text-danger">{error}</p>}
        <button type="button" disabled={busy || !!setProb || (!newFilled && !changed)} onClick={() => run(false)}
          className="press min-h-[52px] w-full rounded-ctrl bg-ink-900 px-4 text-[15px] font-extrabold text-white disabled:opacity-40">
          {changed && !newFilled ? t('friends.save_sets') : t('friends.save_set', { n: next })}
        </button>
        {/* Em «Melhor de 3» também (Francisco, 28 set): um jogo pode acabar
            em 6-4 · 4-4 por falta de tempo. Com 2 sets ganhos já fechou. */}
        {/* Com 2 sets ganhos o jogo já acabou: sai (SPEC das rondas editáveis). */}
        {!decided && !endedBest3 && (
          <button type="button" disabled={busy || !!setProb || (saved.length === 0 && !newFilled)} onClick={() => setAskFinish(true)}
            className="press min-h-[52px] w-full rounded-ctrl border-[1.5px] border-line bg-white px-4 text-[15px] font-extrabold text-ink-900 disabled:opacity-40">
            {t('friends.game_ended_like_this')}
          </button>
        )}
        <p className="text-xs text-muted">{t('friends.set_correct_note')}</p>
      </div>
      {/* «O jogo acabou assim»: pergunta antes de fechar, com quem ganha. */}
      {askFinish && (
        <Sheet title={t('friends.finish_as_is_title')} onClose={() => { if (!busy) setAskFinish(false) }}>
          {st.filled && <p className="text-[15px] leading-snug text-ink-500">{resultLine}</p>}
          <div className="mt-4 space-y-2.5">
            <button type="button" disabled={busy} onClick={async () => { await run(true); setAskFinish(false) }}
              className="press min-h-[52px] w-full rounded-ctrl bg-ink-900 px-4 text-[15px] font-extrabold text-white disabled:opacity-40">
              {t('friends.finish_as_is_yes')}
            </button>
            <button type="button" disabled={busy} onClick={() => setAskFinish(false)}
              className="press min-h-[52px] w-full rounded-ctrl border-[1.5px] border-line bg-white px-4 text-[15px] font-extrabold text-ink-900 disabled:opacity-40">
              {t('friends.finish_as_is_keep')}
            </button>
          </div>
        </Sheet>
      )}
    </Sheet>
  )
}
