// «Editar jogo em aberto» (auditoria «Editar tem tudo», #586, ponto 5): os
// mesmos passos do criar, com a publicação como está — os jogos do mesmo
// open_batch_id. Abre a partir da linha do jogo no Gerir.
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { loadOpenSlotBatch } from '../lib/openSlotsApi'
import { describeError } from '../lib/errors'
import { EmptyState } from '../components/ui'
import CreateOpenSlots from './CreateOpenSlots'

export default function EditOpenSlots() {
  const { batchId } = useParams()
  const { t } = useTranslation()
  const [games, setGames] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    loadOpenSlotBatch(batchId)
      .then(setGames)
      .catch((err) => { console.error('Error loading open slots to edit:', err); setError(describeError(t, err)) })
  }, [batchId, t])

  if (error) return <EmptyState title={error} />
  if (!games) {
    return <div className="flex justify-center py-10"><div className="h-8 w-8 animate-spin rounded-full border-[3px] border-ink-50 border-t-ink-700" /></div>
  }
  if (!games.some((g) => !['cancelled', 'finished', 'completed'].includes(g.status))) {
    return <EmptyState title={t('open_slots.edit_nothing')} />
  }
  return <CreateOpenSlots edit={{ batchId, games }} />
}
