// O fim do torneio (Trello #361 · print 12): 1.º e 2.º de cada categoria —
// e o 3.º, quando houve jogo de 3.º e 4.º lugar — os prémios, e o que a
// pessoa que está a ver levou de lá: XP, jogos e pontos de ranking.
//
// Aparece no topo da página do torneio, e só quando o torneio acabou. Antes
// disso não fica espaço reservado nenhum — como os avisos do organizador.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Trophy } from 'lucide-react'
import { getTournamentResults } from '../../lib/tournamentApi'
import { errorKind } from '../../lib/errors'
import { MonoLabel, Me } from './TournamentBits'

const MEDALS = ['🥇', '🥈', '🥉']

/** Uma linha do pódio.
 *
 *  Dois níveis, de propósito: **a dupla** ganhou (o nome grande) e **as
 *  pessoas** jogaram. Quando houve substituição a meio, a dupla campeã tem
 *  três pessoas e o nome da dupla só cabe duas — por isso, nesse caso, as
 *  pessoas aparecem por baixo, com quem jogou a final marcado (decisão do
 *  Francisco, 23 set: ficam todas campeãs, e o ecrã mostra quem lá esteve).
 *  Sem substituição não aparece nada disto: o nome da dupla já as diz.
 *
 *  O nome de quem está a ver aparece destacado, como em todo o lado
 *  (SPEC §2: nunca "Tu"). */
function PodiumRow({ place, team, prize, people, meName }) {
  const { t } = useTranslation()
  if (!team) return null
  const parts = String(team.name || '').split(/\s*\/\s*/)
  const mark = (name) => (meName && name === meName ? <Me>{name}</Me> : name)
  // Só quando são mais do que as duas que cabem no nome da dupla.
  const swapped = people.length > 2 ? people : []
  return (
    <div className="mt-1.5 grid grid-cols-[24px_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5 rounded-ctrl border border-line px-2.5 py-2">
      <span className="row-span-2 text-lg leading-none">{MEDALS[place]}</span>
      <b className="text-sm text-ink-900">
        {parts.map((part, i) => (
          <span key={i}>
            {i > 0 && ' / '}
            {mark(part.trim())}
          </span>
        ))}
      </b>
      {prize && <em className="not-italic text-xs text-ink-500">{prize}</em>}

      {swapped.length > 0 && (
        <ul className="col-start-2 mt-1 space-y-0.5 border-t border-line pt-1.5">
          {swapped.map((p) => (
            <li key={p.name} className="flex items-baseline justify-between gap-2 text-xs text-ink-700">
              <span className="min-w-0 truncate">{mark(p.name)}</span>
              <span className="shrink-0 text-xs text-ink-500">
                {p.played_final ? t('tournament.podium.played_final') : t('tournament.podium.matches', { count: p.matches_played })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function PodiumPanel({ tournament }) {
  const { t } = useTranslation()
  const [data, setData] = useState(null)
  const finished = tournament?.status === 'terminado'

  useEffect(() => {
    if (!finished) return undefined
    let alive = true
    getTournamentResults(tournament.slug || tournament.id)
      .then((res) => { if (alive) setData(res) })
      .catch((err) => {
        if (errorKind(err) !== 'not_ready') console.error('Error loading results:', err)
        if (alive) setData(null)
      })
    return () => { alive = false }
  }, [finished, tournament?.slug, tournament?.id])

  // Sem torneio acabado, ou sem resultados, não fica espaço reservado.
  if (!finished || !data?.categories?.length) return null

  const mine = data.my
  // O nome de quem está a ver vem com os resultados, não das props da
  // página: ali o `my` é a inscrição dela, não o nome.
  const meName = mine?.player_name || null

  return (
    <div className="card">
      <MonoLabel>{t('tournament.podium.title')}</MonoLabel>

      {data.categories.map((c) => {
        // Uma pessoa pode estar no pódio sem estar no nome da dupla (entrou a
        // meio). O `podium_players` é por PESSOA; agrupa-se por posição.
        const at = (position) => (c.podium_players || []).filter((p) => p.final_position === position)
        return (
          <div key={c.id || c.code} className="mt-3 first:mt-2">
            <MonoLabel>{c.code}{c.name ? ` · ${c.name}` : ''}</MonoLabel>
            <PodiumRow place={0} team={c.champion} prize={c.prize_first} people={at(1)} meName={meName} />
            <PodiumRow place={1} team={c.runner_up} prize={c.prize_second} people={at(2)} meName={meName} />
            <PodiumRow place={2} team={c.third} prize={null} people={at(3)} meName={meName} />
          </div>
        )
      })}

      {mine && (
        <div className="mt-4 flex items-start gap-2 rounded-ctrl border border-[#E3EE8F] bg-[#F8FCD4] p-2.5 text-xs text-ink-900">
          <Trophy size={16} className="mt-0.5 shrink-0" />
          <span>
            {/* Sem XP: não existe conta de XP nos torneios (procurado em
                todas as migrações, 23 set). Não se mostra um número que não
                tem de onde vir — a decisão de o criar ou não é do Francisco. */}
            <b>{t('tournament.podium.my_matches', { count: mine.matches })}</b>
            {Number.isFinite(mine.matches_won) && (
              <>{' · '}{t('tournament.podium.my_won', { count: mine.matches_won })}</>
            )}
            {Number.isFinite(mine.rating_delta) && mine.rating_delta !== 0 && (
              <>
                {' · '}
                {t('tournament.podium.my_rating', {
                  category: mine.category_code || '',
                  points: `${mine.rating_delta > 0 ? '+' : ''}${mine.rating_delta}`,
                })}
              </>
            )}
          </span>
        </div>
      )}
    </div>
  )
}
