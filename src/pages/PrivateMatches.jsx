import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Trophy, Copy, Check } from 'lucide-react'
import { getMyPrivateMatches, submitPrivateMatchScore, confirmPrivateMatch } from '../lib/privateMatches'
import { PrimaryButton, EmptyState } from '../components/ui'

const OPEN_SLOTS = [
  { key: 'team_a_player2', idField: 'team_a_player2_id' },
  { key: 'team_b_player1', idField: 'team_b_player1_id' },
  { key: 'team_b_player2', idField: 'team_b_player2_id' },
]

function ScoreForm({ match, onSubmit }) {
  const [scoreA, setScoreA] = useState('')
  const [scoreB, setScoreB] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await onSubmit(match.id, Number(scoreA), Number(scoreB))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 mt-3">
      <input type="number" value={scoreA} onChange={(e) => setScoreA(e.target.value)} className="input-field w-16 text-center" placeholder="0" required />
      <span className="text-muted font-extrabold">-</span>
      <input type="number" value={scoreB} onChange={(e) => setScoreB(e.target.value)} className="input-field w-16 text-center" placeholder="0" required />
      <PrimaryButton type="submit" disabled={saving} className="flex-1">
        {saving ? 'A guardar…' : 'Registar resultado'}
      </PrimaryButton>
    </form>
  )
}

function InviteLinks({ match }) {
  const [copied, setCopied] = useState('')
  const openSlots = OPEN_SLOTS.filter((s) => !match[s.idField])
  if (openSlots.length === 0) return null

  const copyLink = async (slotKey) => {
    const url = `${window.location.origin}/jogos-privados/${match.id}/entrar?slot=${slotKey}`
    await navigator.clipboard.writeText(url)
    setCopied(slotKey)
    setTimeout(() => setCopied(''), 1500)
  }

  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs text-muted">Faltam {openSlots.length} jogador(es):</p>
      {openSlots.map((s) => (
        <button
          key={s.key}
          type="button"
          onClick={() => copyLink(s.key)}
          className="flex items-center gap-2 text-xs font-extrabold text-ink-700 hover:text-ink-900"
        >
          {copied === s.key ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
          {copied === s.key ? 'Link copiado!' : 'Copiar link de convite'}
        </button>
      ))}
    </div>
  )
}

const teamLabel = (m, prefix) => {
  const p1 = m[`${prefix}_player1_name`]
  const p2 = m[`${prefix}_player2_name`]
  return [p1, p2].filter(Boolean).join(' + ') || 'Por convidar'
}

export default function PrivateMatches() {
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const data = await getMyPrivateMatches()
      setMatches(data)
    } catch (error) {
      console.error('Error loading private matches:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSubmitScore = async (matchId, scoreA, scoreB) => {
    try {
      await submitPrivateMatchScore(matchId, scoreA, scoreB)
      await load()
    } catch (error) {
      console.error('Error submitting score:', error)
      alert('Não foi possível registar o resultado.')
    }
  }

  const handleConfirm = async (matchId) => {
    try {
      await confirmPrivateMatch(matchId)
      await load()
    } catch (error) {
      console.error('Error confirming match:', error)
      alert('Não foi possível confirmar o jogo.')
    }
  }

  const pending = matches.filter((m) => m.status === 'pending')
  const confirmed = matches.filter((m) => m.status === 'confirmed')

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl text-ink-900">Jogos entre amigos</h2>
        <Link to="/jogos-privados/novo">
          <PrimaryButton>
            <Plus size={18} /> Novo
          </PrimaryButton>
        </Link>
      </div>

      {pending.length > 0 && (
        <div>
          <h3 className="text-lg text-ink-900 mb-3">Por confirmar</h3>
          <div className="space-y-3">
            {pending.map((m) => {
              const canConfirm = m.is_creator && m.score_a !== null && m.team_a_player2_id && m.team_b_player1_id && m.team_b_player2_id
              return (
                <div key={m.id} className="card">
                  <p className="font-extrabold text-ink-900 text-sm">{teamLabel(m, 'team_a')} vs {teamLabel(m, 'team_b')}</p>
                  {m.score_a !== null && m.score_b !== null ? (
                    <p className="text-sm text-muted mt-1">
                      Resultado: {m.score_a} - {m.score_b}
                      {!m.is_creator ? ' · aguarda confirmação de quem criou o jogo' : ''}
                    </p>
                  ) : (
                    <ScoreForm match={m} onSubmit={handleSubmitScore} />
                  )}
                  {canConfirm && (
                    <PrimaryButton onClick={() => handleConfirm(m.id)} className="w-full mt-3">
                      Confirmar resultado
                    </PrimaryButton>
                  )}
                  <InviteLinks match={m} />
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-lg text-ink-900 mb-3">Histórico</h3>
        {confirmed.length === 0 ? (
          <EmptyState
            icon={Trophy}
            title="Ainda não tens jogos confirmados"
            subtitle="Cria o teu primeiro jogo entre amigos."
          />
        ) : (
          <div className="space-y-2.5">
            {confirmed.map((m) => (
              <div key={m.id} className="card">
                <p className="font-extrabold text-ink-900 text-sm">{teamLabel(m, 'team_a')} vs {teamLabel(m, 'team_b')}</p>
                <p className="text-[11px] text-muted mt-0.5">
                  {m.score_a} - {m.score_b} · {m.my_points} pontos
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
