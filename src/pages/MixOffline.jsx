import { useState, useEffect } from 'react'
import { Trophy, RotateCcw } from 'lucide-react'
import { Wordmark } from '../components/Layout'
import { PrimaryButton } from '../components/ui'
import { formDuplas, seedCourts, nextSobeDesce, standings } from '../lib/mixLogic'

const STORAGE_KEY = 'alinho-mix-offline-v1'

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

// Pulls court count + player names straight out of the WhatsApp bot's
// "Mix completo!" confirmation message, so the admin doesn't have to
// retype 16 names by hand when the DB (and so the real app) is down.
// Title-line "🎾 …" is anchored at column 0, which numbered player rows
// ("N. 🎾 Nome") never are, so the two never collide.
function parseBotMessage(text) {
  const titleMatch = text.match(/^🎾\s*(.+)$/m)
  const courtsMatch = text.match(/🏟️\s*(\d+)\s*campo/)
  const names = [...text.matchAll(/^\s*\d+\.\s*🎾\s*(.+?)\s*$/gm)].map((m) => m[1].trim())
  return {
    title: titleMatch?.[1]?.trim() ?? null,
    numCourts: courtsMatch ? parseInt(courtsMatch[1], 10) : null,
    names,
  }
}

/* Plan-B mix tool: forms duplas and runs a full "sobe e desce" mix — score
   entry, next round, and a final classification — entirely client-side,
   reusing the same pure logic as GameDetails.jsx (mixLogic.js). No
   Supabase call anywhere on this page, so it keeps working during an
   outage of the real app. Reachable directly at /mix-offline, deliberately
   outside any auth Guard (see App.jsx) so it renders even when login
   itself is failing. State is persisted to localStorage so an accidental
   refresh mid-game doesn't lose the draw. */
export default function MixOffline() {
  const saved = loadSaved()
  const [namesText, setNamesText] = useState(saved?.namesText ?? '')
  const [numCourts, setNumCourts] = useState(saved?.numCourts ?? 1)
  const [teams, setTeams] = useState(saved?.teams ?? null)
  const [rounds, setRounds] = useState(saved?.rounds ?? [])
  const [finished, setFinished] = useState(saved?.finished ?? false)
  const [pasteText, setPasteText] = useState('')
  const [parseResult, setParseResult] = useState(null) // { title, numCourts, names } | 'empty' | null
  const [scoreInputs, setScoreInputs] = useState({}) // { [matchIndex]: { a, b } }
  const [scoreError, setScoreError] = useState('')

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ namesText, numCourts, teams, rounds, finished }))
    } catch {
      // storage unavailable (private mode, quota) — tool still works for this session
    }
  }, [namesText, numCourts, teams, rounds, finished])

  const handleExtractFromBotMessage = () => {
    const { title, numCourts: extractedCourts, names: extractedNames } = parseBotMessage(pasteText)
    if (extractedNames.length === 0) {
      setParseResult('empty')
      return
    }
    setNamesText(extractedNames.join('\n'))
    if (extractedCourts) setNumCourts(extractedCourts)
    setParseResult({ title, numCourts: extractedCourts, names: extractedNames })
  }

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
    // seedCourts rows carry no phase — standings() (used at the end) only
    // counts phase:'group' matches, same as GameDetails.jsx tags every
    // sobe-e-desce round.
    setRounds([seedCourts(withIds, numCourts).map((m) => ({ ...m, phase: 'group' }))])
  }

  const currentRound = rounds[rounds.length - 1] || []
  const currentRoundDone = currentRound.length > 0 && currentRound.every((m) => m.winner_team_id)
  const teamById = Object.fromEntries((teams || []).map((t) => [t.id, t]))
  const teamLabel = (id) => {
    const t = teamById[id]
    return t ? `${t.player1.name} / ${t.player2.name}` : '—'
  }

  const handleSaveScore = (matchIndex) => {
    const s = scoreInputs[matchIndex] || {}
    const a = parseInt(s.a, 10)
    const b = parseInt(s.b, 10)
    if (Number.isNaN(a) || Number.isNaN(b) || a < 0 || b < 0) return
    if (a === b) {
      setScoreError('Não existem empates — o resultado tem de ter um vencedor.')
      return
    }
    setScoreError('')
    setRounds((prev) => {
      const next = [...prev]
      const round = [...next[next.length - 1]]
      const m = round[matchIndex]
      round[matchIndex] = { ...m, score_a: a, score_b: b, winner_team_id: a > b ? m.team_a_id : m.team_b_id }
      next[next.length - 1] = round
      return next
    })
  }

  const handleNextRound = () => {
    setScoreInputs({})
    setScoreError('')
    setRounds((prev) => [...prev, nextSobeDesce(currentRound, numCourts).map((m) => ({ ...m, phase: 'group' }))])
  }

  const finalStandings = teams ? standings(teams, rounds.flat()) : []

  const handleFinalize = () => {
    const early = !currentRoundDone
    const msg = early
      ? 'Terminar o mix agora, sem terminar esta ronda, e calcular a classificação com os resultados que já tens?'
      : 'Finalizar o mix e ver a classificação final?'
    if (!confirm(msg)) return
    setFinished(true)
  }

  const handleReset = () => {
    if (teams && !confirm('Recomeçar do zero? Perdes as duplas e rondas atuais.')) return
    setTeams(null)
    setRounds([])
    setFinished(false)
    setScoreInputs({})
    setScoreError('')
  }

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
              Colar mensagem do bot (opcional)
            </label>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={4}
              placeholder={'Cola aqui a mensagem "Mix completo!" do bot do WhatsApp…'}
              className="input-field resize-none mb-2 text-xs"
            />
            <button
              type="button"
              onClick={handleExtractFromBotMessage}
              disabled={!pasteText.trim()}
              className="text-sm font-extrabold text-ink-700 hover:text-ink-900 disabled:opacity-40 disabled:pointer-events-none mb-1.5"
            >
              Extrair jogadores e campos ↓
            </button>
            {parseResult === 'empty' && (
              <p className="text-danger text-xs font-extrabold mb-4">
                Não encontrei jogadores nessa mensagem — confirma que colaste o texto completo.
              </p>
            )}
            {parseResult && parseResult !== 'empty' && (
              <p className="text-ok text-xs font-extrabold mb-4">
                {parseResult.title ? `"${parseResult.title}" — ` : ''}
                {parseResult.names.length} jogadores{parseResult.numCourts ? `, ${parseResult.numCourts} campos` : ''} extraídos.
                A ordem em baixo vem da inscrição, não da força — reordena se quiseres duplas mais equilibradas.
              </p>
            )}

            <label className="block text-sm font-extrabold text-ink-900 mb-1.5 mt-4">
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
        ) : finished ? (
          <div className="card">
            <div className="text-center mb-5">
              <Trophy size={32} className="mx-auto mb-2 text-lime-600" />
              <h2 className="text-lg text-ink-900">Mix terminado!</h2>
              {finalStandings[0] && (
                <p className="text-muted text-sm">🏆 {teamLabel(finalStandings[0].team.id)} venceu</p>
              )}
            </div>
            <div className="space-y-2 mb-5">
              {finalStandings.map((s, i) => (
                <div
                  key={s.team.id}
                  className={`flex items-center justify-between gap-2 rounded-ctrl px-3 py-2.5 ${
                    i === 0 ? 'bg-lime-400/20' : 'bg-canvas'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-extrabold text-muted w-5 shrink-0">{i + 1}º</span>
                    <span className="text-sm font-extrabold text-ink-900 truncate">{teamLabel(s.team.id)}</span>
                  </div>
                  <span className="text-xs font-extrabold text-muted shrink-0 tabular-nums">
                    {s.wins}V · saldo {s.diff >= 0 ? '+' : ''}{s.diff}
                  </span>
                </div>
              ))}
            </div>
            <PrimaryButton variant="ghost" onClick={handleReset} className="w-full flex items-center justify-center gap-1.5">
              <RotateCcw size={16} /> Novo mix
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
              {scoreError && <p className="text-danger text-xs font-extrabold mb-3">{scoreError}</p>}
              <div className="space-y-3">
                {currentRound.map((m, i) => (
                  <div key={i} className="border border-line rounded-ctrl p-3">
                    <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted mb-2">
                      Campo {m.court_number}
                    </p>
                    {m.winner_team_id ? (
                      <div className="space-y-1">
                        {[
                          [m.team_a_id, m.score_a],
                          [m.team_b_id, m.score_b],
                        ].map(([tid, score]) => (
                          <div
                            key={tid}
                            className={`flex items-center justify-between px-3 py-2 rounded-ctrl text-sm font-extrabold ${
                              m.winner_team_id === tid ? 'bg-lime-400 text-ink-900' : 'bg-canvas text-ink-900'
                            }`}
                          >
                            <span className="truncate">{teamLabel(tid)}</span>
                            <span className="tabular-nums shrink-0 ml-2">{score}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {[m.team_a_id, m.team_b_id].map((tid, side) => (
                          <div key={tid} className="flex items-center gap-2">
                            <span className="flex-1 min-w-0 truncate text-sm font-extrabold text-ink-900">
                              {teamLabel(tid)}
                            </span>
                            <input
                              type="number"
                              min={0}
                              inputMode="numeric"
                              value={(scoreInputs[i]?.[side === 0 ? 'a' : 'b']) ?? ''}
                              onChange={(e) =>
                                setScoreInputs((prev) => ({
                                  ...prev,
                                  [i]: { ...prev[i], [side === 0 ? 'a' : 'b']: e.target.value },
                                }))
                              }
                              className="input-field w-16 text-center px-2 py-2"
                            />
                          </div>
                        ))}
                        <PrimaryButton variant="ghost" onClick={() => handleSaveScore(i)} className="w-full">
                          Guardar resultado
                        </PrimaryButton>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {currentRoundDone && (
              <PrimaryButton onClick={handleNextRound} className="w-full mb-3">
                Ronda seguinte
              </PrimaryButton>
            )}

            <PrimaryButton variant="ghost" onClick={handleFinalize} className="w-full">
              Terminar mix
            </PrimaryButton>
          </>
        )}
      </div>
    </div>
  )
}
