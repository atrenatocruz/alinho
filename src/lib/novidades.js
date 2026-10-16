// As entradas da página «Novidades» (alinho.pt/novidades — design-handoff/
// 2026-10-10-site-como-funciona, aprovado pelo Francisco a 10 out).
//
// Um sítio só: para uma versão nova, junta-se uma entrada NO TOPO desta lista,
// sem mexer no desenho. A mais recente leva «Nova». O texto vem do Marketing
// (3 a 5 linhas, linguagem de jogador, sem nomes nem números de pessoas) e o
// Francisco aprova antes de entrar.
//
// date: 'AAAA-MM-DD' · title e items em pt e en.

export const NOVIDADES = [
  {
    date: '2026-10-16',
    title: {
      pt: 'Liga entre clubes, ranking do mês e um visual novo',
      en: 'League between clubs, monthly ranking and a fresh look',
    },
    items: {
      pt: [
        'Ranking do mês: conta os pontos que ganhas no mês e recomeça a dia 1. Quem acaba no pódio usa uma moldura à volta da foto durante o mês seguinte.',
        'Liga entre clubes: o teu clube forma uma equipa com capitães e joga encontros contra outros clubes. Combinam a data na app e o resultado confirma-se lá.',
        'A tua evolução: no Perfil, um gráfico mostra como o teu ranking mudou ao longo do tempo. A página do XP explica os teus níveis de atividade.',
        'Medalhas novas e mais 27 conquistas, da «Desforra» ao «Padel de Natal». Vê no teu perfil: algumas já podem ser tuas.',
        'Jogos entre amigos do princípio ao fim: marcas o jogo, jogam por rondas e, no fim, confirmam o resultado, que conta para o ranking.',
        'Mixes mais variados: a app deixa de juntar duplas que já jogaram juntas nos teus últimos 4 mixes, e o Sobe e desce pode trocar as duplas a cada ronda.',
        'Uma Home nova, com os teus próximos jogos logo no topo, e o cartão dos vencedores com foto em todos os jogos, pronto a partilhar.',
        'Um visual novo: cada tipo de jogo tem a sua cor, os clubes e a Comunidade estão mais fáceis de ler, e o Alino, a nossa mascote, aparece quando ainda não há nada para mostrar.',
        'E ainda: pessoas que talvez conheças; jogo em aberto passo a passo; cada pessoa pode criar um grupo grátis; desfazer as duplas de um mix e partilhá-las logo a seguir ao sorteio; numa série, mudar só este mix ou também os seguintes; nos torneios, t-shirts, preço especial, mudar a hora de uma categoria e um aviso quando duas categorias chocam; a hora sempre em 24 h; e a app já não fica presa depois de uma atualização.',
      ],
      en: [
        'Monthly ranking: it counts the points you win in the month and starts again on the 1st. Whoever finishes on the podium wears a frame around their photo for the following month.',
        'League between clubs: your club forms a team with captains and plays matches against other clubs. You agree the date in the app and confirm the result there.',
        'Your progress: in your Profile, a chart shows how your ranking has changed over time. The XP page explains your activity levels.',
        'New medals and 27 more achievements, from «Payback» to «Christmas Padel». Check your profile: some may already be yours.',
        'Games with friends from start to finish: you set up the game, play in rounds and, at the end, confirm the result, which counts for the ranking.',
        'More varied mixes: the app no longer pairs people who played together in your last 4 mixes, and Up and Down can switch pairs every round.',
        'A new Home, with your next games right at the top, and the winners card with a photo for every game, ready to share.',
        "A fresh look: each type of game has its own colour, clubs and the Community are easier to read, and Alino, our mascot, shows up when there's nothing to show yet.",
        "Also: people you may know; open game step by step; everyone can create one free group; undo a mix's pairs and share them right after the draw; in a series, change just this mix or the following ones too; in tournaments, t-shirts, special price, changing a category's time and a warning when two categories clash; time always in 24 h; and the app no longer gets stuck after an update.",
      ],
    },
  },
  {
    date: '2026-10-09',
    title: {
      pt: 'Desistências sem confusão, e mixes que não se perdem',
      en: 'No-fuss dropouts, and mixes that never get lost',
    },
    items: {
      pt: [
        'Se alguém sai depois de as duplas estarem feitas, o primeiro suplente entra no lugar dessa pessoa. As outras duplas ficam iguais.',
        'Se os resultados estiverem todos marcados e o mix ficar por terminar, a app termina-o no dia seguinte e os jogos contam para o ranking.',
        'Quem organiza pode escolher aceitar quem entra pela app. Nesses mixes carregas em «Pedir para entrar» e recebes um aviso quando te aceitarem.',
        'Nos torneios, as inscrições fecham sozinhas no fim do prazo.',
        'Empates resolvidos como na Federação Portuguesa de Padel.',
      ],
      en: [
        'If someone drops out after the pairs are made, the first substitute takes their place. The other pairs stay the same.',
        'If every result is in and the mix is left open, the app finishes it the next day and the games count for the ranking.',
        'Organisers can choose to approve who joins through the app. In those mixes you tap «Ask to join» and get a notice when you are accepted.',
        'In tournaments, sign-ups close on their own at the deadline.',
        'Ties are broken as in the Portuguese Padel Federation.',
      ],
    },
  },
]

/** «9 DE OUTUBRO DE 2026» (pt) · «9 OCTOBER 2026» (en). */
export function novidadeDate(date, lang) {
  const d = new Date(`${date}T12:00:00`)
  const txt = lang === 'en'
    ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : d.toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', year: 'numeric' })
  return txt.toUpperCase()
}
