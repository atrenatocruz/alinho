// Escolher quem marca os resultados (Trello #365) — print 11, 1.º
// telemóvel. Por torneio, com as categorias que cada um pode marcar.
// A mesma conta pode estar aberta noutro telemóvel ou num computador da
// receção ao mesmo tempo — é isso que o aviso do fim diz.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Users } from 'lucide-react'
import { addScorekeeper, listScorekeepers, removeScorekeeper } from '../../lib/tournamentApi'
import { describeError, errorKind } from '../../lib/errors'
import { Avatar } from '../ui'
import PlayerSearch from '../PlayerSearch'
import { MonoLabel } from './TournamentBits'

export default function ScorekeepersPanel({ tournament, onBack }) {
  const { t } = useTranslation()
  const [list, setList] = useState(null)
  const [error, setError] = useState('')

  const load = () => {
    listScorekeepers(tournament.id)
      .then(setList)
      .catch((err) => {
        if (errorKind(err) !== 'not_ready') console.error('Error loading scorekeepers:', err)
        setList([])
      })
  }
  useEffect(load, [tournament.id])

  const add = async (person) => {
    setError('')
    try {
      await addScorekeeper(tournament.id, person.id, [])
      load()
    } catch (err) { setError(describeError(t, err)) }
  }

  const remove = async (userId) => {
    setError('')
    try {
      await removeScorekeeper(tournament.id, userId)
      load()
    } catch (err) { setError(describeError(t, err)) }
  }

  return (
    <div>
      <button type="button" onClick={onBack} className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-extrabold text-ink-700 hover:underline">
        <ArrowLeft size={16} /> {t('common.back')}
      </button>
      <h2 className="mt-3 font-display text-lg font-extrabold text-ink-900">{t('tournament.score.keepers_title')}</h2>
      <p className="mt-0.5 text-[11.5px] text-ink-500">{t('tournament.score.keepers_subtitle')}</p>

      {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}

      <div className="mt-3">
        {(list || []).map((k) => (
          <div key={k.user_id} className="flex items-center gap-2.5 border-t border-line py-2">
            <Avatar name={k.name} url={k.avatar_url} size="w-8 h-8 text-[10px]" />
            <span className="min-w-0 flex-1">
              <b className="block truncate text-[13px] font-semibold text-ink-900">{k.name}</b>
              <span className="text-[11px] text-ink-500">
                {k.category_codes?.length ? t('tournament.score.keeper_some', { list: k.category_codes.join(', ') }) : t('tournament.score.keeper_all')}
              </span>
            </span>
            <button type="button" onClick={() => remove(k.user_id)} className="text-[11.5px] text-ink-500 hover:underline">
              {t('tournament.score.keeper_remove')}
            </button>
          </div>
        ))}
        {list && list.length === 0 && <p className="border-t border-line py-3 text-[12px] text-ink-500">{t('tournament.score.keepers_empty')}</p>}
      </div>

      <div className="mt-4">
        <MonoLabel className="mb-1.5">{t('tournament.score.keeper_add')}</MonoLabel>
        <PlayerSearch onSelect={add} excludeIds={(list || []).map((k) => k.user_id)} />
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-ctrl border border-line bg-surface p-2.5 text-[12px] text-ink-700">
        <Users size={16} className="mt-0.5 shrink-0 text-ink-500" />
        <span>{t('tournament.score.keepers_note')}</span>
      </div>
    </div>
  )
}
