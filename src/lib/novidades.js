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
      pt: 'Ranking do mês, medalhas novas e jogos entre amigos',
      en: 'Monthly ranking, new medals and games with friends',
    },
    items: {
      pt: [
        'Ranking do mês: conta os pontos que ganhas no mês e recomeça a dia 1. Quem acaba no pódio usa uma moldura à volta da foto durante o mês seguinte.',
        'Medalhas novas e mais 27 conquistas, da «Desforra» ao «Padel de Natal». Vê no teu perfil: algumas já podem ser tuas.',
        'Jogos entre amigos do princípio ao fim: marcas o jogo, jogam por rondas e, no fim, confirmam o resultado, que conta para o ranking.',
        'Mixes mais variados: a app deixa de juntar duplas que já jogaram juntas nos teus últimos 4 mixes, e o Sobe e desce pode trocar as duplas a cada ronda.',
        'Uma Home nova, com os teus próximos jogos logo no topo, e o cartão dos vencedores com foto em todos os jogos, pronto a partilhar.',
        'E ainda: pessoas que talvez conheças; jogo em aberto passo a passo; cada pessoa pode criar um grupo grátis; nos torneios, t-shirts, preço especial e um aviso quando duas categorias chocam; e o Alino, a nossa mascote, quando ainda não há nada para mostrar.',
      ],
      en: [
        'Monthly ranking: it counts the points you win in the month and starts again on the 1st. Whoever finishes on the podium wears a frame around their photo for the following month.',
        'New medals and 27 more achievements, from «Payback» to «Christmas Padel». Check your profile: some may already be yours.',
        'Games with friends from start to finish: you set up the game, play in rounds and, at the end, confirm the result, which counts for the ranking.',
        'More varied mixes: the app no longer pairs people who played together in your last 4 mixes, and Up and Down can switch pairs every round.',
        'A new Home, with your next games right at the top, and the winners card with a photo for every game, ready to share.',
        "Also: people you may know; open game step by step; everyone can create one free group; in tournaments, t-shirts, special price and a warning when two categories clash; and Alino, our mascot, when there's nothing to show yet.",
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
