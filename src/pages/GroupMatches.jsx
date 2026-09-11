import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Plus, MapPin, Clock, Trash2 } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { getClubProfile } from '../lib/clubProfile'
import {
  getGroupMatches, claimGroupMatchSlot, leaveGroupMatchSlot,
  submitGroupMatchResult, proposeGroupMatchCorrection, acceptGroupMatchCorrection, deleteGroupMatch,
} from '../lib/groupMatches'
import { formatDate as formatDateLib } from '../lib/formatDate'
import { Avatar, EmptyState, PrimaryButton } from '../components/ui'

const SLOTS = ['team_a_player1', 'team_a_player2', 'team_b_player1', 'team_b_player2']

/* Inline "insert/correct result" form — shared shape for both the first
   submission and a proposed correction, only the submit handler differs. */
function ScoreForm({ initialA, initialB, onSubmit, onCancel, submitLabel, t }) {
  const [scoreA, setScoreA] = useState(initialA ?? '')
  const [scoreB, setScoreB] = useState(initialB ?? '')
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    const a = parseInt(scoreA, 10)
    const b = parseInt(scoreB, 10)
    if (Number.isNaN(a) || Number.isNaN(b) || a === b || a < 0 || b < 0) {
      setError(t('groupmatches.validate_score'))
      return
    }
    setError('')
    await onSubmit(a, b)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2.5 pt-2">
      <div className="flex items-center gap-2.5">
        <div className="flex-1">
          <label className="block text-[11px] text-muted mb-1">{t('groupmatches.score_a_label')}</label>
          <input type="number" value={scoreA} onChange={(e) => setScoreA(e.target.value)} className="input-field text-center" />
        </div>
        <span className="text-muted font-extrabold mt-4">{t('groupmatches.vs_label')}</span>
        <div className="flex-1">
          <label className="block text-[11px] text-muted mb-1">{t('groupmatches.score_b_label')}</label>
          <input type="number" value={scoreB} onChange={(e) => setScoreB(e.target.value)} className="input-field text-center" />
        </div>
      </div>
      {error && <p className="text-danger text-xs font-extrabold">{error}</p>}
      <div className="flex gap-2">
        <PrimaryButton type="submit" className="flex-1">{submitLabel}</PrimaryButton>
        {onCancel && <PrimaryButton type="button" variant="ghost" onClick={onCancel} className="flex-1">{t('gerir.cancel')}</PrimaryButton>}
      </div>
    </form>
  )
}

function MatchCard({ match, org, currentUser, isOrgAdmin, onChanged, t, i18n }) {
  const [enteringResult, setEnteringResult] = useState(false)
  const [correcting, setCorrecting] = useState(false)
  const [busy, setBusy] = useState(false)

  const mySlot = SLOTS.find((s) => match[`${s}_id`] === currentUser?.id)
  const isParticipant = !!mySlot
  const isCreator = match.created_by === currentUser?.id
  const filledCount = SLOTS.filter((s) => match[`${s}_id`]).length
  const hasResult = !!match.locked_at
  const hasPendingCorrection = !!match.pending_correction_proposed_by
  const alreadyAcceptedCorrection = (match.pending_correction_accepted_by || []).includes(currentUser?.id)

  const withBusy = (fn) => async (...args) => {
    setBusy(true)
    try {
      await fn(...args)
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  const handleJoin = withBusy(async (slot) => {
    try {
      await claimGroupMatchSlot(match.id, slot)
    } catch (err) {
      alert(t('groupmatches.error_join') + (err.message || ''))
    }
  })

  const handleLeave = withBusy(async () => {
    if (!confirm(t('groupmatches.confirm_leave'))) return
    try {
      await leaveGroupMatchSlot(match.id)
    } catch (err) {
      alert(t('groupmatches.error_leave') + (err.message || ''))
    }
  })

  const handleSubmitResult = async (a, b) => {
    setBusy(true)
    try {
      await submitGroupMatchResult(match.id, a, b)
      setEnteringResult(false)
      await onChanged()
    } catch (err) {
      alert(t('groupmatches.error_result') + (err.message || ''))
    } finally {
      setBusy(false)
    }
  }

  const handleProposeCorrection = async (a, b) => {
    setBusy(true)
    try {
      await proposeGroupMatchCorrection(match.id, a, b)
      setCorrecting(false)
      await onChanged()
    } catch (err) {
      alert(t('groupmatches.error_correction') + (err.message || ''))
    } finally {
      setBusy(false)
    }
  }

  const handleAcceptCorrection = withBusy(async () => {
    try {
      await acceptGroupMatchCorrection(match.id)
    } catch (err) {
      alert(t('groupmatches.error_accept_correction') + (err.message || ''))
    }
  })

  const handleDelete = withBusy(async () => {
    if (!confirm(t('groupmatches.confirm_delete'))) return
    try {
      await deleteGroupMatch(match.id)
    } catch (err) {
      alert(t('groupmatches.error_delete') + (err.message || ''))
    }
  })

  const canDelete = isCreator || isOrgAdmin
  const canCorrect = isParticipant || isOrgAdmin
  const acceptedCount = (match.pending_correction_accepted_by || []).length

  return (
    <div className="card space-y-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-extrabold text-ink-900">
              {formatDateLib(match.scheduled_date + 'T00:00:00', i18n.language, { day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
            {match.scheduled_time && (
              <span className="inline-flex items-center gap-1 text-muted text-xs"><Clock size={12} /> {match.scheduled_time.slice(0, 5)}</span>
            )}
            <span className={`text-[11px] font-extrabold px-2 py-0.5 rounded-full ${match.ranked ? 'bg-lime-400/20 text-ink-900' : 'bg-ink-50 text-muted'}`}>
              {t(match.ranked ? 'groupmatches.badge_ranked' : 'groupmatches.badge_friendly')}
            </span>
          </div>
          {match.location && (
            <p className="text-muted text-xs mt-1 flex items-center gap-1"><MapPin size={12} /> {match.location}</p>
          )}
        </div>
        {canDelete && (
          <button type="button" onClick={handleDelete} disabled={busy} className="text-muted hover:text-danger transition-colors duration-fast shrink-0">
            <Trash2 size={16} />
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {SLOTS.map((slot) => {
          const playerId = match[`${slot}_id`]
          const isMe = playerId === currentUser?.id
          if (playerId) {
            return (
              <div key={slot} className="flex items-center gap-2 p-2 rounded-ctrl border border-line">
                <Avatar name={match[`${slot}_name`]} url={match[`${slot}_avatar`]} size="w-7 h-7 text-[11px]" />
                <span className="text-xs font-extrabold text-ink-900 truncate flex-1">{match[`${slot}_name`]}</span>
                {isMe && !hasResult && slot !== 'team_a_player1' && (
                  <button type="button" onClick={handleLeave} disabled={busy} className="text-[11px] text-danger font-extrabold shrink-0">
                    {t('groupmatches.leave_button')}
                  </button>
                )}
              </div>
            )
          }
          return (
            <button
              key={slot}
              type="button"
              disabled={busy || hasResult || isParticipant}
              onClick={() => handleJoin(slot)}
              className="flex items-center justify-center gap-1.5 p-2 rounded-ctrl border border-dashed border-line text-muted text-xs font-extrabold hover:border-ink-700 hover:text-ink-900 transition-colors duration-fast disabled:opacity-50"
            >
              {isParticipant ? t('groupmatches.slot_open') : t('groupmatches.join_button')}
            </button>
          )
        })}
      </div>

      {!hasResult && filledCount === 4 && (isParticipant || isOrgAdmin) && (
        enteringResult ? (
          <ScoreForm t={t} onCancel={() => setEnteringResult(false)} submitLabel={t('groupmatches.submit_result_button')} onSubmit={handleSubmitResult} />
        ) : (
          <PrimaryButton type="button" variant="ghost" onClick={() => setEnteringResult(true)} className="w-full">
            {t('groupmatches.enter_result_button')}
          </PrimaryButton>
        )
      )}

      {hasResult && (
        <div className="pt-2 border-t border-line space-y-2">
          <p className="text-center text-2xl font-extrabold text-ink-900 tabular-nums">{match.score_a} – {match.score_b}</p>

          {hasPendingCorrection ? (
            <div className="bg-ink-50 rounded-ctrl p-3 space-y-2">
              <p className="text-xs font-extrabold text-ink-900">
                {t('groupmatches.correction_pending', { a: match.pending_correction_score_a, b: match.pending_correction_score_b })}
              </p>
              {isParticipant && !alreadyAcceptedCorrection && (
                <PrimaryButton type="button" onClick={handleAcceptCorrection} disabled={busy} className="w-full">
                  {t('groupmatches.correction_accept_button')}
                </PrimaryButton>
              )}
              {alreadyAcceptedCorrection && acceptedCount < 4 && (
                <p className="text-[11px] text-muted">{t('groupmatches.correction_waiting', { count: 4 - acceptedCount })}</p>
              )}
            </div>
          ) : canCorrect ? (
            correcting ? (
              <ScoreForm t={t} initialA={match.score_a} initialB={match.score_b} onCancel={() => setCorrecting(false)} submitLabel={t('groupmatches.propose_correction_button')} onSubmit={handleProposeCorrection} />
            ) : (
              <button type="button" onClick={() => setCorrecting(true)} className="text-xs font-extrabold text-ink-700 hover:underline">
                {t('groupmatches.propose_correction_button')}
              </button>
            )
          ) : null}
        </div>
      )}
    </div>
  )
}

export default function GroupMatches() {
  const { t, i18n } = useTranslation()
  const { slug } = useParams()
  const { profile: currentUser, memberships } = useAuth()
  const [org, setOrg] = useState(null)
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)

  const isOrgAdmin = !!memberships.find((m) => m.organization?.slug === slug)?.is_admin

  const load = useCallback(async () => {
    try {
      const clubData = await getClubProfile(slug)
      setOrg(clubData)
      if (clubData?.id) {
        const data = await getGroupMatches(clubData.id)
        setMatches(data)
      }
    } catch (err) {
      console.error('Error loading group matches:', err)
      alert(t('groupmatches.error_load') + (err.message || ''))
    } finally {
      setLoading(false)
    }
  }, [slug, t])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-5 max-w-lg mx-auto">
      <Link to={`/clube/${slug}`} className="inline-flex items-center gap-1.5 text-ink-700 font-extrabold text-sm hover:underline">
        <ArrowLeft size={16} /> {t('groupmatches.back_to_club', { name: org?.name || '' })}
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-3xl text-ink-900">{t('groupmatches.title')}</h2>
          {org && <p className="text-muted text-sm mt-0.5">{t('groupmatches.subtitle', { group: org.name })}</p>}
        </div>
        <Link to={`/clube/${slug}/jogos/novo`}>
          <PrimaryButton type="button"><Plus size={18} /> {t('groupmatches.create_button')}</PrimaryButton>
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
        </div>
      ) : matches.length === 0 ? (
        <EmptyState title={t('groupmatches.empty_title')} subtitle={t('groupmatches.empty_subtitle')} />
      ) : (
        <div className="space-y-3.5">
          {matches.map((match) => (
            <MatchCard key={match.id} match={match} org={org} currentUser={currentUser} isOrgAdmin={isOrgAdmin} onChanged={load} t={t} i18n={i18n} />
          ))}
        </div>
      )}
    </div>
  )
}
