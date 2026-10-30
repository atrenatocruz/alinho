// Separador «Grupos» da página do torneio (Trello #364, «Torneio 4/6»).
// Desenho: SPEC §4 (tabelas de grupo com regra de desempate) e o ecrã
// «Sorteio · por confirmar» do HTML v7.
//
// Abre sem conta. A classificação não vem do servidor: é calculada aqui com
// as contas de `tournamentFormat.js`, que é o único sítio onde o desempate
// vive — vitórias, confronto direto, diferença de jogos, jogos ganhos.
import { useTranslation } from 'react-i18next'
import { Users } from 'lucide-react'
import { EmptyState } from '../ui'
import RuleHint from '../RuleHint'
import { Me, MonoLabel } from './TournamentBits'
import useCategoryBoard from './useCategoryBoard'
import { standingsOf, qualifiersPerGroup, groupPoints } from '../../lib/tournamentDraw'
import { PanelSkeleton } from './TournamentSkeleton'
import { shortName } from './shareData'
import { phaseScorings, scoringName } from './scoringText'

const GROUP_DONE = ['terminado', 'falta', 'desistencia']
// As medalhas da «Tabela final» do grupo único (UX, 23 out).
const MEDALS = ['#F5C518', '#C7CCD1', '#D08C55']

// O apelido: a última palavra, sem o que está entre parênteses; um nome que
// acaba num número («Jogador 7») fica inteiro, como no shortName.
function surname(name) {
  const parts = String(name || '').replace(/\([^)]*\)/g, ' ').trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2 || /\d/.test(parts.at(-1))) return parts.join(' ')
  return parts.at(-1)
}
/** No grupo único (UX, 23 out): o nome de equipa, ou os dois apelidos
 *  («Figueira / Lopes»), e por baixo os dois abreviados («Rita F. · Ana L.»). */
function pairLines(team) {
  const players = (team?.players || []).filter(Boolean)
  return {
    name: team?.team_name || (players.length ? players.map(surname).join(' / ') : team?.name || ''),
    players: players.length ? players.map(shortName).join(' · ') : '',
  }
}
// A última palavra presa ao «tu» e ao «=»: nunca ficam sozinhos numa linha.
function NameWithTags({ text, children }) {
  const i = text.lastIndexOf(' ')
  return (
    <span className="text-xs font-bold text-ink-900">
      {i > 0 ? `${text.slice(0, i)} ` : ''}
      <span className="whitespace-nowrap">{i > 0 ? text.slice(i + 1) : text}{children}</span>
    </span>
  )
}

/** «Um grupo só, todos contra todos» (aprovado pelo Francisco a 23 out;
 *  design-handoff/2026-10-23-torneio-um-grupo-so): uma tabela só, sem
 *  quadro nem final, e ganha o 1.º. As colunas, o «tu» e o «?» do desempate
 *  são os da tabela dos grupos. No fim, «Tabela final» com medalhas. Um
 *  empate no 1.º que o desempate da FPP não separa fica marcado com «=» e a
 *  categoria não fecha: a regra está em revisão (Francisco, 23 out). */
function SingleGroup({ group, matches, entries, myEntryId, category, scoring, t }) {
  const rows = standingsOf(group, matches)
  const mine = matches.filter((m) => m.stage === 'grupo' && m.group_id === group.id)
  const played = mine.filter((m) => m.score_a != null).length
  const done = mine.length > 0 && mine.every((m) => GROUP_DONE.includes(m.status) || m.winner_entry_id)
  const closed = category?.status === 'terminada'
  // Empate no 1.º que as regras não desfazem: só com o grupo acabado.
  const tiedTop = done && rows[0]?.tiedWith?.length ? [rows[0].id, ...rows[0].tiedWith] : []
  const isTied = (id) => tiedTop.includes(id)
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <MonoLabel>{closed ? t('tournament.single.final_table') : t('tournament.single.heading', { count: rows.length })} · {scoring}</MonoLabel>
        <span className="font-mono text-[11px] font-bold uppercase tracking-widest text-ink-500">{t('tournament.draw.played_of', { played, total: mine.length })}</span>
      </div>

      <section className="card mb-3 !p-0 overflow-hidden">
        <table className="w-full table-fixed border-collapse text-xs">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-muted">
              <th className="w-8 py-1.5 text-center font-semibold">#</th>
              <th className="py-1.5 text-left font-semibold">{t('tournament.draw.col_team')}</th>
              <th className="w-6 py-1.5 text-center font-semibold" title={t('tournament.draw.col_played_full')}>{t('tournament.draw.col_played')}</th>
              <th className="w-6 py-1.5 text-center font-semibold" title={t('tournament.draw.col_wins_full')}>{t('tournament.draw.col_wins')}</th>
              <th className="w-9 py-1.5 text-center font-semibold" title={t('tournament.draw.col_diff_full')}>{t('tournament.draw.col_diff')}</th>
              <th className="w-8 py-1.5 text-center font-semibold" title={t('tournament.draw.col_games_won_full')}>{t('tournament.draw.col_games_won')}</th>
              <th className="w-9 py-1.5 pr-2 text-center font-semibold text-ink-900" title={t('tournament.draw.col_points_full')}>{t('tournament.draw.col_points')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const team = entries[row.id]
              const me = myEntryId && row.id === myEntryId
              const place = isTied(row.id) && !closed ? 1 : i + 1
              const medal = closed && i < 3
              return (
                <tr key={row.id} className={`border-t border-ink-50 ${me ? 'bg-[#E9F7D2]' : ''}`}>
                  <td className="py-2 text-center">
                    <span className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-full font-mono text-xs font-bold text-ink-900"
                      style={medal ? { background: MEDALS[i] } : undefined}>
                      {place}
                    </span>
                  </td>
                  <td className="py-2 pr-1.5">
                    <NameWithTags text={pairLines(team).name || t('ui.empty_tbd')}>
                      {me ? <Me>{t('tournament.draw.you')}</Me> : null}
                      {isTied(row.id) && !closed && <span className="ml-1 rounded-full bg-[#FFF4D6] px-1.5 font-mono text-[10px] font-bold text-[#8A5E00]">=</span>}
                    </NameWithTags>
                    {pairLines(team).players && <span className="block truncate text-[11px] text-muted">{pairLines(team).players}</span>}
                  </td>
                  <td className="py-2 text-center font-mono text-xs text-muted">{row.played}</td>
                  <td className="py-2 text-center font-mono text-xs text-muted">{row.wins}</td>
                  <td className="py-2 text-center font-mono text-xs text-muted">{row.diff > 0 ? `+${row.diff}` : row.diff}</td>
                  <td className="py-2 text-center font-mono text-xs text-muted">{row.gamesWon}</td>
                  <td className="py-2 pr-2 text-center font-mono text-sm font-extrabold text-ink-900">{groupPoints(row)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="border-t border-ink-50 px-3 pt-1.5 text-[12px] leading-snug text-muted">{t('tournament.draw.legend')}</p>
        <p className="px-3 py-1.5 text-xs text-muted">{t('tournament.single.note')}</p>
        <RuleHint className="px-3 pb-1.5" label={t('tournament.draw.points_hint')} note={t('tournament.draw.points_hint_note')} />
        <RuleHint className="px-3 pb-1.5" label={t('tournament.draw.tiebreak_hint')}
          items={[1, 2, 3, 4, 5].map((n) => t(`tournament.draw.tiebreak_hint_${n}`))} note={t('tournament.draw.tiebreak_hint_note')} />
      </section>
    </div>
  )
}

/** Uma tabela de grupo. As duplas que passam ficam marcadas à esquerda e
 *  com o lugar em destaque — é o que se lê de relance no telemóvel. */
function GroupTable({ group, matches, entries, qualifiers, myEntryId, scoring, t }) {
  const rows = standingsOf(group, matches)
  const played = matches.filter(
    (m) => m.stage === 'grupo' && m.group_id === group.id && m.score_a != null,
  ).length
  const total = matches.filter((m) => m.stage === 'grupo' && m.group_id === group.id).length
  // Só se marca quem passa quando o grupo acabou (Trello #513): a meio, a
  // marca prometia um apuramento que ainda pode mudar. Acabado = cada jogo
  // tem resultado ou vencedor gravado (falta/desistência), a mesma conta do
  // «Passar ao quadro».
  const done = total > 0 && matches
    .filter((m) => m.stage === 'grupo' && m.group_id === group.id)
    .every((m) => ['terminado', 'falta', 'desistencia'].includes(m.status) || m.winner_entry_id)
  // Empatadas por agora (#592): a meio do grupo, duas duplas que ainda não
  // jogaram entre si não se separam — a diferença geral já não conta. Ficam
  // com a mesma posição, «2=», até o jogo entre elas decidir (UX, 7 out). O
  // sorteio só se fala quando o grupo acaba.
  const firstOf = {}
  rows.forEach((row, i) => {
    const tie = !done && row.tiedWith?.length ? [row.id, ...row.tiedWith] : null
    if (!tie) return
    const first = Math.min(...tie.map((id) => rows.findIndex((r) => r.id === id)).filter((n) => n >= 0))
    firstOf[row.id] = first
  })
  const anyTie = Object.keys(firstOf).length > 0

  return (
    <section className="card mb-3 !p-0 overflow-hidden">
      <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
        {/* «Grupo 1 · pro set a 9»: a forma de jogar da fase (26 out). */}
        <b className="text-sm font-extrabold text-ink-900">{group.name}<span className="font-semibold text-muted"> · {scoring}</span></b>
        <span className="font-mono text-xs text-muted">
          {t('tournament.draw.played_of', { played, total })}
        </span>
      </header>

      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-muted">
            <th className="w-7 py-1.5 text-center font-semibold">#</th>
            <th className="py-1.5 text-left font-semibold">{t('tournament.draw.col_team')}</th>
            <th className="w-8 py-1.5 text-center font-semibold" title={t('tournament.draw.col_played_full')}>
              {t('tournament.draw.col_played')}
            </th>
            <th className="w-8 py-1.5 text-center font-semibold" title={t('tournament.draw.col_wins_full')}>
              {t('tournament.draw.col_wins')}
            </th>
            <th className="w-10 py-1.5 text-center font-semibold" title={t('tournament.draw.col_diff_full')}>
              {t('tournament.draw.col_diff')}
            </th>
            {/* Jogos ganhos: o 4.º critério do desempate — sem a coluna não
                se percebia porque é que uma dupla ficou à frente (#513). */}
            <th className="w-9 py-1.5 text-center font-semibold" title={t('tournament.draw.col_games_won_full')}>
              {t('tournament.draw.col_games_won')}
            </th>
            {/* Pontos: 3 por vitória, 0 por derrota (Renato, 29 set). */}
            <th className="w-10 py-1.5 pr-2 text-center font-semibold text-ink-900" title={t('tournament.draw.col_points_full')}>
              {t('tournament.draw.col_points')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const team = entries[row.id]
            const passes = done && i < qualifiers
            const mine = myEntryId && row.id === myEntryId
            return (
              <tr
                key={row.id}
                className={`border-t border-ink-50 ${passes ? 'bg-[#F7F6FE]' : ''}`}
              >
                <td className="py-1.5 text-center">
                  <span
                    className={`inline-flex h-5 min-w-[20px] px-0.5 items-center justify-center rounded-full font-mono text-xs font-bold ${
                      passes ? 'bg-kind-tournament-light text-kind-tournament-dark' : 'text-muted'
                    }`}
                  >
                    {row.id in firstOf ? `${firstOf[row.id] + 1}=` : i + 1}
                  </span>
                </td>
                <td className="py-1.5 pr-2">
                  <span className={`text-xs ${passes ? 'font-bold text-ink-900' : 'text-ink-900'}`}>
                    {team?.name || t('ui.empty_tbd')}
                  </span>
                  {team?.seed ? (
                    <span className="ml-1 font-mono text-xs text-muted">
                      {t('tournament.draw.seed_short', { n: team.seed })}
                    </span>
                  ) : null}
                  {mine ? <Me>{t('tournament.draw.you')}</Me> : null}
                </td>
                <td className="py-1.5 text-center font-mono text-xs text-muted">{row.played}</td>
                <td className="py-1.5 text-center font-mono text-xs text-muted">{row.wins}</td>
                <td className="py-1.5 text-center font-mono text-xs text-muted">
                  {row.diff > 0 ? `+${row.diff}` : row.diff}
                </td>
                <td className="py-1.5 text-center font-mono text-xs text-muted">{row.gamesWon}</td>
                <td className="py-1.5 pr-2 text-center font-mono text-sm font-extrabold text-ink-900">{groupPoints(row)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* As siglas ficam (as palavras não cabem no telemóvel), com a legenda
          por baixo da tabela (UX, 14 out). */}
      <p className="border-t border-ink-50 px-3 pt-1.5 text-[12px] leading-snug text-muted">{t('tournament.draw.legend')}</p>
      <p className="px-3 py-1.5 text-xs text-muted">
        {t(done ? 'tournament.draw.qualify_note' : 'tournament.draw.qualify_note_running', { count: qualifiers })}
      </p>
      {anyTie && <p className="px-3 pb-1.5 text-xs text-muted">{t('tournament.draw.tied_for_now')}</p>}
      {/* O que é «Pts», recolhido num «?» (Francisco, 28 set). */}
      <RuleHint className="px-3 pb-1.5" label={t('tournament.draw.points_hint')} note={t('tournament.draw.points_hint_note')} />
      {/* Como se desempata (#592, FPP; texto aprovado a 28 set,
          design-handoff/2026-09-28-avisos-desempate, ponto 2). */}
      <RuleHint className="px-3 pb-1.5" label={t('tournament.draw.tiebreak_hint')}
        items={[1, 2, 3, 4, 5].map((n) => t(`tournament.draw.tiebreak_hint_${n}`))} note={t('tournament.draw.tiebreak_hint_note')} />
    </section>
  )
}

export default function GroupsPanel({ tournament, category, my, emptyPose }) {
  const { t } = useTranslation()
  // A pontuação dos grupos, por cima de cada tabela (pontuação por fase, 26 out).
  const scoring = scoringName(t, phaseScorings(tournament?.rules).groups, true)
  const { groups, entries, matches, loading } = useCategoryBoard(category?.id)

  if (loading) {
    return <PanelSkeleton rows={2} />
  }

  if (!groups.length) {
    return (
      <EmptyState
        icon={Users}
        pose={emptyPose}
        title={t('tournament.draw.groups_empty_title')}
        subtitle={t('tournament.draw.groups_empty_subtitle')}
      />
    )
  }

  const qualifiers = qualifiersPerGroup(category)
  // Um grupo só, sem ninguém a passar: a tabela é o torneio todo.
  if (groups.length === 1 && qualifiers === 0) {
    return <SingleGroup group={groups[0]} matches={matches} entries={entries} myEntryId={my?.entry_id}
      category={category} scoring={scoring} t={t} />
  }

  return (
    <div>
      {/* Sem título próprio: «Todos os jogos» já põe «Grupos» por cima da
          secção (designer, 28 set — aparecia duas vezes seguidas). */}
      {groups.map((group) => (
        <GroupTable
          key={group.id}
          group={group}
          matches={matches}
          entries={entries}
          qualifiers={qualifiers}
          myEntryId={my?.entry_id}
          scoring={scoring}
          t={t}
        />
      ))}
    </div>
  )
}
