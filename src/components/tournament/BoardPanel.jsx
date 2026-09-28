// «Quadro» — o 1.º separador da página do torneio (revisão de 28 set, a do
// Renato com a do Francisco: «Quadro · Horário · Duplas», iguais para todos).
// Os grupos e o quadro, por esta ordem; o horário tem separador próprio.
import AllGamesPanel from './AllGamesPanel'

export default function BoardPanel(props) {
  return <AllGamesPanel {...props} sections={['groups', 'draw']} />
}
