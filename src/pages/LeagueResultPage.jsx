// Enviar o resultado por passos, uma partida por passo (mockup «Submeter
// resultado»): o botão lima preso em baixo (PrimaryButton do StepPage),
// «‹» como texto junto ao título do passo (BackBar do StepPage).
import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import StepPage from '../components/steps/StepPage'
import { ConfirmSheet, EmptyState, LoadErrorState } from '../components/ui'
import { getLeagueEncounter, submitResult, resolveEncounter, leagueErrorMessage } from '../lib/leagueApi'
import { emptyDraft, draftFromMatches, draftToMatches, draftProblem } from '../lib/leagueResultDraft'

function PlayerSelect({ value, options, onChange, label }) {
  return (
    <select aria-label={label} value={value || ''} onChange={(e) => onChange(e.target.value || null)}
      className="min-h-[48px] w-full rounded-ctrl border border-line bg-white px-3 text-base font-bold">
      <option value="">—</option>
      {options.map((o) => <option key={o.user_id} value={o.user_id}>{o.name}</option>)}
    </select>
  )
}

export default function LeagueResultPage() {
  const { slug, id } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  // ?resolver=1: quem organiza (e não fala por nenhum dos clubes) decide o resultado em vez de o enviar.
  const resolver = useSearchParams()[0].get('resolver') === '1'
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')
  // data: undefined = a carregar · null = não existe / sem permissão · objeto.
  const [data, setData] = useState(undefined)
  const [loadError, setLoadError] = useState(false)
  const [draft, setDraft] = useState([])
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = (isCancelled = () => false) => getLeagueEncounter(id).then((d) => {
    if (isCancelled()) return
    setLoadError(false)
    setData(d || null)
    if (d) setDraft(resolver ? draftFromMatches(d.matches, d.category.matches_per_encounter) : emptyDraft(d.category.matches_per_encounter))
  }).catch(() => { if (!isCancelled()) setLoadError(true) })
  useEffect(() => {
    let cancelled = false
    setData(undefined); setLoadError(false); setStep(0); setError('')
    load(() => cancelled)
    return () => { cancelled = true }
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loadError) {
    return <LoadErrorState title={t('app.load_error_title')} subtitle={t('app.load_error_body')}
      onRetry={() => { setLoadError(false); setData(undefined); load() }} />
  }
  if (data === undefined) return null
  const allowed = resolver ? data?.viewer?.can_manage && data.viewer.side == null : data?.viewer?.can_submit
  if (data === null || !allowed || !data.rosters) {
    return <EmptyState title={t('league.not_found_title')} subtitle={t('league.not_found_text')} />
  }
  if (!draft.length) return null

  const total = draft.length
  const m = draft[step]
  const set = (patch) => setDraft((d) => d.map((x, i) => (i === step ? { ...x, ...patch } : x)))
  const setScore = (si, col, v) => set({ sets: m.sets.map((s, i) => (i === si ? s.map((x, c) => (c === col ? (v === '' ? null : Number(v)) : x)) : s)) })
  const last = step === total - 1
  const problem = last ? draftProblem(draft, data.category, data.rosters) : null

  const next = async () => {
    if (!last) { setStep(step + 1); return }
    if (resolver) { setNoteOpen(true); return }
    setBusy(true); setError('')
    try { await submitResult(id, draftToMatches(draft)); navigate(`/liga/${slug}/encontro/${id}`, { replace: true }) }
    catch (e) { setError(leagueErrorMessage(t, e)) } finally { setBusy(false) }
  }

  return (
    <StepPage
      title={t('league.match_n', { n: step + 1, total })}
      subtitle={`${data.home.name} vs ${data.away.name}`}
      step={step + 1} total={total}
      stepLabel={data.category.matches_per_encounter > 1 ? t('league.match_n', { n: step + 1, total }) : undefined}
      onBack={step > 0 ? () => setStep(step - 1) : () => navigate(-1)}
      onNext={next} nextLabel={last ? t(resolver ? 'league.decide_result' : 'league.send_for_confirmation') : t('league.next_match')}
      nextDisabled={!!problem} nextHint={problem ? t(`league.error_${problem}`) : null}
      error={error} busy={busy}
    >
      {['home', 'away'].map((side) => (
        <div key={side} className="mb-4 space-y-2">
          <p className="font-mono text-[10.5px] uppercase tracking-[.08em] text-ink-500">{data[side].name}</p>
          <div className="grid grid-cols-2 gap-2">
            {[0, 1].map((k) => (
              <PlayerSelect key={k} label={`${data[side].name} ${k + 1}`} value={m[side][k]} options={data.rosters[side]}
                onChange={(v) => set({ [side]: m[side].map((x, i) => (i === k ? v : x)) })} />
            ))}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_48px_48px_48px] items-center gap-2">
            <span className="text-[13px] text-ink-500">{t('league.sets')}</span>
            {[0, 1, 2].map((si) => (
              <input key={si} inputMode="numeric" aria-label={`${data[side].name} set ${si + 1}`}
                value={m.sets[si][side === 'home' ? 0 : 1] ?? ''} onChange={(e) => setScore(si, side === 'home' ? 0 : 1, e.target.value.replace(/\D/g, ''))}
                className="h-12 w-12 rounded-ctrl border border-line bg-white text-center font-display text-lg font-extrabold" />
            ))}
          </div>
        </div>
      ))}
      <ConfirmSheet open={noteOpen} title={t('league.decide_title')} message={t('league.decide_message')}
        confirmLabel={t('league.decide_result')} cancelLabel={t('league.not_yet')} confirmDisabled={note.trim().length < 3}
        onClose={() => setNoteOpen(false)} errorOf={(err) => leagueErrorMessage(t, err)}
        onConfirm={async () => { await resolveEncounter(id, draftToMatches(draft), null, note.trim()); navigate(`/liga/${slug}/encontro/${id}`, { replace: true }) }}>
        <label className="mt-3 block text-sm font-bold">{t('league.decide_note')}
          <textarea value={note} onChange={(ev) => setNote(ev.target.value)} maxLength={500} rows={3}
            className="mt-1.5 w-full rounded-ctrl border border-line bg-white p-3 text-base" />
        </label>
      </ConfirmSheet>
    </StepPage>
  )
}
