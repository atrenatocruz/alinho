// O jogo entre amigos a jogar (SPEC 2026-10-07-amigos-a-jogar, aprovado pelo
// Francisco a 7 out: «sim, assim faz sentido»). É tudo um jogo só: uma
// moldura por campo, «CAMPO 1 · UM JOGO SÓ», com as rondas por ordem. Cada
// ronda é uma parte do jogo — Set, Tie-break, Super tie-break ou Pontos — com
// o estado à direita (Acabou · A decorrer · A seguir), o tipo numa etiqueta
// e as duas duplas com o resultado (quem perdeu a cinzento).
//
// A ronda a decorrer tem a moldura preta, o tipo com ⌄, o relógio e o alarme
// (se o jogo tem tempo), «Marcar ronda N» (preto) e «⇆ Trocar duplas»
// (contorno). Ao guardar, a seguinte nasce sozinha com as mesmas duplas e o
// mesmo tipo (a rodar, com as duplas previstas). Nas acabadas, «Editar»:
// Editar duplas · Mudar o resultado · Apagar ronda. O tipo muda-se na própria
// linha. Tudo só enquanto a ronda não contou para o ranking.
//
// Quem organiza (quem criou, ou quem disse «Vou» com o nome — SPEC 2026-10-
// 07-amigos-convidado) vê e faz o mesmo.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeftRight, ChevronDown } from 'lucide-react'
import { shortName } from './friendShare'
import { roundsOf, hasResult, roundResults } from './roundsData'
import { kindOf, pointsToOf } from './roundKinds'
import FriendRoundSheet, { RoundKindSheet, kindLabel, roundSaveError } from './FriendRoundSheet'
import SwapPairsSheet from './SwapPairsSheet'
import EditPairsSheet from './EditPairsSheet'
import RoundClock from './RoundClock'
import { ShareMissingButton } from './FriendSessionGames'
import { ConfirmSheet } from '../ui'
import { Sheet } from '../agenda/AgendaControls'
import { addFriendMatchRound, removeFriendMatchRound } from '../../lib/privateMatches'
import { planRounds } from '../../lib/friendTeams'
import { beforeStart } from '../../lib/friendGames'
import { dayText } from './dayText'

const pairKey = (team) => (team || []).map((p) => p.invitee_id).sort().join('+')
const samePairs = (g, h) => !!g && !!h && [pairKey(g.team_a), pairKey(g.team_b)].sort().join('|') === [pairKey(h.team_a), pairKey(h.team_b)].sort().join('|')

export default function FriendRounds({ match, games, invitees, players, iOrganize, onChanged }) {
  const { t, i18n } = useTranslation()
  const [markFor, setMarkFor] = useState(null) // { game, round, editing }
  const [kindFor, setKindFor] = useState(null) // { game, round }
  const [editFor, setEditFor] = useState(null) // { game, round } — a folha «Editar»
  const [pairsFor, setPairsFor] = useState(null) // a ronda — «Editar duplas»
  const [swapFor, setSwapFor] = useState(null) // a ronda — «Trocar duplas»
  const [removeFor, setRemoveFor] = useState(null) // a ronda
  // A ronda seguinte não nasceu (next_error do save, Dev 3, 9 out — raro):
  // { n, after }. Some quando a ronda n aparece.
  const [nextIssue, setNextIssue] = useState(null)
  const [retrying, setRetrying] = useState(false)
  const rounds = roundsOf(games, players)
  const courtsN = Math.max(1, ...games.map((g) => g.court_number || 1))
  const anon = new Set(invitees.filter((i) => i.is_anonymous).map((i) => i.invitee_id))
  const pending = invitees.filter((i) => i.status === 'pending').length
  const creator = invitees.find((i) => i.is_creator)
  const name = (p) => (anon.has(p.invitee_id) ? <i key={p.invitee_id} className="font-semibold text-muted">{t('friends.anon_name')}</i> : shortName(p.name))
  const pair = (team) => (team || []).map((p, i) => <span key={p.invitee_id || i}>{i > 0 && ' / '}{name(p)}</span>)
  // O resultado marca-se a partir da hora do jogo, durante ou depois
  // (Francisco, 28 set): antes, «Marcar» fica apagado, com a frase.
  const early = beforeStart(match.scheduled_date, match.scheduled_time)
  const earlyText = t('friends.results_from', {
    time: match.scheduled_time ? String(match.scheduled_time).slice(0, 5) : '00:00',
    day: match.scheduled_date ? dayText(match.scheduled_date, i18n.language).toLocaleLowerCase(i18n.language) : '',
  })

  // As rondas até esta, como a conta das duplas as quer (friendTeams).
  const byId = new Map(players.map((p) => [p.invitee_id, p]))
  const person = (x) => byId.get(x.invitee_id) || { ...x, id: x.invitee_id }
  const historyTo = (n) => rounds.filter((r) => r.number <= n).map((r) => ({
    courts: r.courts.map((g) => ({ teamA: (g.team_a || []).map(person), teamB: (g.team_b || []).map(person) })),
    resting: r.resting,
  }))
  // As duplas que a app propõe a seguir a esta ronda, sem repetir parceiros.
  const proposalAfter = (round) => planRounds(players, historyTo(round.number), round.courts.length, 1)[0] || null
  // A rodar, a ronda seguinte nasce com as duplas previstas (ponto 4).
  const nextCourtsFor = (round) => {
    if (match.pairing_mode !== 'rotating') return null
    const next = proposalAfter(round)
    const ids = (team) => team.map((p) => p.id)
    return next ? next.courts.map((c) => ({ team_a: ids(c.teamA), team_b: ids(c.teamB) })) : null
  }

  // «Apagar a ronda N?» — diz o que se perde: o resultado, ou as duplas.
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

  const chip = 'inline-flex min-h-[26px] items-center gap-0.5 rounded-full border border-line bg-white px-2.5 text-[11px] font-extrabold text-ink-900'
  const outline = 'press inline-flex min-h-[52px] w-full items-center justify-center gap-1.5 rounded-ctrl border-[1.5px] border-line bg-white px-4 text-[15px] font-extrabold text-ink-900 disabled:opacity-40'

  const item = (g, r, prev) => {
    const done = hasResult(g)
    const live = r.current && !done
    // Antes da hora, a ronda 1 fica cinzenta, com o «Marcar» apagado (SPEC
    // amigos-convidado, ponto 3).
    const framed = live && !early
    const canEdit = iOrganize && !g.counts
    const kind = kindOf(g, match)
    const [sa, sb] = done ? [g.score_a, g.score_b] : [null, null]
    // O jogo conta para o ranking uma vez, no fim (Francisco e Ruben, 8 out —
    // TEXTOS-RANKING.md): a ronda acabada diz só «Acabou», nunca «Contou».
    const tag = done
      ? <span className="rounded-full bg-[#DCFCE7] px-2.5 py-0.5 text-xs font-extrabold text-[#14532D]">{t('friends.round_done')}</span>
      // Antes da hora do jogo nenhuma ronda está «A decorrer» (UX, 28 set).
      : live && !early
        ? <span className="rounded-full bg-danger/10 px-2.5 py-0.5 text-xs font-extrabold text-danger">{t('friends.round_live')}</span>
        : <span className="text-xs font-extrabold text-ink-700">{t('friends.round_next')}</span>
    const kindText = kindLabel(t, kind, pointsToOf(g))
    return (
      <div key={g.id} className={`rounded-card p-3 ${framed ? 'border-2 border-ink-900 bg-white' : 'bg-surface'}`}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-display text-base font-extrabold text-ink-900">{t('friends.round_n', { n: r.number })}</h3>
          {tag}
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          {canEdit ? (
            <button type="button" onClick={() => setKindFor({ game: g, round: r })} className={`press ${chip}`}
              aria-label={t('friends.kind_change_aria', { n: r.number, kind: kindText })}>
              {kindText}{framed && <ChevronDown size={12} />}
            </button>
          ) : <span className={chip}>{kindText}</span>}
          {done && canEdit && (
            <button type="button" onClick={() => setEditFor({ game: g, round: r })}
              className="press min-h-[32px] px-1 text-xs font-extrabold text-ink-900 underline underline-offset-2">
              {t('friends.edit_short')}
            </button>
          )}
        </div>
        <div className="mt-2 rounded-ctrl border border-line bg-white px-3 py-2.5">
          {[[g.team_a, sa, sb], [g.team_b, sb, sa]].map(([team, mine, other], k) => (
            <div key={k} className={`flex items-center justify-between gap-2 text-sm ${done && mine < other ? 'text-muted' : 'text-ink-900'} ${k ? 'mt-1' : ''}`}>
              <span className="min-w-0 truncate font-extrabold">{pair(team)}</span>
              {done && <b className="tabular-nums">{mine}</b>}
            </div>
          ))}
        </div>
        {(g.court_number || 1) === 1 && r.resting.length > 0 && (
          <p className="mt-2 text-xs text-muted">{t('friends.resting_line_plural', { names: r.resting.map((p) => (p.is_anonymous ? t('friends.anon_name') : shortName(p.name))).join(', ') })}</p>
        )}
        {samePairs(g, prev) && <p className="mt-2 text-xs text-muted">{t('friends.same_pairs_as_before')}</p>}
        {live && iOrganize && (
          <div className="mt-3 space-y-2.5">
            {match.game_minutes ? <RoundClock match={match} game={g} roundNumber={r.number} canTimer={iOrganize} onChanged={onChanged} /> : null}
            <button type="button" onClick={() => setMarkFor({ game: g, round: r, editing: false })} disabled={early}
              className="press min-h-[52px] w-full rounded-ctrl bg-ink-900 px-4 text-[15px] font-extrabold text-white disabled:bg-ink-200 disabled:text-ink-500">
              {t('friends.mark_round', { n: r.number })}
            </button>
            {early && <p className="text-xs text-muted">{earlyText}</p>}
            {!early && (
              <button type="button" onClick={() => setSwapFor(r)} className={outline}>
                <ArrowLeftRight size={15} /> {t('friends.swap_pairs')}
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  const time = match.scheduled_time ? String(match.scheduled_time).slice(0, 5) : null
  // O aviso da ronda que não nasceu (UX, 9 out), enquanto ela não existir.
  const missing = nextIssue && iOrganize && !rounds.some((r) => r.number === nextIssue.n) ? nextIssue : null
  // «Tentar outra vez»: as mesmas duplas (ou, a rodar, as previstas).
  const retryMissing = async () => {
    const after = rounds.find((r) => r.number === missing.after) || rounds[rounds.length - 1]
    setRetrying(true)
    try {
      const ids = (team) => (team || []).map((p) => p.invitee_id)
      const courts = nextCourtsFor(after) || after.courts.map((g) => ({ team_a: ids(g.team_a), team_b: ids(g.team_b) }))
      await addFriendMatchRound(match.id, courts, missing.n)
      setNextIssue(null); onChanged()
    } catch (err) {
      console.error('Error adding the missing friend match round:', err)
    } finally { setRetrying(false) }
  }
  // A caixa do ranking (TEXTOS-RANKING.md): conta por par de duplas, e um
  // par só conta com os quatro com conta (BA e Dev 3, 9 out). «Não, só
  // amigável» no Criar nunca conta. Quando a base de dados mandar
  // pairs[].counts (o «O fim»), a frase passa a vir daí.
  const pairCounts = new Map()
  for (const g of games) {
    const four = [...(g.team_a || []), ...(g.team_b || [])]
    pairCounts.set([pairKey(g.team_a), pairKey(g.team_b)].sort().join('|'), four.length === 4 && four.every((p) => p.user_id))
  }
  const counting = [...pairCounts.values()].filter(Boolean).length
  const rankingText = match.ranked_intent === false ? t('friends.ranking_box_friendly')
    : pairCounts.size > 0 && counting === 0 ? t('friends.ranking_box_no_account')
      : counting < pairCounts.size ? t('friends.ranking_box_only_some')
        : [t('friends.ranking_box_once'), pairCounts.size > 1 ? t('friends.ranking_box_each_pair') : null].filter(Boolean).join(' ')
  return (
    <div className="space-y-3">
      {Array.from({ length: courtsN }, (_, c) => c + 1).map((court) => {
        const list = rounds.map((r) => ({ r, g: r.courts.find((x) => (x.court_number || 1) === court) })).filter((x) => x.g)
        return (
          <section key={court} className="rounded-card border border-line bg-white p-3">
            <p className="font-mono text-[11px] font-extrabold uppercase tracking-wider text-ink-900">{t('friends.court_one_game', { n: court })}</p>
            <p className="mb-3 text-xs text-muted">{[time, t('friends.rounds_count', { count: list.length })].filter(Boolean).join(' · ')}</p>
            <div className="space-y-2.5">{list.map(({ r, g }, i) => item(g, r, i > 0 ? list[i - 1].g : null))}</div>
          </section>
        )
      })}

      {missing && (
        <div role="status" className="space-y-2.5 rounded-card border border-warning/40 bg-warning/10 p-3.5">
          <p className="text-sm text-ink-900">{t('friends.next_missing_other', { n: missing.n })}</p>
          <button type="button" onClick={retryMissing} disabled={retrying} className={outline}>
            {t('friends.next_missing_retry')}
          </button>
        </div>
      )}

      {games.some((g) => [...(g.team_a || []), ...(g.team_b || [])].some((p) => anon.has(p.invitee_id))) && (
        <p className="rounded-card bg-ink-50 p-3.5 text-sm text-ink-700">{t('friends.anon_box_before')} <b className="text-ink-900">«{t('friends.anon_name')}»</b>{t('friends.anon_box_after')}</p>
      )}
      {/* A caixa do ranking (TEXTOS-RANKING.md, ponto 2): conta uma vez, no
          fim; com trocas, cada par de duplas é um jogo. Por cima, quem falta
          responder. */}
      <p className="rounded-card bg-ink-50 p-3.5 text-sm text-ink-700">
        {pending > 0 && <><b className="text-ink-900">{t('friends.not_answered_bold', { count: pending })}</b> </>}
        {rankingText}
      </p>
      {pending > 0 && iOrganize && <ShareMissingButton match={match} creatorName={creator?.name} />}

      {markFor && (
        <FriendRoundSheet match={match} game={markFor.game} roundNumber={markFor.round.number} games={games} editing={markFor.editing}
          nextCourts={markFor.editing ? null : nextCourtsFor(markFor.round)}
          onClose={() => setMarkFor(null)}
          onSaved={(res) => {
            if (res?.next_error) setNextIssue({ n: markFor.round.number + 1, after: markFor.round.number })
            setMarkFor(null); onChanged()
          }} />
      )}
      {kindFor && (
        <RoundKindSheet match={match} game={kindFor.game} roundNumber={kindFor.round.number} games={games}
          onClose={() => setKindFor(null)} onSaved={() => { setKindFor(null); onChanged() }} />
      )}
      {editFor && (
        <Sheet title={t('friends.round_n', { n: editFor.round.number })} onClose={() => setEditFor(null)}>
          <div className="space-y-2.5">
            <button type="button" onClick={() => { setPairsFor(editFor.round); setEditFor(null) }} className={outline}>
              <ArrowLeftRight size={15} /> {t('friends.edit_pairs')}
            </button>
            <button type="button" onClick={() => { setMarkFor({ ...editFor, editing: true }); setEditFor(null) }} className={outline}>
              {t('friends.change_result')}
            </button>
            <button type="button" onClick={() => { setRemoveFor(editFor.round); setEditFor(null) }}
              className="press min-h-[52px] w-full rounded-ctrl border-[1.5px] border-danger/40 bg-white px-4 text-[15px] font-extrabold text-danger">
              {t('friends.delete_round')}
            </button>
          </div>
        </Sheet>
      )}
      {swapFor && (
        <SwapPairsSheet match={match} round={swapFor} proposal={proposalAfter(swapFor)}
          onEdit={() => { setPairsFor(swapFor); setSwapFor(null) }}
          onClose={() => setSwapFor(null)} onSaved={() => { setSwapFor(null); onChanged() }} />
      )}
      {pairsFor && (
        <EditPairsSheet match={match} round={pairsFor} players={players}
          onClose={() => setPairsFor(null)} onSaved={() => { setPairsFor(null); onChanged() }} />
      )}
      <ConfirmSheet
        open={!!removeFor}
        danger
        title={removeFor ? t('friends.delete_round_title', { n: removeFor.number }) : ''}
        message={removeFor ? removeMessage(removeFor) : ''}
        cancelLabel={t('friends.remove_round_keep')}
        confirmLabel={t('friends.delete_round')}
        onConfirm={async () => { await removeFriendMatchRound(match.id, removeFor.number); onChanged() }}
        onClose={() => setRemoveFor(null)}
        errorOf={(err) => roundSaveError(t, err)}
      />
    </div>
  )
}
