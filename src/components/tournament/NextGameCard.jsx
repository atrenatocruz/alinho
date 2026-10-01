// «O teu próximo jogo» na página do torneio (design-handoff/2026-10-01-
// torneio-proximo-jogo, aprovado pelo Francisco a 1 out: «sim, tá bem
// assim»). Antes era um lima «O teu próximo jogo · sáb 16:20 ›» que só
// mudava o separador lá em baixo — no telemóvel não se via nada a mudar.
//
// Agora é um cartão com o jogo à vista: dia, hora e campo em grande, quem
// joga contra quem, e «Ver o jogo ›», que abre a folha do jogo (MatchSheet).
// Sem adversário ainda: «Contra quem ganhar <jogo>». Sem mais jogos, sai.
//
// Os jogos vêm do quadro da categoria (getCategoryBoard), como em «Os meus
// jogos»: o `my_matches` da página nunca veio da base de dados (#508).
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../contexts/AuthContext'
import useCategoryBoard from './useCategoryBoard'
import MatchSheet from './MatchSheet'
import { sourceText } from './sourceText'
import { TREE_ROUNDS, sourceOf } from './treeLayout'
import { isThirdPlace } from './matchPath'
import { isMatchDone, myMatchesFromBoard } from '../../lib/myTournamentMatches'
import { TOURNAMENT_TZ, hhmmInTz } from '../../lib/tournamentDay'

const DRAWN = ['sorteada', 'a_decorrer', 'terminada']

/** Os meus jogos e o próximo, para a página decidir o lima (um só lima, 1
 *  out) e para o cartão. `entries` = as minhas inscrições ativas. */
export function useMyNextGame(entries = [], categories = [], fallback = []) {
  // A inscrição de uma categoria já sorteada; senão a primeira (sem sorteio o
  // quadro vem vazio e não há jogos).
  const drawn = entries.find((e) => DRAWN.includes(categories.find((c) => c.id === e.category_id)?.status)) || entries[0]
  const board = useCategoryBoard(drawn?.category_id || null)
  const myIds = drawn?.entry_id ? [drawn.entry_id] : []
  const rows = myMatchesFromBoard(board, myIds)
  // Sem quadro (localhost sem as vistas): o `my_matches` do mock.
  const list = rows.length ? rows : fallback
  const next = list.find((m) => !(m.done ?? isMatchDone(m)) && !['terminado', 'falta', 'desistencia'].includes(m.status)) || null
  return {
    hasGames: list.length > 0,
    next,
    board,
    myIds,
    category: categories.find((c) => c.id === (next?.category_id || drawn?.category_id)) || null,
  }
}

const shortName = (full = '') => {
  const parts = String(full).replace(/\(.*?\)/g, '').trim().split(/\s+/)
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0] || ''
}

export default function NextGameCard({ game, onOpenList }) {
  const { t, i18n } = useTranslation()
  const { profile } = useAuth()
  const [open, setOpen] = useState(false)
  const { next, board, myIds, category } = game
  if (!next) return null

  const match = (board.matches || []).find((m) => m.id === next.id) || null
  const mine = match ? (myIds.includes(match.entry_a_id) ? 'a' : 'b') : null
  const myEntry = match ? board.entries?.[mine === 'a' ? match.entry_a_id : match.entry_b_id] : null
  const theirId = match ? (mine === 'a' ? match.entry_b_id : match.entry_a_id) : null
  const their = theirId ? board.entries?.[theirId] : null

  // O parceiro: o outro nome da minha dupla.
  const me = shortName(profile?.name)
  const partner = (myEntry?.players || []).map(shortName).find((n) => n && n !== me) || null

  // De onde vem o adversário, quando ainda não se sabe — como no quadro.
  const present = TREE_ROUNDS.filter((r) => (board.matches || []).some((m) => !m.group_id && m.round === r))
  const labelOf = (side) => {
    if (isThirdPlace(match) && present.includes('SF')) return t('tournament.tree.loser_SF', { n: side === 'a' ? 1 : 2 })
    const src = !match.group_id && sourceOf(match.round, match.bracket_slot || 1, side, present)
    if (src) return t(`tournament.tree.winner_${src.round}`, { n: src.n })
    return sourceText(side === 'a' ? match.source_a : match.source_b, null, t) || t('tournament.draw.tbd')
  }
  const labels = match ? { a: labelOf('a'), b: labelOf('b') } : {}
  // «Vencedor Q3» → «Contra quem ganhar Q3»; «2.º do Grupo B» fica como está.
  const theirLabel = match ? labels[mine === 'a' ? 'b' : 'a'] : t('tournament.draw.tbd')
  const winnerOf = /^(Vencedor|Winner)\s+/i.test(theirLabel)
    ? t('tournament.next_game_winner_of', { game: theirLabel.replace(/^(Vencedor|Winner)\s+/i, '') })
    : theirLabel

  // «Sábado · 16:20 · Campo 2», na hora de Portugal.
  const when = match?.scheduled_at
    ? (() => {
      const d = new Date(match.scheduled_at)
      const day = d.toLocaleDateString(i18n.language, { weekday: 'long', timeZone: TOURNAMENT_TZ })
      return [day.charAt(0).toUpperCase() + day.slice(1).replace('-feira', ''), hhmmInTz(match.scheduled_at)]
    })()
    : next.date
      ? (() => {
        const day = new Date(`${next.date}T12:00`).toLocaleDateString(i18n.language, { weekday: 'long' })
        return [day.charAt(0).toUpperCase() + day.slice(1).replace('-feira', ''), next.time]
      })()
      : []
  const head = [...when, next.court || match?.court_name].filter(Boolean).join(' · ')
  const opponent = their?.name || next.opponent

  return (
    <div>
      {/* Sem o jogo no quadro (só no mock), abre a lista dos meus jogos. */}
      <button type="button" onClick={() => (match ? setOpen(true) : onOpenList?.())}
        className="press block w-full rounded-card border-2 border-[#86EFAC] bg-white p-4 text-left">
        <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-[#166534]">
          {t('tournament.next_game_label', { code: category?.code || '' })}
        </p>
        {head && <p className="mt-1.5 font-display text-[22px] font-extrabold leading-tight text-ink-900">{head}</p>}
        {/* Sem adversário ainda: a frase no lugar das duplas (SPEC, ponto 4). */}
        {opponent ? (
          <div className="mt-2 flex items-baseline justify-between gap-3 text-sm text-ink-900">
            <span className="min-w-0 truncate">{partner ? t('tournament.next_game_us', { partner }) : t('tournament.next_game_you')}</span>
            <span className="shrink-0 text-muted">{t('gamedetails.vs')}</span>
            <span className="min-w-0 truncate text-right">{opponent}</span>
          </div>
        ) : (
          <p className="mt-2 text-sm text-ink-900">{winnerOf}</p>
        )}
        <p className="mt-2.5 text-sm font-extrabold text-ink-900">{t('tournament.next_game_open')} ›</p>
      </button>
      {/* Leva à vista «Os meus jogos» (com o pedir correção e o partilhar).
          Passa a pastilha no Horário depois do Smash Cup (UX/PO, 1 out). */}
      <button type="button" onClick={() => onOpenList?.()}
        className="mt-1.5 min-h-[32px] text-left text-xs text-muted underline underline-offset-2">
        {t('tournament.next_game_hint')}
      </button>
      {open && match && (
        <MatchSheet match={match} entries={board.entries} matches={board.matches} labels={labels}
          myIds={myIds} groups={board.groups || []} onClose={() => setOpen(false)} />
      )}
    </div>
  )
}
