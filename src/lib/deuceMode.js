// «Aos 40-40» (design-handoff/2026-10-22-aos-40-40-criar, aprovado pelo
// Francisco a 22 out; regras do BA em 2026-10-22-relogio/MODOS-40-40-BA.md).
// Três modos; por omissão, o ponto de ouro (o das provas da FPP). Na base:
// games.deuce_mode / game_recurrences.deuce_mode (Dev 3) e, nos jogos entre
// amigos, set_deuce_mode('friend_match', id, modo). Não muda nenhuma conta.

export const DEUCE_MODES = ['ponto_de_ouro', 'star_point', 'vantagens']
export const DEFAULT_DEUCE_MODE = 'ponto_de_ouro'

/** O modo de um evento (sem escolha, ou um valor que não se conhece: ponto de ouro). */
export const deuceModeOf = (row) => (DEUCE_MODES.includes(row?.deuce_mode) ? row.deuce_mode : DEFAULT_DEUCE_MODE)

/** Só os «Pontos corridos» não têm 15-30-40: aí a escolha não aparece. O
 *  «Set sem fim» conta 15-30-40 e tem (SPEC 2026-10-26). Recebe a pontuação
 *  como se lê (scoringFormatOf), para os Americanos antigos. */
export const scoringHasDeuce = (scoringFormat) => !!scoringFormat && scoringFormat !== 'pontos_corridos'
