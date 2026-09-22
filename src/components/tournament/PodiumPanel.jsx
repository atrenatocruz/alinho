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

/** Uma linha do pódio. O nome de quem está a ver aparece destacado, como em
 *  todo o lado (SPEC §2: nunca "Tu"). */
function PodiumRow({ place, team, prize, meName }) {
  if (!team) return null
  const parts = String(team.name || '').split(/\s*\/\s*/)
  return (
    <div className="mt-1.5 grid grid-cols-[24px_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5 rounded-ctrl border border-line px-2.5 py-2">
      <span className="row-span-2 text-[18px] leading-none">{MEDALS[place]}</span>
      <b className="text-[13px] text-ink-900">
        {parts.map((part, i) => (
          <span key={i}>
            {i > 0 && ' / '}
            {meName && part.trim() === meName ? <Me>{part.trim()}</Me> : part}
          </span>
        ))}
      </b>
      {prize && <em className="not-italic text-[10.5px] text-ink-500">{prize}</em>}
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
    <div className="rounded-card border border-line p-3.5">
      <MonoLabel>{t('tournament.podium.title')}</MonoLabel>

      {data.categories.map((c) => (
        <div key={c.id || c.code} className="mt-3 first:mt-2">
          <MonoLabel>{c.code}{c.name ? ` · ${c.name}` : ''}</MonoLabel>
          <PodiumRow place={0} team={c.champion} prize={c.prize_first} meName={meName} />
          <PodiumRow place={1} team={c.runner_up} prize={c.prize_second} meName={meName} />
          <PodiumRow place={2} team={c.third} prize={null} meName={meName} />
        </div>
      ))}

      {mine && (
        <div className="mt-4 flex items-start gap-2 rounded-ctrl border border-[#E3EE8F] bg-[#F8FCD4] p-2.5 text-[12px] text-ink-900">
          <Trophy size={16} className="mt-0.5 shrink-0" />
          <span>
            <b>{t('tournament.podium.my_xp', { xp: mine.xp })}</b>
            {' · '}
            {t('tournament.podium.my_matches', { count: mine.matches })}
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
