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
