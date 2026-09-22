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
import { MonoLabel, Me } from './TournamentBits'
import useCategoryBoard from './useCategoryBoard'
import { standingsOf, qualifiersPerGroup } from '../../lib/tournamentDraw'

/** Uma tabela de grupo. As duplas que passam ficam marcadas à esquerda e
 *  com o lugar em destaque — é o que se lê de relance no telemóvel. */
function GroupTable({ group, matches, entries, qualifiers, myEntryId, t }) {
  const rows = standingsOf(group, matches)
  const played = matches.filter(
    (m) => m.stage === 'grupo' && m.group_id === group.id && m.score_a != null,
  ).length
  const total = matches.filter((m) => m.stage === 'grupo' && m.group_id === group.id).length

  return (
    <section className="mb-3 overflow-hidden rounded-xl border border-ink-100 bg-white">
      <header className="flex items-center justify-between border-b border-ink-100 px-3 py-2">
        <b className="text-[13px] font-extrabold text-ink-900">{group.name}</b>
        <span className="font-mono text-[10.5px] text-muted">
          {t('tournament.draw.played_of', { played, total })}
        </span>
      </header>

      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-muted">
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
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const team = entries[row.id]
            const passes = i < qualifiers
            const mine = myEntryId && row.id === myEntryId
            return (
              <tr
                key={row.id}
                className={`border-t border-ink-50 ${passes ? 'bg-[#F7F6FE]' : ''}`}
              >
                <td className="py-1.5 text-center">
                  <span
                    className={`inline-flex h-5 w-5 items-center justify-center rounded-full font-mono text-[10.5px] font-bold ${
                      passes ? 'bg-[#E9E7FB] text-[#4338A8]' : 'text-muted'
                    }`}
                  >
                    {i + 1}
                  </span>
                </td>
                <td className="py-1.5 pr-2">
                  <span className={`text-[12px] ${passes ? 'font-bold text-ink-900' : 'text-ink-900'}`}>
                    {team?.name || '—'}
                  </span>
                  {team?.seed ? (
                    <span className="ml-1 font-mono text-[9.5px] text-muted">
                      {t('tournament.draw.seed_short', { n: team.seed })}
                    </span>
                  ) : null}
                  {mine ? <Me>{t('tournament.draw.you')}</Me> : null}
                </td>
                <td className="py-1.5 text-center font-mono text-[11px] text-muted">{row.played}</td>
                <td className="py-1.5 text-center font-mono text-[11px] font-bold text-ink-900">{row.wins}</td>
                <td className="py-1.5 text-center font-mono text-[11px] text-muted">
                  {row.diff > 0 ? `+${row.diff}` : row.diff}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <p className="border-t border-ink-50 px-3 py-1.5 text-[10.5px] text-muted">
        {t('tournament.draw.qualify_note', { count: qualifiers })}
      </p>
    </section>
  )
}

export default function GroupsPanel({ category, my }) {
  const { t } = useTranslation()
  const { groups, entries, matches, loading } = useCategoryBoard(category?.id)

  if (loading) {
    return <p className="py-6 text-center text-[12px] text-muted">{t('common.loading')}</p>
  }

  if (!groups.length) {
    return (
      <EmptyState
        icon={Users}
        title={t('tournament.draw.groups_empty_title')}
        subtitle={t('tournament.draw.groups_empty_subtitle')}
      />
    )
  }

  const qualifiers = qualifiersPerGroup(category)

  return (
    <div>
      <MonoLabel className="mb-1">{t('tournament.draw.groups_label')}</MonoLabel>
      {groups.map((group) => (
        <GroupTable
          key={group.id}
          group={group}
          matches={matches}
          entries={entries}
          qualifiers={qualifiers}
          myEntryId={my?.entry_id}
          t={t}
        />
      ))}
      <p className="px-1 pb-2 text-[10.5px] text-muted">{t('tournament.draw.tiebreak_note')}</p>
    </div>
  )
}
