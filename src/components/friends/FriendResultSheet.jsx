// «Resultado do jogo N» na sessão (amigos sem bloquear, UX 27 set): o
// marcador de sempre e, antes de gravar, «Guardar 6–4? Depois de contar para
// o ranking já não muda.» — Guardar a preto, Voltar em texto. Grava com
// record_friend_match_result (Dev 3).
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet } from '../agenda/AgendaControls'
import { ConfirmSheet } from '../ui'
import { ScoreEntrySimple } from './FriendScoreEntry'
import FriendSetsEntry from './FriendSetsEntry'
import { formatKey, maxSetsFor } from './friendScoring'
import { recordFriendMatchResult } from '../../lib/privateMatches'
import { describeError } from '../../lib/errors'

const ERRORS = ['not_allowed', 'already_counted', 'bad_score']
const FORMAT_LABEL = { best3: 'friends.format_best3', free: 'friends.format_free', points: 'createprivatematch.format_points' }
export const teamNames = (team) => (team || []).map((p) => p.name).filter(Boolean).join(' / ')

export default function FriendResultSheet({ match, game, onClose, onSaved }) {
  const { t } = useTranslation()
  const [pending, setPending] = useState(null) // o resultado por confirmar
  // «Guardar 6–4, 3–6, 6–2?» com sets; «Guardar 9–6?» com pontos.
  const scoreText = !pending ? '' : pending.sets?.length
    ? pending.sets.map((x) => `${x.score_a}–${x.score_b}`).join(', ')
    : `${pending.score_a}–${pending.score_b}`
  const key = formatKey(match.scoring_format, match.num_sets)

  return (
    <>
      {!pending && (
        <Sheet title={t('friends.result_title', { n: game.n })} onClose={onClose}>
          <div className="space-y-3">
            <p className="-mt-2 text-xs text-muted">{t(FORMAT_LABEL[key])}</p>
            {key === 'points' ? (
              <>
                <p className="text-sm text-ink-900">
                  {teamNames(game.team_a)} <span className="text-muted">×</span> {teamNames(game.team_b)}
                </p>
                <ScoreEntrySimple onSave={setPending} saving={false} />
              </>
            ) : (
              <FriendSetsEntry mode={key} maxSets={maxSetsFor(match.scoring_format, match.num_sets)}
                teamA={game.team_a} teamB={game.team_b} onSave={setPending} />
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
