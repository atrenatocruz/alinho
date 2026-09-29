// O cartão de um jogo do torneio, o mesmo no Quadro e no Horário (28 set,
// canvas «Torneio — Quadro e Horário», aprovado pelo Renato). Como os
// cartões de campo dos mixs: em cima o campo e a hora, depois as duas
// duplas com as fotos, «VS» no meio e o resultado à direita. Tocar abre o
// detalhe (MatchSheet).
//   · quem ganhou a negro, quem perdeu a cinzento;
//   · a dupla de quem vê a verde, com «· tu»;
//   · a decorrer: contorno preto e a etiqueta com a bola lima;
//   · a final: contorno preto e fundo lilás;
//   · por saber: contorno tracejado lilás, e as fotos vazias a tracejado.
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { Avatar } from '../ui'
import { LILAC } from './TournamentBits'
import { isDone } from './treeLayout'

export const MINE = '#DCFCE7'

/** As fotos dos dois, uma por cima da outra. Sem dupla: dois lugares vazios. */
export function TeamAvatars({ people, size = 'w-[30px] h-[30px] text-xs', overlap = '-ml-2.5', ring = 'ring-2 ring-white' }) {
  if (!people?.length) {
    return (
      <span className="flex shrink-0">
        {[0, 1].map((k) => (
          <span key={k} className={`${size} ${k ? overlap : ''} shrink-0 rounded-full border-[1.5px] border-dashed bg-white`} style={{ borderColor: LILAC.border }} />
        ))}
      </span>
    )
  }
  return (
    <span className="flex shrink-0">
      {people.map((p, k) => (
        <span key={k} className={k ? overlap : ''}>
          <Avatar name={p.name} url={p.avatar_url} size={`${size} ${ring}`} />
        </span>
      ))}
    </span>
  )
}

/** O nome grande e o que vai por baixo: o nome da equipa e os dois jogadores,
 *  ou só os jogadores quando a dupla não tem nome. */
export function teamLines(team) {
  if (!team) return { title: null, sub: null }
  const people = (team.people?.length ? team.people.map((p) => p.name) : team.players) || []
  if (team.team_name) return { title: team.team_name, sub: people.join(' · ') || null }
  return { title: team.name || people.join(' / '), sub: null }
}

/** «Bruno / Diogo» — para as frases curtas do detalhe. */
export function shortName(team) {
  if (!team) return null
  if (team.team_name) return team.team_name
  const first = (team.people || []).map((p) => String(p.name).split(/\s+/)[0]).filter(Boolean)
  return first.length ? first.join(' / ') : team.name
}

function Side({ team, fallback, score, won, lost, mine, compact, onLilac }) {
  const { t } = useTranslation()
  const { title, sub } = teamLines(team)
  const ring = mine ? 'ring-2 ring-[#DCFCE7]' : onLilac ? 'ring-2 ring-[#E9E7FB]' : 'ring-2 ring-white'
  return (
    <span
      className={`flex items-center ${compact ? 'gap-2' : 'gap-2.5'} ${mine ? `-mx-2 rounded-[10px] px-2 ${compact ? 'py-1' : 'py-1.5'}` : compact ? 'py-1' : 'py-[5px]'}`}
      style={mine ? { background: MINE } : undefined}
    >
      <span className={compact ? 'w-[44px] shrink-0' : 'w-[54px] shrink-0'}>
        <TeamAvatars
          people={team?.people}
          size={compact ? 'w-6 h-6 text-[10px]' : 'w-[30px] h-[30px] text-xs'}
          overlap={compact ? '-ml-1.5' : '-ml-2'}
          ring={ring}
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        {team ? (
          <span className={`truncate ${compact ? 'text-[13px]' : 'text-[15px]'} ${won ? 'font-extrabold text-ink-900' : lost ? 'font-medium text-ink-500' : 'font-bold text-ink-900'}`}>
            {title}
            {mine && <span className="font-medium text-[#166534]"> · {t('agenda.you').toLowerCase()}</span>}
          </span>
        ) : (
          <span className={`truncate italic text-ink-500 ${compact ? 'text-[13px]' : 'text-sm'}`}>{fallback}</span>
        )}
        {sub && <span className={`truncate text-ink-500 ${compact ? 'text-[11px]' : 'text-xs'}`}>{sub}</span>}
      </span>
      {score != null && (
        <b className={`shrink-0 text-right font-display font-extrabold tabular-nums ${compact ? 'min-w-[16px] text-lg' : 'min-w-[22px] text-2xl'} ${lost ? 'text-ink-500' : 'text-ink-900'}`}>
          {score}
        </b>
      )}
    </span>
  )
}

export function LiveChip({ small = false }) {
  const { t } = useTranslation()
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full bg-ink-900 font-mono font-bold uppercase tracking-wide text-white ${small ? 'px-[7px] py-0.5 text-[9px]' : 'px-2 py-[3px] text-[10px]'}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-lime-400" />
      {t('tournament.draw.live_upper')}
    </span>
  )
}

/**
 * match    a linha da vista tournament_public_matches
 * entries  { [entryId]: { name, team_name, people, ... } }
 * labels   { a, b } — o que se escreve num lado ainda sem dupla
 * head     a linha de cima («Campo 1 · Sáb 09:00»)
 * foot     a linha de baixo (tie-break, falta…), ou nada
 */
export default function MatchCard({ match, entries, labels = {}, myIds = [], head, foot, final = false, compact = false, onOpen }) {
  const { t } = useTranslation()
  const done = isDone(match)
  const live = match.status === 'a_decorrer'
  const known = match.entry_a_id && match.entry_b_id
  const winner = done ? match.winner_entry_id : null
  const hasScore = (done || live) && match.score_a != null && match.score_b != null
  const frame = final ? 'border-2 border-ink-900'
    : live ? 'border-[1.5px] border-ink-900'
    : done || known ? 'border border-line'
    : 'border border-dashed'
  const side = (key) => {
    const id = key === 'a' ? match.entry_a_id : match.entry_b_id
    return (
      <Side
        team={id ? entries[id] : null}
        fallback={labels[key] || t('tournament.draw.tbd')}
        score={hasScore ? (key === 'a' ? match.score_a : match.score_b) : null}
        won={!!winner && winner === id}
        lost={!!winner && !!id && winner !== id}
        mine={!!id && myIds.includes(id)}
        compact={compact}
        onLilac={final}
      />
    )
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      data-mine={(myIds.includes(match.entry_a_id) || myIds.includes(match.entry_b_id)) || undefined}
      className={`flex w-full flex-col rounded-card bg-white text-left transition-[box-shadow,transform] duration-fast hover:shadow-lift active:scale-[0.98] ${compact ? 'gap-0.5 px-3 pb-2 pt-2' : 'gap-1.5 px-3.5 py-3'} ${frame}`}
      style={{
        background: final ? LILAC.bg : undefined,
        borderColor: !final && !live && !(done || known) ? LILAC.border : undefined,
      }}
    >
      <span className={`flex w-full items-center justify-between gap-2 ${compact ? 'min-h-[18px]' : 'min-h-[22px]'}`}>
        <span className="truncate font-mono text-[10px] font-bold uppercase tracking-wide text-ink-500">{head}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          {live && <LiveChip small={compact} />}
          {!compact && <ChevronRight size={16} strokeWidth={2.2} className="text-ink-200" aria-hidden />}
        </span>
      </span>
      <span className="block w-full">{side('a')}</span>
      {!compact && (
        <span className="flex w-full items-center gap-2 py-0.5" aria-hidden>
          <span className="h-px flex-1 bg-line" />
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-ink-200">{t('gamedetails.vs')}</span>
          <span className="h-px flex-1 bg-line" />
        </span>
      )}
      <span className="block w-full">{side('b')}</span>
      {foot && <span className={`block w-full text-ink-500 ${compact ? 'truncate font-mono text-[10px] uppercase tracking-wide' : 'text-xs'}`}>{foot}</span>}
    </button>
  )
}
