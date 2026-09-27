// O texto de onde vem uma dupla, com um nome só em todo o lado (designer,
// 27 set): «Vencedor O1» (oitavos), «Vencedor Q1» (quartos), «Vencedor
// meia 1» (meias-finais) e, para o 3.º lugar, «Perdedor meia 1». O sorteio
// passa a guardar estes (Dev 3); os torneios já sorteados guardaram os
// antigos («Vencedor das meias 1», «Perdedor da 1.ª meia-final», …), que
// aqui se mostram com o nome novo até a migração os reescrever.
const RULES = [
  [/^Vencedor (?:das meias|meia) (\d+)$/, 'tournament.tree.winner_SF'],
  [/^Vencedor da (\d+)\.ª meia(?:-final)?$/, 'tournament.tree.winner_SF'],
  [/^Vencedor (?:dos quartos |Q)(\d+)$/, 'tournament.tree.winner_QF'],
  [/^Vencedor (?:dos oitavos |O)(\d+)$/, 'tournament.tree.winner_R16'],
  [/^Perdedor (?:da (\d+)\.ª meia-final|meia (\d+))$/, 'tournament.tree.loser_SF'],
]

// `matches` fica na assinatura por quem já a chama; já não é preciso.
export function sourceText(text, _matches, t) {
  if (!text) return text
  for (const [re, key] of RULES) {
    const m = String(text).match(re)
    if (m) return t(key, { n: m[1] || m[2] })
  }
  return text
}
