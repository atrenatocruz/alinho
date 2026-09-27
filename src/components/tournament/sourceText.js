// O texto de onde vem uma dupla («Vencedor das meias 2»), acertado para o
// que o quadro tem mesmo. Com uma meia-final só (3 duplas, uma passa direto
// à final), «Vencedor das meias 2» aponta para uma meia que não existe:
// diz-se «Vencedor da meia-final» (QA, 26 set). O texto vem guardado do
// sorteio; aqui só se corrige ao mostrar, por isso vale também para os
// torneios já sorteados.
const SEMI = /^Vencedor das meias \d+$/

export function sourceText(text, matches, t) {
  if (!text || !SEMI.test(text)) return text
  const semis = (matches || []).filter((m) => m.round === 'SF').length
  return semis === 1 ? t('tournament.tree.winner_only_SF') : text
}
