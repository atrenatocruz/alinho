// O jogo entre amigos por rondas, como no mix (SPEC amigos-por-rondas,
// aprovado pelo Francisco a 27 set): substitui a lista «Jogo 1 … Jogo N».
// Cada ronda num bloco — «Ronda N» e o estado (Acabou · A decorrer · set N ·
// A seguir), por campo as duas duplas com os sets ganhos à direita e os sets
// por baixo, e «Descansam». A ronda a decorrer tem contorno preto, com
// «⇄ Editar duplas» e «Marcar set N». Em «Pontos» marca-se o resultado de
// uma vez, como antes.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeftRight } from 'lucide-react'
import { shortName } from './friendShare'
import { roundsOf, hasResult, setsOf, setsWon } from './roundsData'
import { formatKey } from './friendScoring'
import FriendSetSheet from './FriendSetSheet'
import FriendResultSheet from './FriendResultSheet'
import EditPairsSheet from './EditPairsSheet'
import AddGameSheet from './AddGameSheet'
import { ShareMissingButton } from './FriendSessionGames'

export default function FriendRounds({ match, games, invitees, players, iAmCreator, myUserId, onChanged }) {
  const { t } = useTranslation()
  const [setFor, setSetFor] = useState(null) // { game, round }
  const [resultFor, setResultFor] = useState(null)
  const [editFor, setEditFor] = useState(null) // a ronda
  const [adding, setAdding] = useState(false)
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
  const open = (g, round) => (bySets ? setSetFor({ game: g, round: round.number }) : setResultFor(g))

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
          <button type="button" onClick={(e) => { e.stopPropagation(); open(g, round) }}
            className="press mt-2.5 min-h-[44px] w-full rounded-ctrl bg-ink-900 px-3 text-sm font-extrabold text-white">
            {bySets ? t('friends.mark_set', { n: s.length + 1 }) : t('friends.mark_result')}
          </button>
        )}
      </div>
    )
  }

  const tag = (r) => (r.done
    ? <span className="rounded-full bg-[#DCFCE7] px-2.5 py-0.5 text-xs font-extrabold text-[#14532D]">{t('friends.round_done')}</span>
    : r.current
      ? <span className="rounded-full bg-danger/10 px-2.5 py-0.5 text-xs font-extrabold text-danger">
        {bySets ? t('friends.round_live_set', { n: Math.max(1, ...r.courts.map((g) => setsOf(g).length + 1)) }) : t('friends.round_live')}
      </span>
      : <span className="rounded-full bg-ink-50 px-2.5 py-0.5 text-xs font-extrabold text-ink-700">{t('friends.round_next')}</span>)

  return (
    <div className="space-y-3">
      {rounds.map((r) => {
        const single = r.courts.length === 1 ? r.courts[0] : null
        const canEdit = iAmCreator && !r.counted
        const canMark = r.current && single && canRecord(single) && !hasResult(single)
        return (
          <section key={r.number} className={`rounded-card p-3 ${r.current ? 'border-2 border-ink-900 bg-white' : 'bg-surface'}`}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="font-display text-base text-ink-900">{t('friends.round_n', { n: r.number })}</h3>
              {tag(r)}
            </div>
            <div className="space-y-2">{r.courts.map((g) => court(g, r))}</div>
            {r.resting.length > 0 && (
              <p className="mt-2 text-xs text-muted">{t('friends.resting_line_plural', { names: r.resting.map((p) => (p.is_anonymous ? t('friends.anon_name') : shortName(p.name))).join(', ') })}</p>
            )}
            {(canEdit || canMark) && (
              <div className="mt-2.5 flex gap-2">
                {canEdit && (
                  <button type="button" onClick={() => setEditFor(r)}
                    className="press inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-ctrl border-[1.5px] border-line bg-white px-3 text-sm font-extrabold text-ink-900">
                    <ArrowLeftRight size={15} /> {t('friends.edit_pairs')}
                  </button>
                )}
                {canMark && (
                  <button type="button" onClick={() => open(single, r)}
                    className="press min-h-[44px] flex-1 rounded-ctrl bg-ink-900 px-3 text-sm font-extrabold text-white">
                    {bySets ? t('friends.mark_set', { n: setsOf(single).length + 1 }) : t('friends.mark_result')}
                  </button>
                )}
              </div>
            )}
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
      {iAmCreator && rounds.every((r) => r.done) && (
        <button type="button" onClick={() => setAdding(true)}
          className="press min-h-[52px] w-full rounded-ctrl border-[1.5px] border-line bg-white px-4 text-[15px] font-extrabold text-ink-900">
          {t('friends.add_game')}
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
      {adding && (
        <AddGameSheet matchId={match.id} players={players} onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); onChanged() }} />
      )}
    </div>
  )
}
