// A pontuação de cada fase em texto (Francisco, 26 out; design-handoff/
// 2026-10-26-torneio-pontuacao-grupos-e-eliminatorias). Os nomes são os do
// Criar («Pro set a 9»), com minúscula quando vêm a meio de uma linha
// («Grupo 1 · pro set a 9», «Grupos: pro set a 9»).
import { scoringForStage } from '../../lib/tournamentScore'

export function scoringName(t, scoring, lower = false) {
  const name = t(`tournament.create.scoring_${scoring || 'pro_set_9'}`)
  return lower ? name.charAt(0).toLocaleLowerCase() + name.slice(1) : name
}

/** As duas pontuações do torneio, pela mesma regra da base de dados: sem
 *  `scoring_knockout`, as eliminatórias jogam-se como os grupos. */
export function phaseScorings(rules) {
  const groups = scoringForStage(rules, 'grupo')
  const knockout = scoringForStage(rules, 'eliminatoria')
  return { groups, knockout, same: groups === knockout }
}
