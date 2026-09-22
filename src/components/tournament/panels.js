// Onde cada agente pendura o seu ecrã da página do torneio: UMA linha por
// separador. O esqueleto (rotas, topo, seletor de categoria, separadores) é
// do Dev 1; cada painel é um ficheiro novo em src/components/tournament/.
//
// Enquanto um separador estiver a `null`, a página mostra no lugar dele um
// aviso curto a dizer de que cartão vem — nada rebenta e ninguém precisa de
// mexer em TournamentPage.jsx.
//
// Cada painel recebe as mesmas props:
//   { tournament, categories, category, my, myMatches, isAdmin }
//
// Como acrescentar o teu: cria o ficheiro e troca o `null` pela linha
//   groups: lazy(() => import('./GroupsPanel')),
import { lazy } from 'react'

export const TOURNAMENT_PANELS = {
  // Aviso do organizador — fica acima de tudo, e só existe quando há aviso
  // (SPEC §4.11). Sem aviso não fica espaço reservado.
  // O registo do Dev 2 fica onde ele o pôs — mexer nele era mexer no
  // trabalho dele. Quando quiser, move o SignupSlot para `under_header` e
  // o `top` fica livre para os avisos do organizador, que é o 6/6.
  top: lazy(() => import('./NoticesSlot')), //          Dev 2 · «Torneio 6/6»
  // Logo por baixo do cartão do topo, antes da categoria e dos separadores:
  // é a ordem do desenho «Quem chega de fora» — cartaz, depois «Inscrever a
  // minha dupla», depois as categorias. Pedido do Dev 2 (22 set).
  under_header: lazy(() => import('./SignupSlot')), //  Dev 2 · «Torneio 2/6» e «3/6»
  my_games: lazy(() => import('./MyGamesPanel')), //    Dev 1 · «Torneio 1/6»
  groups: lazy(() => import('./GroupsPanel')), //       Dev 3 · «Torneio 4/6»
  draw: lazy(() => import('./DrawPanel')), //           Dev 3 · «Torneio 4/6»
  calendar: lazy(() => import('./CalendarPanel')), //   Dev 3 · «Torneio 4/6»
  entries: lazy(() => import('./EntriesPanel')), //     Dev 2 · «Torneio 2/6»
}

/** A ordem dos separadores é a do desenho (print 05) e não se mexe:
 *  Os meus jogos · Grupos · Quadro · Calendário · Inscritos. */
export const TOURNAMENT_TABS = ['my_games', 'groups', 'draw', 'calendar', 'entries']

/** De que cartão vem cada separador — é o que aparece enquanto não está
 *  feito, para se perceber à vista quem falta entregar. */
export const TOURNAMENT_TAB_OWNER = {
  my_games: 'Torneio 1/6',
  groups: 'Torneio 4/6',
  draw: 'Torneio 4/6',
  calendar: 'Torneio 4/6',
  entries: 'Torneio 2/6',
}
