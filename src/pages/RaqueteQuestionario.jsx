import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Check, ChevronLeft, Sparkles } from 'lucide-react'
import { PrimaryButton, EmptyState } from '../components/ui'
import RacketShape from '../components/raquete/RacketShape'
import RaqueteAProcurar from '../components/raquete/RaqueteAProcurar'
import { QUESTIONS, toggleAnswer, isAnswered, requestPick } from '../lib/raquete'

/* «Escolhe a tua raquete»: as 11 perguntas, uma por ecrã (spec
   docs/superpowers/specs/2026-10-27-escolher-raquete-design.md, mockup v2 ecrã 2).
   As respostas vivem só aqui: «‹» volta atrás sem as perder, sair a meio não
   grava nada. No fim pede a recomendação; um erro deixa tentar outra vez com
   as mesmas respostas.
   Sem a barra de baixo da app, como nas páginas por passos (data-steps no body,
   src/index.css): o «Seguinte» ficava por baixo do menu (Renato, 27 out). O topo
   (‹, «N de 11», progresso) e o botão ficam presos ao deslizar. */
export default function RaqueteQuestionario() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState({})
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    document.body.dataset.steps = '1'
    return () => { delete document.body.dataset.steps }
  }, [])
  // Cada pergunta abre no topo. Quem desliza é o <main> da app, não a janela.
  useEffect(() => {
    document.querySelector('main')?.scrollTo?.({ top: 0 })
  }, [step])

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

  if (sending) return <RaqueteAProcurar />

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
        {/* Sem o menu de baixo, a saída tem de estar aqui. */}
        <button type="button" onClick={() => navigate('/perfil')} className="block w-full py-2 text-center text-sm font-extrabold text-ink-900 underline">
          {t('raquete.back_profile')}
        </button>
      </div>
    )
  }

  return (
    <div className="-mx-4 -mt-6 flex min-h-[calc(100dvh-24px)] flex-col bg-white px-4">
      <div className="sticky top-0 z-10 -mx-4 bg-white px-4 pb-4" style={{ paddingTop: 'calc(var(--safe-top, env(safe-area-inset-top)) + 8px)' }}>
        <div className="flex items-center justify-between">
          <button type="button" onClick={back} aria-label={t('common.back')} className="-ml-2 flex h-11 w-11 items-center justify-center rounded-full text-ink-900 active:bg-ink-50">
            <ChevronLeft size={24} />
          </button>
          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
            {t('raquete.step', { n: step + 1, total: QUESTIONS.length })}
          </span>
        </div>
        <div className="mt-2 h-[5px] overflow-hidden rounded-full bg-line" aria-hidden>
          <div className="h-full rounded-full bg-ink-900 transition-all duration-300" style={{ width: `${((step + 1) / QUESTIONS.length) * 100}%` }} />
        </div>
      </div>

      <div key={step} className="animate-fade-in">
        <h1 className="mt-2 font-display text-[26px] font-extrabold leading-tight text-ink-900">{t(`raquete.q_${q.key}`)}</h1>
        <p className="mb-5 mt-1 text-sm text-muted">{t(q.multi ? 'raquete.pick_many' : 'raquete.pick_one')}</p>

        <div className="space-y-2.5" role={q.multi ? 'group' : 'radiogroup'}>
          {q.options.map((opt) => {
            const on = chosen(opt)
            const shapeTile = q.key === 'shape'
            return (
              <button
                key={opt}
                type="button"
                role={q.multi ? 'checkbox' : 'radio'}
                aria-checked={on}
                onClick={() => setAnswers((a) => toggleAnswer(a, q, opt))}
                className={`flex w-full items-center gap-3 rounded-ctrl bg-white px-4 text-left text-[15px] font-extrabold text-ink-900 transition-colors duration-fast active:scale-[0.99] ${shapeTile ? 'min-h-[72px] py-2.5' : 'min-h-[52px] py-3'} ${on ? 'border-2 border-ink-900 bg-lime-100/40' : 'border border-line'}`}
              >
                {shapeTile && (
                  <span className={`flex h-14 w-11 shrink-0 items-center justify-center rounded-lg ${on ? 'text-ink-900' : 'text-ink-500'}`}>
                    {opt === 'recomenda' ? <Sparkles size={22} /> : <RacketShape shape={opt} className="h-12 w-8" />}
                  </span>
                )}
                <span className="min-w-0 flex-1">{t(`raquete.opt_${q.key}_${opt}`)}</span>
                <span className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full ${on ? 'bg-ink-900 text-lime-400' : 'border-[1.5px] border-line'}`}>
                  {on && <Check size={14} strokeWidth={3} />}
                </span>
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
      </div>

      {/* A faixa do botão, presa em baixo acima da margem segura do iPhone, com
          um degradê por cima para as opções não acabarem cortadas a seco. */}
      <div className="sticky bottom-0 z-10 -mx-4 mt-auto bg-white px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3">
        <div className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-gradient-to-t from-white to-white/0" aria-hidden="true" />
        <PrimaryButton className="w-full" onClick={next} disabled={!isAnswered(answers, q)}>
          {last ? t('raquete.see') : t('raquete.next')}
        </PrimaryButton>
        {q.optional && (
          <button type="button" onClick={skip} className="mt-1 block w-full py-2.5 text-center text-sm font-extrabold text-ink-900 underline">
            {t('raquete.skip')}
          </button>
        )}
      </div>
    </div>
  )
}
