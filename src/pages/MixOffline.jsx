import { useState, useEffect } from 'react'
import { Trophy, RotateCcw } from 'lucide-react'
import { Wordmark } from '../components/Layout'
import { PrimaryButton } from '../components/ui'
import { formDuplas, seedCourts, nextSobeDesce } from '../lib/mixLogic'

const STORAGE_KEY = 'alinho-mix-offline-v1'

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/* Plan-B mix tool: forms duplas and draws "sobe e desce" rounds entirely
   client-side, reusing the same pure logic as GameDetails.jsx (mixLogic.js)
   — no Supabase call anywhere on this page, so it keeps working even
   during an outage of the real app. Reachable directly at /mix-offline,
   deliberately outside any auth Guard (see App.jsx) so it renders even
   when login itself is failing. State is persisted to localStorage so an
   accidental refresh mid-game doesn't lose the draw. */
export default function MixOffline() {
  const saved = loadSaved()
  const [namesText, setNamesText] = useState(saved?.namesText ?? '')
  const [numCourts, setNumCourts] = useState(saved?.numCourts ?? 1)
  const [teams, setTeams] = useState(saved?.teams ?? null)
  const [rounds, setRounds] = useState(saved?.rounds ?? [])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ namesText, numCourts, teams, rounds }))
    } catch {
      // storage unavailable (private mode, quota) — tool still works for this session
    }
  }, [namesText, numCourts, teams, rounds])

  const names = namesText.split('\n').map((n) => n.trim()).filter(Boolean)
  const minPeople = numCourts * 4
  const canFormTeams = names.length >= minPeople && names.length % 2 === 0

  const handleFormTeams = () => {
    if (!canFormTeams) return
    // Solos only (no pre-formed duo sign-ups offline) — order top-to-bottom
    // as typed, strongest first, drives the pairing via descending points.
    const participants = names.map((name, i) => ({ status: 'confirmed', user: { id: String(i), name } }))
    const pointsById = Object.fromEntries(names.map((_, i) => [String(i), names.length - i]))
    const duplas = formDuplas(participants, pointsById, new Set())
    const withIds = duplas.map((d, i) => ({ ...d, id: `t${i}`, seed_ranking: d.seed }))
    setTeams(withIds)
    setRounds([seedCourts(withIds, numCourts)])
  }

  const currentRound = rounds[rounds.length - 1] || []
  const currentRoundDone = currentRound.length > 0 && currentRound.every((m) => m.winner_team_id)
  const teamById = Object.fromEntries((teams || []).map((t) => [t.id, t]))
  const teamLabel = (id) => {
    const t = teamById[id]
    return t ? `${t.player1.name} / ${t.player2.name}` : '—'
  }

  const setWinner = (matchIndex, winnerId) => {
    setRounds((prev) => {
      const next = [...prev]
      const round = [...next[next.length - 1]]
      round[matchIndex] = { ...round[matchIndex], winner_team_id: winnerId }
      next[next.length - 1] = round
      return next
    })
  }

  const handleNextRound = () => {
    setRounds((prev) => [...prev, nextSobeDesce(currentRound, numCourts)])
  }

  const handleReset = () => {
    if (teams && !confirm('Recomeçar do zero? Perdes as duplas e rondas atuais.')) return
    setTeams(null)
    setRounds([])
  }

  const leaderTeamId = currentRoundDone
    ? currentRound.find((m) => m.court_number === 1)?.winner_team_id
    : null

  return (
    <div className="min-h-screen bg-canvas px-5 py-8">
      <div className="max-w-md mx-auto">
        <div className="flex items-center justify-between mb-6">
          <Wordmark variant="light" className="h-7" />
          <span className="text-[11px] font-extrabold uppercase tracking-widest text-muted">Plano B — sem conta</span>
        </div>

        <div className="card mb-4">
          <h1 className="text-lg text-ink-900 mb-1">Mix sem app</h1>
          <p className="text-muted text-sm">
            Forma duplas e sorteia campos sem precisar de conta nem de ligação ao servidor —
            tudo corre neste ecrã. Continua a funcionar mesmo se o alinho estiver em baixo.
          </p>
        </div>

        {!teams ? (
          <div className="card">
            <label className="block text-sm font-extrabold text-ink-900 mb-1.5">
              Jogadores confirmados (um por linha, do mais forte para o mais fraco)
            </label>
            <textarea
              value={namesText}
              onChange={(e) => setNamesText(e.target.value)}
              rows={8}
              placeholder={'Renato\nJoão\nMaria\nAna\n…'}
              className="input-field resize-none mb-4"
            />
            <label className="block text-sm font-extrabold text-ink-900 mb-1.5">Nº de campos</label>
            <input
              type="number"
              min={1}
              value={numCourts}
              onChange={(e) => setNumCourts(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="input-field mb-4 w-24"
            />
            <p className="text-xs text-muted mb-4">
              {names.length} jogador{names.length === 1 ? '' : 'es'} — precisas de {minPeople}
              {names.length % 2 !== 0 ? ' (número par)' : ''} para {numCourts} campo{numCourts === 1 ? '' : 's'}.
            </p>
            <PrimaryButton onClick={handleFormTeams} disabled={!canFormTeams} className="w-full">
              Formar duplas e sortear Ronda 1
            </PrimaryButton>
          </div>
        ) : (
          <>
            <div className="card mb-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base text-ink-900">Ronda {rounds.length}</h2>
                <button onClick={handleReset} className="text-xs font-extrabold text-danger flex items-center gap-1">
                  <RotateCcw size={14} /> Recomeçar
                </button>
              </div>
              <div className="space-y-3">
                {currentRound.map((m, i) => (
                  <div key={i} className="border border-line rounded-ctrl p-3">
                    <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted mb-2">
                      Campo {m.court_number}
                    </p>
                    <div className="space-y-1.5">
                      {[m.team_a_id, m.team_b_id].map((tid) => (
                        <button
                          key={tid}
                          type="button"
                          onClick={() => setWinner(i, tid)}
                          className={`w-full text-left px-3 py-2.5 rounded-ctrl text-sm font-extrabold transition-colors duration-fast ${
                            m.winner_team_id === tid ? 'bg-lime-400 text-ink-900' : 'bg-canvas text-ink-900 hover:bg-ink-50'
                          }`}
                        >
                          {teamLabel(tid)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {currentRoundDone && (
              <PrimaryButton onClick={handleNextRound} className="w-full mb-4">
                Ronda seguinte
              </PrimaryButton>
            )}

            {leaderTeamId && (
              <div className="card text-center">
                <Trophy size={28} className="mx-auto mb-2 text-lime-600" />
                <p className="text-sm text-muted mb-1">A liderar (campo 1)</p>
                <p className="text-lg text-ink-900 font-extrabold">{teamLabel(leaderTeamId)}</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
