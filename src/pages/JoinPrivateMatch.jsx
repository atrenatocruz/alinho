import { useState } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { claimPrivateMatchSlot } from '../lib/privateMatches'
import { PrimaryButton } from '../components/ui'

const SLOT_LABELS = {
  team_a_player2: 'na dupla de quem criou o jogo',
  team_b_player1: 'na dupla adversária',
  team_b_player2: 'na dupla adversária',
}

export default function JoinPrivateMatch() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const slot = searchParams.get('slot')
  const navigate = useNavigate()
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')

  const handleJoin = async () => {
    setStatus('joining')
    setError('')
    try {
      await claimPrivateMatchSlot(id, slot)
      setStatus('joined')
    } catch (err) {
      console.error('Error joining private match:', err)
      const message = err.message?.includes('já foi ocupada')
        ? 'Esta posição já foi ocupada por outro jogador.'
        : err.message?.includes('Já estás')
        ? 'Já estás neste jogo.'
        : 'Não foi possível entrar neste jogo.'
      setError(message)
      setStatus('error')
    }
  }

  if (!slot || !SLOT_LABELS[slot]) {
    return (
      <div className="card text-center py-8">
        <p className="text-danger font-extrabold">Link de convite inválido.</p>
      </div>
    )
  }

  if (status === 'joined') {
    return (
      <div className="card text-center py-8 space-y-3">
        <CheckCircle2 size={40} className="mx-auto text-ok" />
        <p className="font-extrabold text-ink-900">Entraste no jogo!</p>
        <PrimaryButton onClick={() => navigate('/jogos-privados')} className="w-full">
          Ver jogo
        </PrimaryButton>
      </div>
    )
  }

  return (
    <div className="card text-center py-8 space-y-4">
      <p className="text-ink-900">Foste convidado para um jogo entre amigos, {SLOT_LABELS[slot]}.</p>
      {error && <p className="text-danger text-sm font-extrabold">{error}</p>}
      <PrimaryButton onClick={handleJoin} disabled={status === 'joining'} className="w-full">
        {status === 'joining' ? 'A entrar…' : 'Entrar no jogo'}
      </PrimaryButton>
    </div>
  )
}
