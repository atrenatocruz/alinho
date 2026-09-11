import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Plus, Trophy, Copy, Check, Trash2, Calendar, MapPin } from 'lucide-react'
import {
  getMyPrivateMatches, submitPrivateMatchScore, confirmPrivateMatch, deletePrivateMatch, respondToPrivateMatch,
} from '../lib/privateMatches'
import { useAuth } from '../contexts/AuthContext'
import { PrimaryButton, EmptyState } from '../components/ui'
import { formatDate } from '../lib/formatDate'

// The 3 slots that can be empty, filled by an app player, or filled by a
// name-only guest — team_a_player1 is always the creator, always a real
// account, never any of those three states.
const OPEN_SLOTS = [
  { key: 'team_a_player2' },
  { key: 'team_b_player1' },
  { key: 'team_b_player2' },
]
const ALL_SLOTS = [{ key: 'team_a_player1' }, ...OPEN_SLOTS]

const isSlotFilled = (m, key) => !!(m[`${key}_id`] || m[`${key}_guest_name`])
const slotName = (m, key) => m[`${key}_name`] || m[`${key}_guest_name`]

const STATUS_META = {
  pending: { labelKey: 'privatematches.status_pending', className: 'bg-ink-50 text-muted' },
  accepted_all: { labelKey: 'privatematches.status_accepted_all', className: 'bg-ok/15 text-ok' },
  accepted_no_ranking: { labelKey: 'privatematches.status_accepted_no_ranking', className: 'bg-amber-100 text-amber-700' },
  rejected: { labelKey: 'privatematches.status_rejected', className: 'bg-danger/10 text-danger' },
  guest: { labelKey: 'privatematches.status_guest', className: 'bg-ink-50 text-muted' },
}

function InviteLinks({ match }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState('')
  const openSlots = OPEN_SLOTS.filter((s) => !isSlotFilled(match, s.key))
  if (openSlots.length === 0) return null

  const copyLink = async (slotKey) => {
    const url = `${window.location.origin}/jogos-privados/${match.id}/entrar?slot=${slotKey}`
    await navigator.clipboard.writeText(url)
    setCopied(slotKey)
    setTimeout(() => setCopied(''), 1500)
  }

  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs text-muted">{t('privatematches.missing_players', { count: openSlots.length })}</p>
      {openSlots.map((s) => (
        <button
          key={s.key}
          type="button"
          onClick={() => copyLink(s.key)}
          className="flex items-center gap-2 text-xs font-extrabold text-ink-700 hover:text-ink-900"
        >
          {copied === s.key ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
          {copied === s.key ? t('privatematches.link_copied') : t('privatematches.copy_invite_link')}
        </button>
      ))}
    </div>
  )
}

// One pill per filled slot, name + consent status — lets everyone see at a
// glance who's still "por responder" without opening anything.
function ParticipantStatusRow({ match }) {
  const { t } = useTranslation()
  const filled = ALL_SLOTS.filter((s) => isSlotFilled(match, s.key))
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {filled.map((s) => {
        const meta = STATUS_META[match[`${s.key}_status`]] || STATUS_META.pending
        return (
          <span key={s.key} className={`inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-1 rounded-full ${meta.className}`}>
            {slotName(match, s.key)} · {t(meta.labelKey)}
          </span>
        )
      })}
    </div>
  )
}

// Prompt shown only on the current user's own slot, only while it's still
// 'pending' — everyone else's slot is read-only to me (ParticipantStatusRow
// above already shows their state).
function MyResponsePrompt({ match, onRespond, responding }) {
  const { t } = useTranslation()
  return (
    <div className="mt-3 rounded-ctrl bg-canvas border border-line p-3 space-y-2">
      <p className="text-xs font-extrabold text-ink-900">{t('privatematches.respond_prompt')}</p>
      <div className="flex flex-wrap gap-2">
        {match.ranked_intent ? (
          <>
            <button
              type="button"
              disabled={responding}
              onClick={() => onRespond(match.id, 'accept_all')}
              className="px-3 py-2 rounded-ctrl bg-ok/15 text-ok text-xs font-extrabold hover:bg-ok/25 disabled:opacity-40"
            >
              {t('privatematches.respond_accept_all')}
            </button>
            <button
              type="button"
              disabled={responding}
              onClick={() => onRespond(match.id, 'accept_no_ranking')}
              className="px-3 py-2 rounded-ctrl bg-amber-100 text-amber-700 text-xs font-extrabold hover:bg-amber-200 disabled:opacity-40"
            >
              {t('privatematches.respond_accept_no_ranking')}
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={responding}
            onClick={() => onRespond(match.id, 'accept_no_ranking')}
            className="px-3 py-2 rounded-ctrl bg-ok/15 text-ok text-xs font-extrabold hover:bg-ok/25 disabled:opacity-40"
          >
            {t('privatematches.respond_accept')}
          </button>
        )}
        <button
          type="button"
          disabled={responding}
          onClick={() => onRespond(match.id, 'reject')}
          className="px-3 py-2 rounded-ctrl bg-danger/10 text-danger text-xs font-extrabold hover:bg-danger/20 disabled:opacity-40"
        >
          {t('privatematches.respond_reject')}
        </button>
      </div>
    </div>
  )
}

// pontos_simples: um resultado só, dois números (qualquer valor — cobre
// "muitos pontos num set só").
function ScoreEntrySimple({ initial, onSave, saving }) {
  const { t } = useTranslation()
  const [a, setA] = useState(initial?.a ?? '')
  const [b, setB] = useState(initial?.b ?? '')
  const aNum = parseInt(a, 10)
  const bNum = parseInt(b, 10)
  const valid = a !== '' && b !== '' && !Number.isNaN(aNum) && !Number.isNaN(bNum) && aNum !== bNum && aNum >= 0 && bNum >= 0

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input type="number" min="0" inputMode="numeric" value={a} onChange={(e) => setA(e.target.value)} className="input-field w-16 text-center" placeholder="0" />
        <span className="text-muted font-extrabold">-</span>
        <input type="number" min="0" inputMode="numeric" value={b} onChange={(e) => setB(e.target.value)} className="input-field w-16 text-center" placeholder="0" />
      </div>
      {valid && (
        <PrimaryButton onClick={() => onSave({ score_a: aNum, score_b: bNum })} disabled={saving} className="w-full">
          {saving ? t('privatematches.saving') : t('privatematches.submit_score')}
        </PrimaryButton>
      )}
    </div>
  )
}

// 'sets': a pessoa escolhe quantos sets ao criar o jogo (numSets) — aqui
// registam-se todos de uma vez, sem regra de "quem fecha primeiro" (os
// amigos nem sempre seguem as regras todas). O resultado final é quantos
// sets cada lado ganhou; empate nos sets pede correção antes de gravar.
function ScoreEntrySets({ numSets, onSave, saving }) {
  const { t } = useTranslation()
  const [sets, setSets] = useState(() => Array.from({ length: numSets }, () => ({ a: '', b: '' })))

  const updateSet = (i, side, value) =>
    setSets((prev) => prev.map((s, idx) => (idx === i ? { ...s, [side]: value } : s)))

  const parsed = sets.map((s) => ({ a: parseInt(s.a, 10), b: parseInt(s.b, 10) }))
  const allFilled = sets.every((s, i) =>
    s.a !== '' && s.b !== '' && !Number.isNaN(parsed[i].a) && !Number.isNaN(parsed[i].b) && parsed[i].a >= 0 && parsed[i].b >= 0
  )
  const setsWonA = parsed.filter((s) => s.a > s.b).length
  const setsWonB = parsed.filter((s) => s.b > s.a).length
  const tied = allFilled && setsWonA === setsWonB

  return (
    <div className="space-y-2">
      {sets.map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-xs font-extrabold text-muted w-16 shrink-0">{t('privatematches.set_label', { number: i + 1 })}</span>
          <input type="number" min="0" inputMode="numeric" value={s.a} onChange={(e) => updateSet(i, 'a', e.target.value)} className="input-field w-16 text-center" placeholder="0" />
          <span className="text-muted font-extrabold">-</span>
          <input type="number" min="0" inputMode="numeric" value={s.b} onChange={(e) => updateSet(i, 'b', e.target.value)} className="input-field w-16 text-center" placeholder="0" />
        </div>
      ))}
      {tied && <p className="text-xs text-danger font-extrabold">{t('privatematches.sets_tied_error')}</p>}
      {allFilled && !tied && (
        <PrimaryButton
          onClick={() => onSave({ score_a: setsWonA, score_b: setsWonB, sets: parsed.map((s) => ({ score_a: s.a, score_b: s.b })) })}
          disabled={saving}
          className="w-full"
        >
          {saving ? t('privatematches.saving') : t('privatematches.submit_score')}
        </PrimaryButton>
      )}
    </div>
  )
}

const teamLabel = (m, prefix, t) => {
  const p1 = slotName(m, `${prefix}_player1`)
  const p2 = slotName(m, `${prefix}_player2`)
  return [p1, p2].filter(Boolean).join(' + ') || t('privatematches.to_be_invited')
}

export default function PrivateMatches() {
  const { t, i18n } = useTranslation()
  const { profile } = useAuth()
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)
  // Pending matches whose already-submitted score is being corrected.
  const [editingScoreIds, setEditingScoreIds] = useState(new Set())
  // { [matchId]: { a, b } } — only used by ScoreEntry's pontos_simples/
  // pro_set_9 branch; the sets branch keeps its own internal state.
  const [scores, setScores] = useState({})
  const [submittingId, setSubmittingId] = useState(null)
  const [respondingId, setRespondingId] = useState(null)

  const toggleEditScore = (match) => {
    setEditingScoreIds((prev) => {
      const next = new Set(prev)
      if (next.has(match.id)) {
        next.delete(match.id)
      } else {
        next.add(match.id)
        // Prefill from the stored score so opening "corrigir" doesn't start
        // from a blank pair — only meaningful for the single-pair formats,
        // harmless (unused) for the sets ones.
        setScores((prevScores) => ({ ...prevScores, [match.id]: { a: String(match.score_a ?? ''), b: String(match.score_b ?? '') } }))
      }
      return next
    })
  }

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

  const handleSubmitScore = async (matchId, finalScore) => {
    setSubmittingId(matchId)
    try {
      await submitPrivateMatchScore(matchId, finalScore)
      setEditingScoreIds((prev) => {
        if (!prev.has(matchId)) return prev
        const next = new Set(prev)
        next.delete(matchId)
        return next
      })
      await load()
    } catch (error) {
      console.error('Error submitting score:', error)
      alert(t('privatematches.error_submit_score'))
    } finally {
      setSubmittingId(null)
    }
  }

  const handleConfirm = async (matchId) => {
    try {
      await confirmPrivateMatch(matchId)
      await load()
    } catch (error) {
      console.error('Error confirming match:', error)
      alert(t('privatematches.error_confirm'))
    }
  }

  const handleRespond = async (matchId, response) => {
    setRespondingId(matchId)
    try {
      await respondToPrivateMatch(matchId, response)
      await load()
    } catch (error) {
      console.error('Error responding to private match:', error)
      alert(t('privatematches.error_respond'))
    } finally {
      setRespondingId(null)
    }
  }

  const handleDelete = async (matchId) => {
    if (!confirm(t('privatematches.confirm_delete'))) return
    try {
      await deletePrivateMatch(matchId)
      await load()
    } catch (error) {
      console.error('Error deleting match:', error)
      alert(t('privatematches.error_delete'))
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
      <Link to="/perfil" className="inline-flex items-center gap-1.5 text-ink-700 font-extrabold text-sm min-h-[44px]">
        <ArrowLeft size={20} />
        {t('privatematches.back')}
      </Link>

      <div className="flex items-center justify-between">
        <h2 className="text-3xl text-ink-900">{t('privatematches.title')}</h2>
        <Link to="/jogos-privados/novo">
          <PrimaryButton>
            <Plus size={18} /> {t('privatematches.new_button')}
          </PrimaryButton>
        </Link>
      </div>

      {pending.length > 0 && (
        <div>
          <h3 className="text-lg text-ink-900 mb-3">{t('privatematches.pending_confirmation')}</h3>
          <div className="space-y-3">
            {pending.map((m) => {
              const hasScore = m.score_a !== null && m.score_b !== null
              const isEditingScore = editingScoreIds.has(m.id)
              // Confirmação cruzada: quem submeteu o resultado define a
              // equipa que NÃO pode confirmar — só a adversária valida e
              // fecha o jogo (o RPC impõe o mesmo, incluindo a exceção para
              // quando essa equipa é só convidados sem conta).
              const teamAIds = [m.team_a_player1_id, m.team_a_player2_id]
              const myTeam = teamAIds.includes(profile?.id) ? 'a' : 'b'
              const submitterTeam = m.score_submitted_by
                ? (teamAIds.includes(m.score_submitted_by) ? 'a' : 'b')
                : null
              const allFilled = isSlotFilled(m, 'team_a_player2') && isSlotFilled(m, 'team_b_player1') && isSlotFilled(m, 'team_b_player2')
              const opponentTeamHasRealPlayer = myTeam === 'a'
                ? (!!m.team_b_player1_id || !!m.team_b_player2_id)
                : (!!m.team_a_player1_id || !!m.team_a_player2_id)
              const canConfirm = hasScore && allFilled && submitterTeam !== null
                && (submitterTeam !== myTeam || !opponentTeamHasRealPlayer)

              const mySlot = ALL_SLOTS.find((s) => m[`${s.key}_id`] === profile?.id)
              const myStatus = mySlot ? m[`${mySlot.key}_status`] : null
              const needsMyResponse = myStatus === 'pending'

              const scheduleLine = [
                formatDate(m.scheduled_date, i18n.language, { day: '2-digit', month: 'short', year: 'numeric' }),
                m.scheduled_time ? m.scheduled_time.slice(0, 5) : null,
              ].filter(Boolean).join(' · ')

              return (
                <div key={m.id} className="card">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-extrabold text-ink-900 text-sm">{teamLabel(m, 'team_a', t)} vs {teamLabel(m, 'team_b', t)}</p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-[11px] text-muted">
                        <span className={`font-extrabold ${m.ranked_intent ? 'text-lime-600' : 'text-muted'}`}>
                          {m.ranked_intent ? t('privatematches.badge_ranked_intent') : t('privatematches.badge_friendly')}
                        </span>
                        {scheduleLine && (
                          <span className="inline-flex items-center gap-1"><Calendar size={11} /> {scheduleLine}</span>
                        )}
                        {m.location && (
                          <span className="inline-flex items-center gap-1"><MapPin size={11} /> {m.location}</span>
                        )}
                      </div>
                    </div>
                    {m.is_creator && (
                      <button
                        type="button"
                        onClick={() => handleDelete(m.id)}
                        aria-label={t('privatematches.delete_game_aria')}
                        className="shrink-0 text-muted hover:text-danger"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>

                  <ParticipantStatusRow match={m} />
                  {needsMyResponse && (
                    <MyResponsePrompt match={m} onRespond={handleRespond} responding={respondingId === m.id} />
                  )}

                  {hasScore && !isEditingScore ? (
                    <>
                      <p className="text-sm text-muted mt-3">
                        {m.score_submitted_by_name
                          ? t('privatematches.result_label_by', { name: m.score_submitted_by_name, scoreA: m.score_a, scoreB: m.score_b })
                          : t('privatematches.result_label', { scoreA: m.score_a, scoreB: m.score_b })}
                        {!canConfirm
                          ? (m.score_submitted_by
                              ? t('privatematches.awaiting_opponent_confirmation')
                              : t('privatematches.resubmit_needed'))
                          : ''}
                      </p>
                      <button
                        type="button"
                        onClick={() => toggleEditScore(m)}
                        className="mt-1 text-xs font-extrabold text-ink-700 hover:text-ink-900"
                      >
                        {t('privatematches.edit_score')}
                      </button>
                    </>
                  ) : allFilled ? (
                    <div className="mt-3">
                      {(m.scoring_format || 'pontos_simples') === 'sets' ? (
                        <ScoreEntrySets
                          numSets={m.num_sets || 3}
                          onSave={(finalScore) => handleSubmitScore(m.id, finalScore)}
                          saving={submittingId === m.id}
                        />
                      ) : (
                        <ScoreEntrySimple
                          initial={scores[m.id]}
                          onSave={(finalScore) => handleSubmitScore(m.id, finalScore)}
                          saving={submittingId === m.id}
                        />
                      )}
                      {isEditingScore && (
                        <button
                          type="button"
                          onClick={() => toggleEditScore(m)}
                          className="mt-2 text-xs font-extrabold text-muted hover:text-ink-900"
                        >
                          {t('privatematches.cancel')}
                        </button>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted mt-3">{t('privatematches.score_needs_full_teams')}</p>
                  )}

                  {canConfirm && !isEditingScore && (
                    <PrimaryButton onClick={() => handleConfirm(m.id)} className="w-full mt-3">
                      {t('privatematches.confirm_score')}
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
        <h3 className="text-lg text-ink-900 mb-3">{t('privatematches.history')}</h3>
        {confirmed.length === 0 ? (
          <EmptyState
            icon={Trophy}
            title={t('privatematches.empty_title')}
            subtitle={t('privatematches.empty_subtitle')}
          />
        ) : (
          <div className="space-y-2.5">
            {confirmed.map((m) => (
              <div key={m.id} className="card flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-extrabold text-ink-900 text-sm truncate">{teamLabel(m, 'team_a', t)} vs {teamLabel(m, 'team_b', t)}</p>
                  <p className="text-[11px] text-muted mt-0.5">
                    {m.my_points != null
                      ? t('privatematches.history_score_points', { scoreA: m.score_a, scoreB: m.score_b, points: m.my_points })
                      : t('privatematches.history_score_friendly', { scoreA: m.score_a, scoreB: m.score_b })}
                  </p>
                </div>
                {m.my_rating_delta != null && (
                  <span className={`shrink-0 text-sm font-extrabold tabular-nums ${m.my_rating_delta >= 0 ? 'text-ok' : 'text-danger'}`}>
                    {m.my_rating_delta >= 0 ? '+' : ''}{Math.round(m.my_rating_delta)} {t('privatematches.ranking_unit')}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
