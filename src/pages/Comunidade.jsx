import { useNavigate } from 'react-router-dom'
import PlayerSearch from '../components/PlayerSearch'

export default function Comunidade() {
  const navigate = useNavigate()

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-3xl text-ink-900">Comunidade</h2>
        <p className="text-muted text-sm mt-0.5">Procura outros padeleiros pelo nome</p>
      </div>

      <PlayerSearch
        label="Procurar jogador..."
        selected={null}
        onSelect={(player) => navigate(`/jogador/${player.id}`)}
        onClear={() => {}}
      />
    </div>
  )
}
