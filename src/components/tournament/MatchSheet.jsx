// O detalhe de um jogo do torneio: abre ao tocar num cartão do Quadro ou do
// Horário (28 set, canvas «Torneio — Quadro e Horário»). As duas duplas
// frente a frente com as fotos grandes e o resultado; «Como chegaram aqui»
// (o último jogo de cada uma) e «A seguir» (para onde vai quem ganha e,
// nas meias, quem perde). Só mostra — marcar resultados é no Gerir.
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { X, Trophy, Medal, ArrowRight } from 'lucide-react'
import { LILAC } from './TournamentBits'
import { TeamAvatars, LiveChip, MINE, shortName, teamLines } from './MatchCard'
import { isDone } from './treeLayout'
import { isThirdPlace, nextOf, previousOf } from './matchPath'
import { matchTieBreak } from './tieBreak'
import { hhmmInTz, TOURNAMENT_TZ } from '../../lib/tournamentDay'

/** «Meia-final 2», «Quartos de final», «Grupo A», «🏆 Final». */
export function phaseTitle(match, groups, t) {
  if (match.group_id) return groups?.find((g) => g.id === match.group_id)?.name || t('tournament.draw.groups_label')
  if (isThirdPlace(match)) return t('tournament.tree.title_3P')
  if (match.round === 'SF') return t('tournament.draw.semi_n', { n: match.bracket_slot || 1 })
  return t(`tournament.tree.title_${match.round}`)
}

/** «Quartos», «Meia-final 1», «Grupo A» — a etiqueta curta das linhas. */
function phaseShort(match, groups, t) {
  if (match.group_id) return groups?.find((g) => g.id === match.group_id)?.name || t('tournament.draw.groups_label')
  if (isThirdPlace(match)) return t('tournament.draw.round_3P')
  if (match.round === 'SF') return t('tournament.draw.semi_n', { n: match.bracket_slot || 1 })
  return t(`tournament.draw.round_${match.round}`)
}

/** «domingo 10:00» — o dia por extenso e a hora de Portugal. */
function whenOf(iso, lang) {
  if (!iso) return null
  const day = new Intl.DateTimeFormat(lang, { weekday: 'long', timeZone: TOURNAMENT_TZ })
    .format(new Date(iso)).replace('-feira', '')
  return `${day} ${hhmmInTz(iso)}`
}

function FaceSide({ team, fallback, mine, seed, t }) {
  const { title, sub } = teamLines(team)
  return (
    <div className="flex min-w-0 flex-col items-center gap-2 text-center">
      <TeamAvatars people={team?.people} size="w-[52px] h-[52px] text-lg" overlap="-ml-3" ring="ring-[3px] ring-surface" />
      {mine ? (
        <span className="rounded-full px-2 py-0.5 text-[11px] font-extrabold text-[#166534]" style={{ background: MINE }}>{t('tournament.sheet.your_pair')}</span>
      ) : seed ? (
        <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-extrabold text-ink-500">{t('tournament.sheet.seed', { n: seed })}</span>
      ) : null}
      {team ? (
        <span className="min-w-0 break-words text-sm font-extrabold leading-tight text-ink-900">
          {title}
          {sub && <span className="mt-0.5 block text-xs font-medium text-ink-500">{sub}</span>}
        </span>
      ) : (
        <span className="text-sm italic text-ink-500">{fallback}</span>
      )}
    </div>
  )
}

export default function MatchSheet({ match, entries, matches, labels = {}, myIds = [], groups = [], onClose }) {
  const { t, i18n } = useTranslation()
  useEffect(() => {
    if (!match) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [match, onClose])

  if (!match) return null

  const done = isDone(match)
  const live = match.status === 'a_decorrer'
  const teamA = match.entry_a_id ? entries[match.entry_a_id] : null
  const teamB = match.entry_b_id ? entries[match.entry_b_id] : null
  const hasScore = (done || live) && match.score_a != null && match.score_b != null
  const winner = done ? match.winner_entry_id : null
  const when = whenOf(match.scheduled_at, i18n.language)
  const sub = [match.court_name, when, when && !done ? t('tournament.sheet.planned') : null].filter(Boolean).join(' · ')

  const tb = match.status === 'terminado' ? matchTieBreak(match) : null
  const scoreNote = [
    tb?.tb ? t(tb.super ? 'tournament.tree.super_tb' : 'tournament.tree.tb', { a: tb.tb.split('-')[0], b: tb.tb.split('-')[1] }) : tb?.sets || null,
    match.status === 'falta' ? t('tournament.draw.walkover') : null,
    match.status === 'desistencia' ? t('tournament.draw.retired') : null,
  ].filter(Boolean).join(' · ')

  // Como chegaram aqui: o último jogo acabado de cada dupla.
  const nameOf = (id, fallback) => shortName(entries[id]) || fallback || t('tournament.draw.tbd')
  const before = [match.entry_a_id, match.entry_b_id].filter(Boolean).map((id) => {
    const prev = previousOf(match, id, matches)
    if (!prev) return null
    const oppId = prev.entry_a_id === id ? prev.entry_b_id : prev.entry_a_id
    const won = prev.winner_entry_id === id
    const mineScore = prev.entry_a_id === id ? prev.score_a : prev.score_b
    const theirs = prev.entry_a_id === id ? prev.score_b : prev.score_a
    return {
      key: `${id}-${prev.id}`,
      phase: phaseShort(prev, groups, t),
      name: nameOf(id),
      verb: t(won ? 'tournament.sheet.beat' : 'tournament.sheet.lost_to', { name: nameOf(oppId) }),
      score: mineScore != null && theirs != null ? `${mineScore}-${theirs}` : null,
    }
  }).filter(Boolean)

  // A seguir: para onde vai quem ganha e, nas meias, quem perde.
  const { win, lose } = nextOf(match, matches)
  const slot = match.bracket_slot || 1
  const nextRow = (next, loser) => {
    if (!next) return null
    // O lado em que esta dupla entra no jogo seguinte e quem está do outro.
    const mySide = loser ? (slot === 1 ? 'a' : 'b') : (slot % 2 ? 'a' : 'b')
    const oppId = mySide === 'a' ? next.entry_b_id : next.entry_a_id
    const opp = oppId ? nameOf(oppId) : null
    const decided = done && winner
    const who = decided
      ? nameOf(loser ? (winner === match.entry_a_id ? match.entry_b_id : match.entry_a_id) : winner)
      : t(loser ? 'tournament.sheet.loser' : 'tournament.sheet.winner')
    const round = isThirdPlace(next) ? t('tournament.draw.round_3P') : t(`tournament.draw.round_${next.round}`)
    return {
      key: next.id,
      loser,
      title: `${who} → ${round}`,
      detail: [opp ? t('tournament.sheet.against', { name: opp }) : null, whenOf(next.scheduled_at, i18n.language), next.court_name].filter(Boolean).join(' · '),
    }
  }
  const after = [nextRow(win, false), nextRow(lose, true)].filter(Boolean)

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/45 animate-fade-in sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="match-sheet-title"
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-[24px] bg-white px-5 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-2.5 shadow-lift sm:rounded-[24px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto h-1 w-9 rounded-full bg-ink-200" />

        <div className="mt-3 flex min-h-[28px] items-center justify-between gap-2">
          <span>{live && <LiveChip />}</span>
          <button type="button" onClick={onClose} aria-label={t('tournament.sheet.close')}
            className="-my-2 -mr-2.5 flex h-11 w-11 items-center justify-center rounded-full text-ink-900 hover:bg-ink-50">
            <X size={20} strokeWidth={2.2} />
          </button>
        </div>
        <h2 id="match-sheet-title" className="font-display text-[26px] font-extrabold leading-tight text-ink-900">{phaseTitle(match, groups, t)}</h2>
        {sub && <p className="mt-0.5 text-sm text-ink-500">{sub}</p>}

        {/* Frente a frente */}
        <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-1 rounded-card bg-surface px-3 pb-3.5 pt-4">
          <FaceSide team={teamA} fallback={labels.a} mine={!!teamA && myIds.includes(match.entry_a_id)} seed={teamA?.seed} t={t} />
          <div className="flex flex-col items-center gap-0.5 px-1 pt-1.5">
            {hasScore ? (
              <span className="whitespace-nowrap font-display text-[44px] font-extrabold leading-none tabular-nums">
                <span className={winner && winner !== match.entry_a_id ? 'text-ink-200' : 'text-ink-900'}>{match.score_a}</span>
                <span className="px-1.5 text-ink-200">–</span>
                <span className={winner && winner !== match.entry_b_id ? 'text-ink-200' : 'text-ink-900'}>{match.score_b}</span>
              </span>
            ) : (
              <span className="font-display text-2xl font-extrabold uppercase text-ink-200">{t('gamedetails.vs')}</span>
            )}
            {scoreNote && <span className="text-center text-xs text-ink-500">{scoreNote}</span>}
          </div>
          <FaceSide team={teamB} fallback={labels.b} mine={!!teamB && myIds.includes(match.entry_b_id)} seed={teamB?.seed} t={t} />
        </div>

        {before.length > 0 && (
          <>
            <p className="mb-2 mt-5 font-mono text-[11px] font-bold uppercase tracking-wide text-ink-500">{t('tournament.sheet.how_they_got_here')}</p>
            <div className="divide-y divide-line rounded-ctrl border border-line">
              {before.map((b) => (
                <div key={b.key} className="flex items-center gap-2.5 px-3 py-2.5">
                  <span className="w-[76px] shrink-0 truncate font-mono text-[10px] font-bold uppercase tracking-wide text-ink-500">{b.phase}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink-700">
                    <b className="font-extrabold text-ink-900">{b.name}</b> {b.verb}
                  </span>
                  {b.score && <span className="shrink-0 font-display text-[15px] font-extrabold tabular-nums text-ink-900">{b.score}</span>}
                </div>
              ))}
            </div>
          </>
        )}

        {after.length > 0 && (
          <>
            <p className="mb-2 mt-5 font-mono text-[11px] font-bold uppercase tracking-wide text-ink-500">{t('tournament.sheet.next')}</p>
            <div className="space-y-2">
              {after.map((a) => (
                <div key={a.key} className={`flex items-center gap-3 rounded-ctrl px-3 py-2.5 ${a.loser ? 'bg-surface' : ''}`}
                  style={a.loser ? undefined : { background: LILAC.bg }}>
                  {a.loser
                    ? <Medal size={20} strokeWidth={2} className="shrink-0 text-[#9A6A3A]" aria-hidden />
                    : a.key === matches.find((m) => m.round === 'F' && m.stage === match.stage)?.id
                      ? <Trophy size={20} strokeWidth={2} className="shrink-0" style={{ color: LILAC.text }} aria-hidden />
                      : <ArrowRight size={20} strokeWidth={2} className="shrink-0" style={{ color: LILAC.text }} aria-hidden />}
                  <span className="min-w-0 flex-1 text-[13px] text-ink-700">
                    <b className="block font-extrabold text-ink-900">{a.title}</b>
                    {a.detail}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        <button type="button" onClick={onClose}
          className="mt-6 min-h-[48px] w-full rounded-ctrl border border-line bg-surface px-4 text-[15px] font-extrabold text-ink-900 transition-transform duration-fast active:scale-[0.98]">
          {t('tournament.sheet.close')}
        </button>
      </div>
    </div>,
    document.body,
  )
}
