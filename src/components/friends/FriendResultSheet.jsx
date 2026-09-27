// «Resultado do jogo N» na sessão (amigos sem bloquear, UX 27 set): o
// marcador de sempre e, antes de gravar, «Guardar 6–4? Depois de contar para
// o ranking já não muda.» — Guardar a preto, Voltar em texto. Grava com
// record_friend_match_result (Dev 3).
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet } from '../agenda/AgendaControls'
import { ConfirmSheet } from '../ui'
import { ScoreEntrySimple, ScoreEntrySets } from './FriendScoreEntry'
import { recordFriendMatchResult } from '../../lib/privateMatches'
import { describeError } from '../../lib/errors'

const ERRORS = ['not_allowed', 'already_counted', 'bad_score']
export const teamNames = (team) => (team || []).map((p) => p.name).filter(Boolean).join(' / ')

export default function FriendResultSheet({ match, game, onClose, onSaved }) {
  const { t } = useTranslation()
  const [pending, setPending] = useState(null) // o resultado por confirmar
  const scoreText = pending ? `${pending.score_a}–${pending.score_b}` : ''

  return (
    <>
      {!pending && (
        <Sheet title={t('friends.result_title', { n: game.n })} onClose={onClose}>
          <div className="space-y-3">
            <p className="text-sm text-ink-900">
              {teamNames(game.team_a)} <span className="text-muted">×</span> {teamNames(game.team_b)}
            </p>
            {match.scoring_format === 'sets' ? (
              <ScoreEntrySets numSets={match.num_sets || 3} onSave={setPending} saving={false} />
            ) : (
              <ScoreEntrySimple onSave={setPending} saving={false} />
            )}
          </div>
        </Sheet>
      )}
      <ConfirmSheet
        open={!!pending}
        title={t('friends.result_confirm_title', { score: scoreText })}
        message={t('friends.result_confirm_message')}
        confirmLabel={t('friends.result_save')}
        cancelLabel={t('friends.result_back')}
        onConfirm={async () => { await recordFriendMatchResult(game.id, pending); onSaved() }}
        onClose={() => setPending(null)}
        errorOf={(err) => {
          const code = ERRORS.find((k) => String(err?.message || '').includes(k))
          return code ? t(`friends.result_error_${code}`) : describeError(t, err)
        }}
      />
    </>
  )
}
