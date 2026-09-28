import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useGoBack } from '../lib/useGoBack'
import { useTranslation } from 'react-i18next'
import { BackBar } from '../components/ui'
import { ArrowLeft, Plus, Trophy, Copy, Check, Trash2, Calendar, MapPin } from 'lucide-react'
import {
  getMyPrivateMatches, listMyFriendSessions, submitPrivateMatchScore, confirmPrivateMatch, deletePrivateMatch, respondToPrivateMatch, privateMatchCanConfirm } from '../lib/privateMatches'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { groupFriendGames, friendGameFacts, beforeStart } from '../lib/friendGames'
import { dayText } from '../components/friends/dayText'
import { loadSetsByGame } from '../lib/friendMatchDelete'
import FriendGameRow from '../components/friends/FriendGameRow'
import { PrimaryButton, EmptyState } from '../components/ui'
import { formatDate } from '../lib/formatDate'
import { describeError } from '../lib/errors'
import FriendSessionsList from '../components/friends/FriendSessionsList'
import { ScoreEntrySimple, ScoreEntrySets } from '../components/friends/FriendScoreEntry'

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

const teamLabel = (m, prefix, t) => {
  const p1 = slotName(m, `${prefix}_player1`)
  const p2 = slotName(m, `${prefix}_player2`)
  return [p1, p2].filter(Boolean).join(' + ') || t('privatematches.to_be_invited')
}

export default function PrivateMatches() {
  const goBack = useGoBack('/perfil')
  const { t, i18n } = useTranslation()
  const { profile } = useAuth()
  const [matches, setMatches] = useState([])
  // Jogos ainda sem equipas (list_my_friend_sessions) e os sets de cada
  // jogo, para o cartão dizer «6-4 6-3».
  const [noTeams, setNoTeams] = useState([])
  const [setsById, setSetsById] = useState({})
  const [loading, setLoading] = useState(true)
  // Pending matches whose already-submitted score is being corrected.
  const [editingScoreIds, setEditingScoreIds] = useState(new Set())
  // { [matchId]: { a, b } } — only used by ScoreEntry's pontos_simples/
  // pro_set_9 branch; the sets branch keeps its own internal state.
  const [scores, setScores] = useState({})
  const [submittingId, setSubmittingId] = useState(null)
  const [respondingId, setRespondingId] = useState(null)

  const toggleEditScore = async (match) => {
    if (editingScoreIds.has(match.id)) {
      setEditingScoreIds((prev) => {
        const next = new Set(prev)
        next.delete(match.id)
        return next
      })
      return
    }
    // Prefill from the stored score so opening "corrigir" doesn't start
    // from a blank pair. Nos sets, os sets gravados: sem isto o «Editar
    // resultado» abria vazio e parecia que o resultado tinha ido a zero
    // (Francisco, 28 set — o 0-2 eram os sets ganhos, 6-7 e 2-6).
    let sets = null
    if ((match.scoring_format || 'pontos_simples') === 'sets') {
      const { data } = await supabase
        .from('private_match_sets')
        .select('set_number, score_a, score_b')
        .eq('private_match_id', match.id)
        .order('set_number')
      sets = (data || []).map((s) => ({ a: String(s.score_a), b: String(s.score_b) }))
    }
    setScores((prevScores) => ({ ...prevScores, [match.id]: { a: String(match.score_a ?? ''), b: String(match.score_b ?? ''), sets } }))
    setEditingScoreIds((prev) => new Set(prev).add(match.id))
  }

  const load = useCallback(async () => {
    try {
      const [data, sessions] = await Promise.all([getMyPrivateMatches(), listMyFriendSessions().catch(() => [])])
      setMatches(data)
      setNoTeams(sessions)
      loadSetsByGame(data.filter((m) => m.score_a != null).map((m) => m.id))
        .then(setSetsById)
        .catch((error) => console.error('Error loading sets:', error))
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
      alert(describeError(t, error, 'privatematches.error_submit_score'))
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
      alert(describeError(t, error, 'privatematches.error_confirm'))
    }
  }

  const handleRespond = async (matchId, response) => {
    setRespondingId(matchId)
    try {
      await respondToPrivateMatch(matchId, response)
      await load()
    } catch (error) {
      console.error('Error responding to private match:', error)
      alert(describeError(t, error, 'privatematches.error_respond'))
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
      alert(describeError(t, error, 'privatematches.error_delete'))
    }
  }

  // Um cartão por jogo entre amigos (REGRAS.md ponto 1, Francisco, 28 set):
  // os do desenho novo (têm session_id) abrem no ecrã deles, com editar,
  // rondas e sets. O cartão de sempre, com o resultado aqui dentro, fica só
  // para os jogos soltos antigos por confirmar. Quem criou tem o «⋯»:
  // cancelar ou apagar (2026-09-28-amigos-apagar-da-lista).
  const groups = groupFriendGames(matches.filter((m) => m.session_id || m.status === 'confirmed'))
    .map((g) => ({ ...g, facts: friendGameFacts(g, setsById) }))
  // «A seguir» é só o que ainda não aconteceu ou está a decorrer (hoje);
  // acabado, ou de um dia que já passou, vai para o Histórico (UX, 28 set).
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const isPast = (g) => g.facts.finished || Boolean(g.facts.date && g.facts.date < today)
  const upcoming = groups.filter((g) => !isPast(g))
    .sort((a, b) => `${a.facts.date}${a.facts.time}`.localeCompare(`${b.facts.date}${b.facts.time}`))
  const finishedGroups = groups.filter(isPast)
  const pending = matches.filter((m) => m.status === 'pending' && !m.session_id)
  const reload = () => { load() }
  const noTeamsLine = (s) => (s.pending > 0
    ? t('friends.waiting_answers', { count: s.pending })
    : s.is_creator ? t('friends.form_teams_now') : t('friends.waiting_teams'))

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <BackBar onBack={goBack} label={t('privatematches.back')} title={t('privatematches.title')} />

      <div className="flex items-center justify-between">
        <h2 className="text-3xl text-ink-900">{t('privatematches.title')}</h2>
        <Link to="/jogos-privados/novo">
          <PrimaryButton>
            <Plus size={18} /> {t('privatematches.new_button')}
          </PrimaryButton>
        </Link>
      </div>

      {/* Convites por responder (#342). */}
      <FriendSessionsList sessions={false} />

      {(noTeams.length > 0 || upcoming.length > 0) && (
        <div>
          <h3 className="text-lg text-ink-900 mb-3">{t('friends.upcoming')}</h3>
          <div className="space-y-2.5">
            {noTeams.map((s) => (
              <FriendGameRow key={`nt-${s.match_id}`} id={s.match_id} to={`/jogos-privados/sessao/${s.match_id}`}
                facts={{ date: s.scheduled_date, time: s.scheduled_time ? String(s.scheduled_time).slice(0, 5) : null, location: s.location, isCreator: s.is_creator, hasResults: false, results: [], people: s.people }}
                line={noTeamsLine(s)} pending={s.pending} creatorName={profile?.name || ''} onChanged={reload} />
            ))}
            {upcoming.map((g) => (
              <FriendGameRow key={g.id} id={g.id} to={g.isSession ? `/jogos-privados/sessao/${g.id}` : null} facts={g.facts}
                line={g.facts.ranked ? t('agenda.friends_ranked') : t('gamedetails.badge_friendly')}
                creatorName={profile?.name || ''} onChanged={reload} />
            ))}
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <div>
          <h3 className="text-lg text-ink-900 mb-3">{t('privatematches.pending_confirmation')}</h3>
          <div className="space-y-3">
            {pending.map((m) => {
              const hasScore = m.score_a !== null && m.score_b !== null
              const isEditingScore = editingScoreIds.has(m.id)
              const allFilled = isSlotFilled(m, 'team_a_player2') && isSlotFilled(m, 'team_b_player1') && isSlotFilled(m, 'team_b_player2')
              // Confirmação cruzada (só a equipa que não submeteu confirma,
              // salvo quando a adversária é só convidados) — a regra vive em
              // privateMatchCanConfirm, a mesma que o sino usa.
              const canConfirm = privateMatchCanConfirm(m, profile?.id)

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
                  ) : beforeStart(m.scheduled_date, m.scheduled_time) ? (
                    // Antes da hora do jogo não se marca resultado (Francisco, 28 set).
                    <p className="text-sm text-muted mt-3">{t('friends.results_from', {
                      time: m.scheduled_time ? m.scheduled_time.slice(0, 5) : '00:00',
                      day: dayText(m.scheduled_date, i18n.language).toLocaleLowerCase(i18n.language),
                    })}</p>
                  ) : allFilled ? (
                    <div className="mt-3">
                      {(m.scoring_format || 'pontos_simples') === 'sets' ? (
                        <ScoreEntrySets
                          numSets={m.num_sets || 3}
                          initial={scores[m.id]?.sets}
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
        {finishedGroups.length === 0 ? (
          <EmptyState
            icon={Trophy}
            title={t('privatematches.empty_title')}
            subtitle={t('privatematches.empty_subtitle')}
          />
        ) : (
          <div className="space-y-2.5">
            {finishedGroups.map((g) => (
              <FriendGameRow key={g.id} id={g.id} to={g.isSession ? `/jogos-privados/sessao/${g.id}` : null} facts={g.facts}
                creatorName={profile?.name || ''} onChanged={reload} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
