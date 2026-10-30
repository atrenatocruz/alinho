// O «?» da caixa «Pontuação» da página do torneio. Com as duas fases iguais
// é a folha «Como se joga o 40-40» de sempre; com uma pontuação em cada fase
// (26 out), explica as duas, uma a seguir à outra, com «Nos grupos» e «Nas
// eliminatórias» por cima, e o 40-40 no fim (UX, 29 out: o ponto 5 da SPEC,
// «as regras dizem as duas»).
import { useTranslation } from 'react-i18next'
import { DeuceHelpSheet } from '../DeuceMode'
import { Sheet } from '../agenda/AgendaControls'
import { phaseScorings, scoringName } from './scoringText'

/** A explicação de uma pontuação. O pro set diz o desempate do 8-8 que o
 *  torneio escolheu; nos sets, o 6-6 é sempre um tie-break até 7. */
function scoringHelp(t, scoring, rules) {
  if (scoring === 'pro_set_9') {
    return t(rules?.tiebreak_8_8 === 'super_tiebreak' ? 'tournament.scoring_help_pro_set_9_super' : 'tournament.scoring_help_pro_set_9')
  }
  if (scoring === 'melhor_2_sets') return t('tournament.create.scoring_melhor_2_sets_hint')
  return t('tournament.scoring_help_melhor_3_sets')
}

export default function ScoringHelpSheet({ rules, mode, onClose }) {
  const { t } = useTranslation()
  const scorings = phaseScorings(rules)
  if (scorings.same) return <DeuceHelpSheet mode={mode} onClose={onClose} />
  const block = (label, scoring) => (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-sm leading-relaxed text-ink-900">
        <b className="font-extrabold">{scoringName(t, scoring)}.</b> {scoringHelp(t, scoring, rules)}
      </p>
    </div>
  )
  return (
    <Sheet title={t('tournament.scoring_help_title')} onClose={onClose}>
      <div className="space-y-4">
        {block(t('tournament.create.scoring_in_groups'), scorings.groups)}
        {block(t('tournament.create.scoring_in_knockout'), scorings.knockout)}
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted">{t('deuce.label')}</p>
          <p className="mt-1 text-sm leading-relaxed text-ink-900">
            <b className="font-extrabold">{t(`deuce.${mode}`)}.</b> {t(`deuce.help_${mode}`)}
          </p>
          <p className="mt-3 text-sm text-muted">{t('deuce.help_tiebreak')}</p>
        </div>
      </div>
    </Sheet>
  )
}
