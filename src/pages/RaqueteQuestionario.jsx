import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Check, ChevronLeft } from 'lucide-react'
import { PrimaryButton, EmptyState } from '../components/ui'
import { QUESTIONS, toggleAnswer, isAnswered, requestPick } from '../lib/raquete'

/* «Escolhe a tua raquete»: as 11 perguntas, uma por ecrã (spec
   docs/superpowers/specs/2026-10-27-escolher-raquete-design.md, mockup v2 ecrã 2).
   As respostas vivem só aqui: «‹» volta atrás sem as perder, sair a meio não
   grava nada. No fim pede a recomendação; um erro deixa tentar outra vez com
   as mesmas respostas. */
export default function RaqueteQuestionario() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState({})
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const q = QUESTIONS[step]
  const last = step === QUESTIONS.length - 1
  const chosen = (opt) => (q.multi ? (answers[q.key] ?? []).includes(opt) : answers[q.key] === opt)

  const send = async (a = answers) => {
    setSending(true)
    setError('')
    const res = await requestPick(a, i18n.language)
    if (res?.error || !res?.picks) {
      setError(res?.error || 'generic')
      setSending(false)
      return
    }
    navigate('/perfil/raquete', { replace: true })
  }

  const next = () => (last ? send() : setStep(step + 1))
  // «Saltar» na última: segue sem as marcas nem a raquete atual.
  const skip = () => {
    const { [q.key]: _drop, current_racket: _cur, ...rest } = answers
    setAnswers(rest)
    if (last) send(rest)
    else setStep(step + 1)
  }
  const back = () => (step === 0 ? navigate(-1) : setStep(step - 1))

  if (sending) {
    return (
      <div className="pt-10">
        <EmptyState pose="a-pensar" title={t('raquete.thinking_title')} subtitle={t('raquete.thinking_body')} />
      </div>
    )
  }

  if (error) {
    const known = ['daily_limit', 'no_candidates', 'catalog_empty', 'ai_unavailable', 'ai_failed', 'network'].includes(error)
    return (
      <div className="space-y-3 pt-10" role="alert">
        <EmptyState pose="triste" title={t(known ? `raquete.err_${error}` : 'raquete.err_generic')} />
        {error === 'no_candidates' ? (
          <PrimaryButton variant="ghost" className="w-full" onClick={() => { setError(''); setStep(QUESTIONS.findIndex((x) => x.key === 'budget')) }}>
            {t('raquete.change_budget')}
          </PrimaryButton>
        ) : error !== 'daily_limit' && (
          <PrimaryButton variant="ghost" className="w-full" onClick={() => send()}>{t('raquete.retry')}</PrimaryButton>
        )}
      </div>
    )
  }

  return (
    <div className="-mx-4 -mt-6 flex min-h-[calc(var(--app-h,100dvh))] flex-col bg-white px-4 pb-6" style={{ paddingTop: 'calc(var(--safe-top, env(safe-area-inset-top)) + 12px)' }}>
      <div className="flex items-center justify-between">
        <button type="button" onClick={back} aria-label={t('common.back')} className="flex h-11 w-11 items-center justify-center rounded-full text-ink-900">
          <ChevronLeft size={24} />
        </button>
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
          {t('raquete.step', { n: step + 1, total: QUESTIONS.length })}
        </span>
      </div>
      <div className="mb-5 mt-2 h-[5px] overflow-hidden rounded-full bg-line" aria-hidden>
        <div className="h-full bg-ink-900 transition-all duration-fast" style={{ width: `${((step + 1) / QUESTIONS.length) * 100}%` }} />
      </div>

      <h1 className="font-display text-[26px] font-extrabold leading-tight text-ink-900">{t(`raquete.q_${q.key}`)}</h1>
      <p className="mb-4 mt-1 text-sm text-muted">{t(q.multi ? 'raquete.pick_many' : 'raquete.pick_one')}</p>

      <div className="space-y-2" role={q.multi ? 'group' : 'radiogroup'}>
        {q.options.map((opt) => {
          const on = chosen(opt)
          return (
            <button
              key={opt}
              type="button"
              role={q.multi ? 'checkbox' : 'radio'}
              aria-checked={on}
              onClick={() => setAnswers((a) => toggleAnswer(a, q, opt))}
              className={`flex min-h-[48px] w-full items-center justify-between gap-3 rounded-ctrl bg-white px-4 py-3 text-left text-[15px] font-extrabold text-ink-900 transition-colors duration-fast ${on ? 'border-2 border-ink-900' : 'border border-line'}`}
            >
              {t(`raquete.opt_${q.key}_${opt}`)}
              {on && <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-ink-900 text-lime-400"><Check size={14} strokeWidth={3} /></span>}
            </button>
          )
        })}
      </div>

      {q.text && (
        <label className="mt-5 block">
          <span className="mb-2 block text-sm font-extrabold text-ink-900">{t('raquete.current_label')}</span>
          <textarea
            value={answers.current_racket ?? ''}
            onChange={(e) => setAnswers((a) => ({ ...a, current_racket: e.target.value.slice(0, 300) }))}
            placeholder={t('raquete.current_placeholder')}
            rows={2}
            className="w-full rounded-ctrl border border-line bg-white px-4 py-3 text-base text-ink-900"
          />
        </label>
      )}

      <div className="sticky bottom-0 mt-auto space-y-2 bg-white pt-6" style={{ paddingBottom: 'var(--nav-bottom, 1rem)' }}>
        <PrimaryButton className="w-full" onClick={next} disabled={!isAnswered(answers, q)}>
          {last ? t('raquete.see') : t('raquete.next')}
        </PrimaryButton>
        {q.optional && (
          <button type="button" onClick={skip} className="block w-full py-2 text-center text-sm font-extrabold text-ink-900 underline">
            {t('raquete.skip')}
          </button>
        )}
      </div>
    </div>
  )
}
