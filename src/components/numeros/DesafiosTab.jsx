import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { goalProgress } from '../../lib/watchStats'
import { card, kicker, monthName, monthShort } from './shared'

// Separador «Desafios»: o objetivo de jogos por mês (anel, medalhas, sequência) e
// a pausa (lesão ou férias, até 90 dias sem perder a sequência). Guarda-se só neste
// telemóvel. `children` deixa a Fase C pôr o desafio com amigos por baixo.

const GOAL_KEY = 'alinho.numeros.goal'
const PAUSE_KEY = 'alinho.numeros.goalPausedAt'
const read = (k) => { try { return window.localStorage.getItem(k) } catch { return null } }
const write = (k, v) => {
  try { if (v == null) window.localStorage.removeItem(k); else window.localStorage.setItem(k, v) } catch { /* sem armazenamento: fica só nesta visita */ }
}

export default function DesafiosTab({ games, children }) {
  const { t, i18n } = useTranslation()
  const [goal, setGoal] = useState(() => Math.min(30, Math.max(1, Number(read(GOAL_KEY)) || 8)))
  const [pausedAt, setPausedAt] = useState(() => read(PAUSE_KEY))
  const now = new Date()
  const g = goalProgress(games, now, { goal, pausedAt })
  const C = 2 * Math.PI * 30
  const pct = Math.min(1, g.done / goal)

  const changeGoal = (d) => {
    const v = Math.min(30, Math.max(1, goal + d))
    setGoal(v)
    write(GOAL_KEY, String(v))
  }
  const togglePause = () => {
    const v = pausedAt ? null : now.toISOString()
    setPausedAt(v)
    write(PAUSE_KEY, v)
  }

  return (
    <div className="space-y-5">
      <section>
        <p className={kicker}>{t('numeros.goal_of', { month: monthName(now.getFullYear(), now.getMonth(), i18n.language) })}</p>
        <div className={card}>
          <div className="flex items-center gap-4">
            <svg width="72" height="72" viewBox="0 0 72 72" aria-hidden="true">
              <circle cx="36" cy="36" r="30" fill="none" stroke="#E5E7EB" strokeWidth="10" />
              <circle
                cx="36" cy="36" r="30" fill="none" stroke={pausedAt ? '#9CA3AF' : '#C5DD01'} strokeWidth="10" strokeLinecap="round"
                strokeDasharray={`${(pct * C).toFixed(1)} ${C.toFixed(1)}`} transform="rotate(-90 36 36)"
              />
            </svg>
            <div>
              <b className="font-display text-[22px] font-extrabold text-ink-900">{t('numeros.goal_count', { done: g.done, goal })}</b>
              <p className="text-[13px] text-muted">
                {pausedAt ? t('numeros.goal_paused') : g.met ? t('numeros.goal_met') : t('numeros.goal_left', { count: goal - g.done })}
              </p>
            </div>
          </div>
          <div className="mt-3 flex gap-1.5">
            {g.medals.map((m, i) => (
              <i
                key={`${m.year}-${m.month}`}
                className={`flex-1 rounded-full py-1 text-center text-[11px] not-italic ${m.met && i < g.medals.length - 1 ? 'bg-lime-400 font-extrabold text-ink-900' : 'bg-ink-50 text-muted'}`}
              >
                {monthShort(m.year, m.month, i18n.language)}
              </i>
            ))}
          </div>
          <p className="mt-2 text-sm font-extrabold text-ink-900">
            {g.streak ? t('numeros.streak', { count: g.streak }) : t('numeros.streak_none')}
          </p>
          <div className="mt-3 flex items-center justify-between">
            <button type="button" onClick={() => changeGoal(-1)} aria-label={t('numeros.goal_less')} className="h-10 w-10 rounded-full border border-line text-lg font-extrabold">−</button>
            <b className="text-ink-900">{t('numeros.goal_per_month', { count: goal })}</b>
            <button type="button" onClick={() => changeGoal(1)} aria-label={t('numeros.goal_more')} className="h-10 w-10 rounded-full border border-line text-lg font-extrabold">+</button>
          </div>
        </div>
      </section>

      <div className={`${card} flex items-center justify-between gap-3`}>
        <div>
          <b className="text-ink-900">{t('numeros.pause_title')}</b>
          <p className="text-[13px] text-muted">{t('numeros.pause_body')}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={!!pausedAt}
          aria-label={t('numeros.pause_title')}
          onClick={togglePause}
          className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${pausedAt ? 'bg-ink-900' : 'bg-ink-200'}`}
        >
          <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${pausedAt ? 'left-6' : 'left-1'}`} />
        </button>
      </div>

      {children}
    </div>
  )
}
