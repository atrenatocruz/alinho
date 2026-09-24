/* ─── Rankings por escala: Masculino · Feminino · Todos ──────────────────────
   Francisco, 17 set 2026: como nos Masters e na federação, homens e mulheres
   não se classificam na mesma lista. Os pontos de cada jogador ficam
   exatamente como estão — só a lista e as posições passam a ser por escala.
   Pontos calculados à parte por escala (e uma escala Mista para os mixes
   mistos) é outra decisão, a acordar com o Ruben e o Renato.

   Francisco, 24 set 2026 (Trello #422), a acertar o que estava combinado:
   «só íamos ter ranking para homens e mulheres, e no global apareciam os sem
   género e os jogadores que ainda não jogaram um jogo.»

   Porquê: o topo estava ocupado por quem nunca jogou — 14 dos 15 primeiros em
   produção, ordenados pelo nível que cada um DECLAROU ao registar-se (1900
   para quem escolheu o nível mais alto). Um lugar no ranking tem de ser
   ganho em campo.

   - Só há lugares em Masculino e Feminino, e só para quem já jogou (tem pelo
     menos um jogo que contou para o nível). As listas Masculino e Feminino
     mostram só essas pessoas.
   - "Todos" (o global): toda a gente, por ordem alfabética — também quem não
     tem género, quem ainda não jogou e quem ainda não escolheu o nível. Cada
     um com a posição na SUA escala, quando a tem; nunca uma 11.ª mulher por
     baixo de um 100.º homem.
   - Quem ainda não tem lugar diz porquê (`reason`), para o ecrã explicar o
     que falta em vez de mostrar um traço. */

export const SCALES = ['masculino', 'feminino', 'all']

// A escala de um género. 'none' continua a existir como classificação —
// quem não tem género não tem lista própria, aparece só em "Todos".
export const scaleOf = (gender) => (gender === 'masculino' || gender === 'feminino' ? gender : 'none')

// Escala com que a página abre: a do próprio jogador; sem género, "Todos".
export const defaultScale = (gender) => {
  const s = scaleOf(gender)
  return s === 'none' ? 'all' : s
}

const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'pt')

// Já jogou? `played` quando quem monta a linha o sabe (as linhas por mês só
// existem para quem jogou nesse mês); senão, pelos jogos que contaram para o
// nível (`rating_games`, que conta mixes e jogos entre amigos).
//
// Se a lista vier sem `rating_games`, pelos mixes jogados. Não é teoria: a
// `get_global_rankings` do alinho-dev, a 24 set, ainda é uma versão antiga
// sem essa coluna — e sem este recurso a regra achava que ninguém tinha
// jogado e esvaziava o ranking inteiro, sem erro nenhum.
export const hasPlayed = (r) => {
  if (r.played != null) return r.played
  const games = r.rating_games ?? r.mixes_played
  return (Number(games) || 0) > 0
}

// Porque é que uma linha não tem lugar — pela ordem em que se resolve.
// null = tem lugar.
export const reasonWithoutPlace = (r) => {
  if (!r.ranked) return 'no_level'
  if (!hasPlayed(r)) return 'no_games'
  if (scaleOf(r.gender) === 'none') return 'no_gender'
  return null
}

// rows: já na ordem do ranking (melhor primeiro). `ranked` = tem nível.
// Devolve as linhas a mostrar com `position` (na escala da linha, ou null),
// `scale` e `reason` (porque não tem lugar).
export function applyScale(rows, scale) {
  const counters = { masculino: 0, feminino: 0 }
  const withPositions = rows.map((r) => {
    const s = scaleOf(r.gender)
    const reason = reasonWithoutPlace(r)
    const position = reason ? null : ++counters[s]
    return { ...r, scale: s, position, reason }
  })

  if (scale === 'all') return [...withPositions].sort(byName)

  return withPositions.filter((r) => r.scale === scale && r.position != null)
}

// Quantos têm lugar numa escala (para "5 de 40").
export const rankedCount = (rows, scale) =>
  rows.filter((r) => scaleOf(r.gender) === scale && !reasonWithoutPlace(r)).length

// O lugar de uma pessoa na sua escala, pelas mesmas regras da página do
// ranking — para o perfil e a página do jogador mostrarem o mesmo número.
// null = ainda não tem lugar.
export const positionOf = (rows, userId) =>
  applyScale(rows, 'all').find((r) => r.user_id === userId)?.position ?? null
