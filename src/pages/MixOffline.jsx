import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Trophy, RotateCcw, Share2, Download } from 'lucide-react'
import { Wordmark } from '../components/Layout'
import { PrimaryButton, ShareModal } from '../components/ui'
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

function slugify(text) {
  return (
    (text || 'mix')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'mix'
  )
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
  const { t } = useTranslation()
  const saved = loadSaved()
  const [namesText, setNamesText] = useState(saved?.namesText ?? '')
  const [numCourts, setNumCourts] = useState(saved?.numCourts ?? 1)
  const [gameTitle, setGameTitle] = useState(saved?.gameTitle ?? 'Mix')
  const [teams, setTeams] = useState(saved?.teams ?? null)
  const [rounds, setRounds] = useState(saved?.rounds ?? [])
  const [finished, setFinished] = useState(saved?.finished ?? false)
  const [pasteText, setPasteText] = useState('')
  const [parseResult, setParseResult] = useState(null) // { title, numCourts, names } | 'empty' | null
  const [scoreInputs, setScoreInputs] = useState({}) // { [matchIndex]: { a, b } }
  const [scoreError, setScoreError] = useState('')
  const [shareMode, setShareMode] = useState(null) // 'duplas' | 'final' | null

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ namesText, numCourts, gameTitle, teams, rounds, finished })
      )
    } catch {
      // storage unavailable (private mode, quota) — tool still works for this session
    }
  }, [namesText, numCourts, gameTitle, teams, rounds, finished])

  const handleExtractFromBotMessage = () => {
    const { title, numCourts: extractedCourts, names: extractedNames } = parseBotMessage(pasteText)
    if (extractedNames.length === 0) {
      setParseResult('empty')
      return
    }
    setNamesText(extractedNames.join('\n'))
    if (extractedCourts) setNumCourts(extractedCourts)
    if (title) setGameTitle(title)
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
  const teamById = Object.fromEntries((teams || []).map((team) => [team.id, team]))
  const teamLabel = (id) => {
    const team = teamById[id]
    return team ? `${team.player1.name} / ${team.player2.name}` : '—'
  }

  const handleSaveScore = (matchIndex) => {
    const s = scoreInputs[matchIndex] || {}
    const a = parseInt(s.a, 10)
    const b = parseInt(s.b, 10)
    if (Number.isNaN(a) || Number.isNaN(b) || a < 0 || b < 0) return
    if (a === b) {
      setScoreError(t('mixoffline.no_ties_error'))
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
    const msg = early ? t('mixoffline.finalize_confirm_early') : t('mixoffline.finalize_confirm')
    if (!confirm(msg)) return
    setFinished(true)
  }

  const handleReset = () => {
    if (teams && !confirm(t('mixoffline.reset_confirm'))) return
    setTeams(null)
    setRounds([])
    setFinished(false)
    setScoreInputs({})
    setScoreError('')
    setGameTitle('Mix')
  }

  // Exports everything needed to later populate the real app once it's back
  // up: duplas, every round's scores, and the final ranking (when the mix
  // has ended). JSON rather than anything fancier — an admin (or a future
  // Claude session) can read it directly, and it's trivial to turn into
  // insert statements for `teams`/`matches` afterwards.
  const handleDownloadFile = () => {
    const data = {
      exportedAt: new Date().toISOString(),
      title: gameTitle,
      numCourts,
      duplas: teams.map((team) => ({ player1: team.player1.name, player2: team.player2.name, seed: team.seed_ranking })),
      rounds: rounds.map((round) =>
        round.map((m) => ({
          court_number: m.court_number,
          team_a: teamLabel(m.team_a_id),
          team_b: teamLabel(m.team_b_id),
          score_a: m.score_a ?? null,
          score_b: m.score_b ?? null,
          winner: m.winner_team_id ? teamLabel(m.winner_team_id) : null,
        }))
      ),
      finished,
      finalStandings: finished
        ? finalStandings.map((s, i) => ({
            position: i + 1,
            dupla: teamLabel(s.team.id),
            wins: s.wins,
            diff: s.diff,
            scored: s.scored,
          }))
        : null,
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `alinho-mix-offline-${slugify(gameTitle)}-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const gameForShare = { title: gameTitle, location: null, num_courts: numCourts }
  const shareUrl = typeof window !== 'undefined' ? window.location.href : ''

  const buildDuplasShareText = () => {
    const lines = [t('mixoffline.share_duplas_header', { title: gameTitle }), '']
    for (let c = 1; c <= numCourts; c++) {
      const a = teams[(c - 1) * 2]
      const b = teams[(c - 1) * 2 + 1]
      if (a && b) {
        lines.push(t('mixoffline.share_court_line', {
          court: c,
          teamA: `${a.player1.name} / ${a.player2.name}`,
          teamB: `${b.player1.name} / ${b.player2.name}`,
        }))
      }
    }
    teams.slice(numCourts * 2).forEach((team) => lines.push(`${team.player1.name} / ${team.player2.name}`))
    return lines.join('\n')
  }

  const buildFinalShareText = () => {
    const lines = [t('mixoffline.share_final_header', { title: gameTitle })]
    if (finalStandings[0]) lines.push('', t('mixoffline.share_winners_line', { name: teamLabel(finalStandings[0].team.id) }))
    return lines.join('\n')
  }

  const podiumDuplas = finalStandings.map((s) => ({
    id: s.team.id,
    name: teamLabel(s.team.id),
    player1: s.team.player1,
    player2: s.team.player2,
    points: s.wins,
  }))

  return (
    <div className="min-h-screen bg-canvas px-5 py-8">
      <div className="max-w-md mx-auto">
        <div className="flex items-center justify-between mb-6">
          <Wordmark variant="light" className="h-7" />
          <span className="text-[11px] font-extrabold uppercase tracking-widest text-muted">{t('mixoffline.plan_b_badge')}</span>
        </div>

        <div className="card mb-4">
          <h1 className="text-lg text-ink-900 mb-1">{t('mixoffline.title')}</h1>
          <p className="text-muted text-sm">
            {t('mixoffline.subtitle')}
          </p>
        </div>

        {!teams ? (
          <div className="card">
            <label className="block text-sm font-extrabold text-ink-900 mb-1.5">
              {t('mixoffline.paste_bot_message_label')}
            </label>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={4}
              placeholder={t('mixoffline.paste_bot_placeholder')}
              className="input-field resize-none mb-2 text-xs"
            />
            <button
              type="button"
              onClick={handleExtractFromBotMessage}
              disabled={!pasteText.trim()}
              className="text-sm font-extrabold text-ink-700 hover:text-ink-900 disabled:opacity-40 disabled:pointer-events-none mb-1.5"
            >
              {t('mixoffline.extract_button')}
            </button>
            {parseResult === 'empty' && (
              <p className="text-danger text-xs font-extrabold mb-4">
                {t('mixoffline.extract_empty_error')}
              </p>
            )}
            {parseResult && parseResult !== 'empty' && (
              <p className="text-ok text-xs font-extrabold mb-4">
                {parseResult.title ? t('mixoffline.parsed_title_prefix', { title: parseResult.title }) : ''}
                {parseResult.numCourts
                  ? t('mixoffline.parsed_summary_with_courts', { count: parseResult.names.length, courts: parseResult.numCourts })
                  : t('mixoffline.parsed_summary', { count: parseResult.names.length })}
                {' '}
                {t('mixoffline.parsed_order_note')}
              </p>
            )}

            <label className="block text-sm font-extrabold text-ink-900 mb-1.5 mt-4">{t('mixoffline.mix_name_label')}</label>
            <input
              type="text"
              value={gameTitle}
              onChange={(e) => setGameTitle(e.target.value)}
              className="input-field mb-4"
            />

            <label className="block text-sm font-extrabold text-ink-900 mb-1.5">
              {t('mixoffline.players_label')}
            </label>
            <textarea
              value={namesText}
              onChange={(e) => setNamesText(e.target.value)}
              rows={8}
              placeholder={t('mixoffline.players_placeholder')}
              className="input-field resize-none mb-4"
            />
            <label className="block text-sm font-extrabold text-ink-900 mb-1.5">{t('mixoffline.num_courts_label')}</label>
            <input
              type="number"
              min={1}
              value={numCourts}
              onChange={(e) => setNumCourts(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="input-field mb-4 w-24"
            />
            <p className="text-xs text-muted mb-4">
              {t('mixoffline.player_count', { count: names.length })} — {t('mixoffline.need_min_people', { min: minPeople })}
              {names.length % 2 !== 0 ? t('mixoffline.odd_number_note') : ''} {t('mixoffline.for_court_count', { count: numCourts })}
            </p>
            <PrimaryButton onClick={handleFormTeams} disabled={!canFormTeams} className="w-full">
              {t('mixoffline.form_teams_button')}
            </PrimaryButton>
          </div>
        ) : finished ? (
          <div className="card">
            <div className="text-center mb-5">
              <Trophy size={32} className="mx-auto mb-2 text-lime-600" />
              <h2 className="text-lg text-ink-900">{t('mixoffline.finished_title')}</h2>
              {finalStandings[0] && (
                <p className="text-muted text-sm">{t('mixoffline.winner_announcement', { name: teamLabel(finalStandings[0].team.id) })}</p>
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
                    {t('mixoffline.standings_line', { wins: s.wins, diff: `${s.diff >= 0 ? '+' : ''}${s.diff}` })}
                  </span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <PrimaryButton variant="ghost" onClick={() => setShareMode('final')} className="flex items-center justify-center gap-1.5">
                <Share2 size={16} /> {t('mixoffline.share_button')}
              </PrimaryButton>
              <PrimaryButton variant="ghost" onClick={handleDownloadFile} className="flex items-center justify-center gap-1.5">
                <Download size={16} /> {t('mixoffline.save_file_button')}
              </PrimaryButton>
            </div>
            <PrimaryButton variant="ghost" onClick={handleReset} className="w-full flex items-center justify-center gap-1.5">
              <RotateCcw size={16} /> {t('mixoffline.new_mix_button')}
            </PrimaryButton>
          </div>
        ) : (
          <>
            <div className="card mb-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base text-ink-900">{t('mixoffline.round_title', { round: rounds.length })}</h2>
                <div className="flex items-center gap-3">
                  <button onClick={() => setShareMode('duplas')} className="text-xs font-extrabold text-ink-700 flex items-center gap-1">
                    <Share2 size={14} /> {t('mixoffline.duplas_button')}
                  </button>
                  <button onClick={handleDownloadFile} className="text-xs font-extrabold text-ink-700 flex items-center gap-1">
                    <Download size={14} /> {t('mixoffline.save_button')}
                  </button>
                  <button onClick={handleReset} className="text-xs font-extrabold text-danger flex items-center gap-1">
                    <RotateCcw size={14} /> {t('mixoffline.restart_button')}
                  </button>
                </div>
              </div>
              {scoreError && <p className="text-danger text-xs font-extrabold mb-3">{scoreError}</p>}
              <div className="space-y-3">
                {currentRound.map((m, i) => (
                  <div key={i} className="border border-line rounded-ctrl p-3">
                    <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted mb-2">
                      {t('mixoffline.court_number_label', { court: m.court_number })}
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
                          {t('mixoffline.save_score_button')}
                        </PrimaryButton>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {currentRoundDone && (
              <PrimaryButton onClick={handleNextRound} className="w-full mb-3">
                {t('mixoffline.next_round_button')}
              </PrimaryButton>
            )}

            <PrimaryButton variant="ghost" onClick={handleFinalize} className="w-full">
              {t('mixoffline.finish_mix_button')}
            </PrimaryButton>
          </>
        )}

        {shareMode === 'duplas' && teams && (
          <ShareModal
            title={t('mixoffline.share_duplas_title')}
            message={buildDuplasShareText()}
            url={shareUrl}
            onClose={() => setShareMode(null)}
            imageCard={{ variant: 'duplas', game: gameForShare, duplas: teams }}
          />
        )}
        {shareMode === 'final' && teams && (
          <ShareModal
            title={t('mixoffline.share_mix_title')}
            message={buildFinalShareText()}
            url={shareUrl}
            onClose={() => setShareMode(null)}
            imageCard={{ variant: 'podium', game: gameForShare, duplas: podiumDuplas }}
          />
        )}
      </div>
    </div>
  )
}
