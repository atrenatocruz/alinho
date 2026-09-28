// O jogo entre amigos por rondas, como no mix (SPEC amigos-por-rondas,
// aprovado pelo Francisco a 27 set): substitui a lista «Jogo 1 … Jogo N».
// Cada ronda num bloco — «Ronda N» e o estado (Acabou · A decorrer · set N ·
// A seguir), por campo as duas duplas com os sets ganhos à direita e os sets
// por baixo, e «Descansam». A ronda a decorrer tem contorno preto, com
// «⇄ Editar duplas» e «Marcar set N». Em «Pontos» marca-se o resultado de
// uma vez, como antes.
//
// Rondas editáveis (27 set, SPEC amigos-por-rondas, fim — «o mais editável
// possível»): quem criou junta rondas («＋ Ronda»), remove qualquer ronda
// (também jogadas e a que decorre, com pergunta) e muda-as de lugar (↑ ↓).
// O único cadeado é a ronda que já contou para o ranking.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowLeftRight, ArrowUp, Lock, Plus } from 'lucide-react'
import { shortName } from './friendShare'
import { roundsOf, hasResult, setsOf, setsWon, canMove, roundResults } from './roundsData'
import { formatKey } from './friendScoring'
import FriendSetSheet from './FriendSetSheet'
import FriendResultSheet from './FriendResultSheet'
import EditPairsSheet from './EditPairsSheet'
import { ShareMissingButton } from './FriendSessionGames'
import { ConfirmSheet } from '../ui'
import { addFriendMatchRound, moveFriendMatchRound, removeFriendMatchRound } from '../../lib/privateMatches'
import { planRounds, courtsFor } from '../../lib/friendTeams'
import { describeError } from '../../lib/errors'
import { beforeStart } from '../../lib/friendGames'
import { dayText } from './dayText'

// Os erros das funções novas (Dev 3). Sem a função em produção, describeError
// já diz «ainda não disponível» (not_ready).
const roundError = (t, err) => (String(err?.message || '').includes('already_counted')
  ? t('friends.round_error_counted') : describeError(t, err))

export default function FriendRounds({ match, games, invitees, players, iAmCreator, myUserId, onChanged }) {
  const { t, i18n } = useTranslation()
  const [setFor, setSetFor] = useState(null) // { game, round }
  const [resultFor, setResultFor] = useState(null)
  const [editFor, setEditFor] = useState(null) // a ronda
  const [removeFor, setRemoveFor] = useState(null) // a ronda
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const format = formatKey(match.scoring_format, match.num_sets)
  const bySets = format !== 'points'
  const rounds = roundsOf(games, players)
  const anon = new Set(invitees.filter((i) => i.is_anonymous).map((i) => i.invitee_id))
  const me = invitees.find((i) => i.user_id && i.user_id === myUserId)
  const pending = invitees.filter((i) => i.status === 'pending').length
  const creator = invitees.find((i) => i.is_creator)
  const canRecord = (g) => iAmCreator || (me?.status === 'accepted'
    && [...(g.team_a || []), ...(g.team_b || [])].some((p) => p.user_id === myUserId))
  const name = (p) => (anon.has(p.invitee_id) ? <i key={p.invitee_id} className="font-semibold text-muted">{t('friends.anon_name')}</i> : shortName(p.name))
  const pair = (team) => (team || []).map((p, i) => <span key={p.invitee_id || i}>{i > 0 && ' / '}{name(p)}</span>)
  const hasAnon = (g) => [...(g.team_a || []), ...(g.team_b || [])].some((p) => anon.has(p.invitee_id))
  // O resultado marca-se a partir da hora do jogo, durante ou depois
  // (Francisco, 28 set): antes, «Marcar» fica apagado, com a frase.
  const early = beforeStart(match.scheduled_date, match.scheduled_time)
  const earlyText = t('friends.results_from', {
    time: match.scheduled_time ? String(match.scheduled_time).slice(0, 5) : '00:00',
    day: match.scheduled_date ? dayText(match.scheduled_date, i18n.language).toLocaleLowerCase(i18n.language) : '',
  })
  const open = (g, round) => { if (!early) (bySets ? setSetFor({ game: g, round: round.number }) : setResultFor(g)) }

  const court = (g, round) => {
    const [wa, wb] = setsWon(g)
    const s = setsOf(g)
    const live = round.current && !hasResult(g)
    const tappable = canRecord(g) && !g.counts && (hasResult(g) || s.length > 0)
    const line = s.length
      ? `${s.map((x) => `${x.score_a}-${x.score_b}`).join(' · ')}${live ? ` · ${t('friends.set_to_play', { n: s.length + 1 })}` : ''}`
      : null
    const showNumbers = hasResult(g) || s.length > 0
    return (
      <div key={g.id} className={`rounded-ctrl border border-line bg-white p-3 ${tappable ? 'press cursor-pointer' : ''}`}
        {...(tappable ? { role: 'button', tabIndex: 0, onClick: () => open(g, round), onKeyDown: (e) => { if (e.key === 'Enter') open(g, round) },
          'aria-label': t('friends.correct_result', { n: g.n }) } : {})}>
        <p className="mb-1.5 font-mono text-[11px] font-extrabold uppercase tracking-wider text-ink-500">{t('friends.court_n', { n: g.court_number || 1 })}</p>
        {[[g.team_a, wa, wa >= wb], [g.team_b, wb, wb > wa]].map(([team, n, ahead], k) => (
          <div key={k} className={`flex items-center justify-between gap-2 text-sm ${showNumbers && !ahead ? 'text-muted' : 'text-ink-900'} ${k ? 'mt-1' : ''}`}>
            <span className="min-w-0 truncate font-extrabold">{pair(team)}</span>
            {showNumbers && <b className="tabular-nums text-ink-900">{n}</b>}
          </div>
        ))}
        {line && <p className="mt-1.5 text-xs tabular-nums text-ink-700">{line}</p>}
        {hasAnon(g) ? <p className="mt-1 text-xs text-muted">{t('friends.anon_no_ranking')}</p>
          : hasResult(g) && !g.counts && g.waiting_for?.length > 0 && (
            <p className="mt-1 text-xs text-muted">{t('friends.counts_when', { names: g.waiting_for.map((w) => String(w.name || '').split(/\s+/)[0]).join(', ') })}</p>
          )}
        {/* Dois campos: cada um marca o seu. */}
        {round.current && round.courts.length > 1 && canRecord(g) && !hasResult(g) && (
          <button type="button" onClick={(e) => { e.stopPropagation(); open(g, round) }} disabled={early}
            className="press mt-2.5 min-h-[44px] w-full rounded-ctrl bg-ink-900 px-3 text-sm font-extrabold text-white disabled:bg-ink-200 disabled:text-ink-500">
            {bySets ? t('friends.mark_set', { n: s.length + 1 }) : t('friends.mark_result')}
          </button>
        )}
      </div>
    )
  }

  // Só quem criou, e à vez: mexem na ordem das rondas.
  const act = async (fn) => {
    setBusy(true); setError('')
    try { await fn(); onChanged() } catch (err) {
      console.error('Error editing friend match rounds:', err)
      setError(roundError(t, err))
    } finally { setBusy(false) }
  }
  const move = (r, dir) => act(() => moveFriendMatchRound(match.id, r.number, dir === 'up' ? r.number - 1 : r.number + 1))

  // «＋ Ronda»: a app faz a ronda seguinte — quem joga e quem descansa — sem
  // repetir duplas nem jogos das que já existem (a mesma conta do formar).
  const addRound = () => act(async () => {
    const byId = new Map(players.map((p) => [p.invitee_id, p]))
    const person = (x) => byId.get(x.invitee_id) || { ...x, id: x.invitee_id }
    const done = rounds.map((r) => ({
      courts: r.courts.map((g) => ({ teamA: (g.team_a || []).map(person), teamB: (g.team_b || []).map(person) })),
      resting: r.resting,
    }))
    const courts = Math.min(Math.max(1, ...rounds.map((r) => r.courts.length)), courtsFor(players.length))
    const [next] = planRounds(players, done, courts, 1)
    const ids = (team) => team.map((p) => p.id)
    await addFriendMatchRound(match.id, next.courts.map((c) => ({ team_a: ids(c.teamA), team_b: ids(c.teamB) })))
  })

  // «Remover a ronda N?» — diz o que se perde: os resultados, ou as duplas.
  const names = (team) => (team || []).map((p) => shortName(p.name)).join(' / ')
  const removeMessage = (r) => {
    const res = roundResults(r)
    if (res.length) {
      const text = res.map(({ game, won }) => {
        const [wa, wb] = won
        return wa >= wb ? `${names(game.team_a)} ${wa}–${wb}` : `${names(game.team_b)} ${wb}–${wa}`
      }).join(', ')
      return t('friends.remove_round_with_results', { results: text })
    }
    const pairs = r.courts.map((g) => `${names(g.team_a)} × ${names(g.team_b)}`).join(', ')
    return t('friends.remove_round_no_results', { pairs, count: r.courts.length })
  }

  const tag = (r) => (r.counted
    ? <span className="rounded-full bg-[#DCFCE7] px-2.5 py-0.5 text-xs font-extrabold text-[#14532D]">{t('friends.round_counted')}</span>
    : r.done
    ? <span className="rounded-full bg-[#DCFCE7] px-2.5 py-0.5 text-xs font-extrabold text-[#14532D]">{t('friends.round_done')}</span>
    // Antes da hora do jogo nenhuma ronda está «A decorrer» (UX, 28 set).
    : r.current && !early
      ? <span className="rounded-full bg-danger/10 px-2.5 py-0.5 text-xs font-extrabold text-danger">
        {bySets ? t('friends.round_live_set', { n: Math.max(1, ...r.courts.map((g) => setsOf(g).length + 1)) }) : t('friends.round_live')}
      </span>
      : <span className="rounded-full bg-ink-50 px-2.5 py-0.5 text-xs font-extrabold text-ink-700">{t('friends.round_next')}</span>)

  return (
    <div className="space-y-3">
      {rounds.map((r, i) => {
        const single = r.courts.length === 1 ? r.courts[0] : null
        const canEdit = iAmCreator && !r.counted
        const canMark = r.current && single && canRecord(single) && !hasResult(single)
        const arrow = 'press inline-flex h-9 w-9 items-center justify-center rounded-full border border-line bg-white text-ink-900 disabled:opacity-30'
        return (
          <section key={r.number} className={`rounded-card p-3 ${r.current ? 'border-2 border-ink-900 bg-white' : 'bg-surface'}`}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <h3 className="mr-1 font-display text-base text-ink-900">{t('friends.round_n', { n: r.number })}</h3>
                {/* ↑ ↓: a de cima sem ↑, a de baixo sem ↓; a que contou sem nenhuma. */}
                {canEdit && i > 0 && (
                  <button type="button" onClick={() => move(r, 'up')} disabled={busy || !canMove(rounds, i, 'up')}
                    aria-label={t('friends.round_move_up', { n: r.number })} className={arrow}><ArrowUp size={16} /></button>
                )}
                {canEdit && i < rounds.length - 1 && (
                  <button type="button" onClick={() => move(r, 'down')} disabled={busy || !canMove(rounds, i, 'down')}
                    aria-label={t('friends.round_move_down', { n: r.number })} className={arrow}><ArrowDown size={16} /></button>
                )}
              </div>
              {tag(r)}
            </div>
            <div className="space-y-2">{r.courts.map((g) => court(g, r))}</div>
            {r.resting.length > 0 && (
              <p className="mt-2 text-xs text-muted">{t('friends.resting_line_plural', { names: r.resting.map((p) => (p.is_anonymous ? t('friends.anon_name') : shortName(p.name))).join(', ') })}</p>
            )}
            {r.counted && iAmCreator && (
              <p className="mt-2.5 flex items-start gap-1.5 text-xs text-muted">
                <Lock size={12} className="mt-0.5 shrink-0 text-warning" /> {t('friends.round_counted_lock')}
              </p>
            )}
            {canEdit && (
              <div className="mt-2.5 flex gap-2">
                <button type="button" onClick={() => setEditFor(r)}
                  className="press inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-ctrl border-[1.5px] border-line bg-white px-3 text-sm font-extrabold text-ink-900">
                  <ArrowLeftRight size={15} /> {t('friends.edit_pairs')}
                </button>
                <button type="button" onClick={() => setRemoveFor(r)} disabled={busy}
                  className="press min-h-[44px] flex-1 rounded-ctrl border-[1.5px] border-danger/40 bg-white px-3 text-sm font-extrabold text-danger">
                  {t('friends.remove_round')}
                </button>
              </div>
            )}
            {/* Na ronda a decorrer, «Marcar set» a toda a largura, por baixo
                (designer, 27 set: o Remover também está nesta ronda). */}
            {canMark && (
              <button type="button" onClick={() => open(single, r)} disabled={early}
                className="press mt-2 min-h-[44px] w-full rounded-ctrl bg-ink-900 px-3 text-sm font-extrabold text-white disabled:bg-ink-200 disabled:text-ink-500">
                {bySets ? t('friends.mark_set', { n: setsOf(single).length + 1 }) : t('friends.mark_result')}
              </button>
            )}
            {early && r.current && <p className="mt-1.5 text-xs text-muted">{earlyText}</p>}
          </section>
        )
      })}

      {games.some(hasAnon) && (
        <p className="rounded-card bg-ink-50 p-3.5 text-sm text-ink-700">{t('friends.anon_box_before')} <b className="text-ink-900">«{t('friends.anon_name')}»</b>{t('friends.anon_box_after')}</p>
      )}
      {pending > 0 && (
        <p className="rounded-card bg-ink-50 p-3.5 text-sm text-ink-700">
          <b className="text-ink-900">{t('friends.not_answered_bold', { count: pending })}</b> {t('friends.not_answered_rest')}
        </p>
      )}
      {pending > 0 && iAmCreator && <ShareMissingButton match={match} creatorName={creator?.name} />}
      {error && <p className="rounded-ctrl border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-extrabold text-danger">{error}</p>}
      {iAmCreator && (
        <button type="button" onClick={addRound} disabled={busy}
          className="press inline-flex min-h-[52px] w-full items-center justify-center gap-1.5 rounded-ctrl border-[1.5px] border-dashed border-ink-200 bg-white px-4 text-[15px] font-extrabold text-ink-900 disabled:opacity-40">
          <Plus size={16} /> {t('friends.add_round')}
        </button>
      )}

      {setFor && (
        <FriendSetSheet game={setFor.game} roundNumber={setFor.round} format={format}
          onClose={() => setSetFor(null)} onSaved={() => { setSetFor(null); onChanged() }} />
      )}
      {resultFor && (
        <FriendResultSheet match={match} game={resultFor} onClose={() => setResultFor(null)}
          onSaved={() => { setResultFor(null); onChanged() }} />
      )}
      {editFor && (
        <EditPairsSheet match={match} round={editFor} rounds={rounds} players={players}
          onClose={() => setEditFor(null)} onSaved={() => { setEditFor(null); onChanged() }} />
      )}
      <ConfirmSheet
        open={!!removeFor}
        danger
        title={removeFor ? t('friends.remove_round_title', { n: removeFor.number }) : ''}
        message={removeFor ? removeMessage(removeFor) : ''}
        cancelLabel={t('friends.remove_round_keep')}
        confirmLabel={t('friends.remove_round_yes')}
        onConfirm={async () => { await removeFriendMatchRound(match.id, removeFor.number); onChanged() }}
        onClose={() => setRemoveFor(null)}
        errorOf={(err) => roundError(t, err)}
      />
    </div>
  )
}
