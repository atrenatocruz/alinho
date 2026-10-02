// «Cancelar o torneio» (ações do evento, assunto 1; Francisco, 1 out: «eu
// quero poder cancelar sempre, mesmo com inscritos ou não»). A mesma
// pergunta no «Mais ⋯» da barra de quem organiza e em baixo no Editar por
// passos (edit.danger do StepPage, Dev 4) — uma só, para não haver duas.
//
// As frases mudam com o momento (SPEC 2026-09-26-acoes-do-evento, fim):
//   · sem inscritos: «Eliminar o torneio» e desaparece mesmo (delete_tournament),
//     em rascunho ou publicado — a regra do Editar de 30 set e a do mix (UX,
//     1 out);
//   · com inscritos, antes de começar: as duplas recebem um aviso;
//   · a decorrer: pára ali, os jogos já jogados não contam para o ranking.
// Base de dados: cancel_tournament (Dev 3, migration_cancelar_torneio.sql).
import { cancelTournament, deleteTournament } from '../../lib/tournamentApi'
import { describeError } from '../../lib/errors'

const LIVE = ['sorteado', 'a_decorrer']
const ERRORS = ['category_finished', 'already_finished', 'not_allowed', 'has_entries']

/** Pode cancelar-se? Tudo menos terminado ou já cancelado. */
export const canCancel = (tournament) => !!tournament && !['terminado', 'cancelado'].includes(tournament.status)

/** As frases da pergunta, pelo momento do torneio. `everEntered`: já houve
 *  alguma inscrição, mesmo desistida — a mesma conta da base de dados
 *  (has_entries do get_tournament_for_edit). Com ela, nunca se mostra
 *  «Eliminar» a quem depois ouviria que não pode (UX, 1 out). */
export function cancelCopy(tournament, t, everEntered = null) {
  const count = Number(tournament?.entry_count) || 0
  const name = tournament?.name || ''
  const none = count === 0 && everEntered !== true
  const key = none ? 'empty' : LIVE.includes(tournament?.status) ? 'live' : count === 0 ? 'withdrawn' : 'entries'
  return {
    key,
    title: t(key === 'empty' ? 'tournament.cancel.title_delete' : 'tournament.cancel.title', { name }),
    message: t(`tournament.cancel.message_${key}`, { count }),
  }
}

/** O objeto da pergunta, na forma do edit.danger do StepPage (e da folha
 *  da barra): { label, title, message, confirmLabel, cancelLabel,
 *  onConfirm, errorOf }. `onDone(deleted)` corre depois de cancelar. */
export function cancelDanger(tournament, t, onDone, { everEntered = null } = {}) {
  const copy = cancelCopy(tournament, t, everEntered)
  // Sem inscritos: eliminar, e não cancelar.
  const deletes = copy.key === 'empty'
  return {
    label: t(deletes ? 'tournament.cancel.action_delete' : 'tournament.cancel.action'),
    hint: t(deletes ? 'tournament.cancel.hint_delete' : 'tournament.cancel.hint'),
    title: copy.title,
    message: copy.message,
    confirmLabel: t(deletes ? 'tournament.cancel.yes_delete' : 'tournament.cancel.yes'),
    cancelLabel: t('tournament.cancel.keep'),
    onConfirm: async () => {
      if (deletes) await deleteTournament(tournament.id)
      else await cancelTournament(tournament.id)
      onDone?.(deletes)
    },
    errorOf: (err) => {
      const code = ERRORS.find((k) => String(err?.message || '').includes(k))
      return code ? t(`tournament.cancel.error_${code}`) : describeError(t, err)
    },
  }
}
