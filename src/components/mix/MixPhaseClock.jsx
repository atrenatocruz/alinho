// O cronómetro do aquecimento e da troca entre rondas (#768, SPEC design-
// handoff/2026-10-26-mix-aquecimento-e-troca, pontos 3 a 5). Fica no cartão
// da ronda, no sítio do relógio da ronda.
//
//   phase    — 'aquecimento' | 'troca' | 'pronto' (quem organiza, antes de
//              começar o aquecimento: mostra os minutos todos)
//   endsAt   — quando acaba a fase (ms); em 'pronto', não conta
//   minutes  — os minutos do aquecimento, em 'pronto'
//   nextLine — «A seguir: ronda 1, campo 2, com a Ana L.» (ou null)
//   onAdjust — o ± de quem organiza (recebe -1 ou +1); sem ele, não aparece
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const clock = (msLeft) => {
  const s = Math.max(0, Math.ceil(msLeft / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function MixPhaseClock({ phase, endsAt, minutes, nextLine = null, onAdjust }) {
  const { t } = useTranslation()
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (phase === 'pronto') return undefined
    const i = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(i)
  }, [phase])

  const label = phase === 'troca' ? t('mixclock.changeover_left')
    : phase === 'aquecimento' ? t('mixclock.warmup_left')
      : t('mixclock.warmup')
  const time = phase === 'pronto' ? clock((minutes || 0) * 60000) : clock((endsAt || 0) - now)
  const line = phase === 'pronto' ? t('mixclock.then_round1') : nextLine

  return (
    <div role="timer" aria-live="off" className="rounded-[16px] bg-ink-900 px-4 py-4 text-center text-white">
      <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-[#C5DD01]">{label}</p>
      <p className="mt-1 text-[44px] font-extrabold leading-none tabular-nums">{time}</p>
      {line && <p className="mt-2 text-sm leading-snug text-white/80">{line}</p>}
      {onAdjust && phase !== 'pronto' && (
        <div className="mt-3 flex items-center justify-center gap-2">
          {[-1, 1].map((d) => (
            <button key={d} type="button" onClick={() => onAdjust(d)}
              className="min-h-[36px] rounded-full border border-white/30 px-3.5 text-[13px] font-extrabold text-white">
              {t(d < 0 ? 'mixclock.minus_minute' : 'mixclock.plus_minute')}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
