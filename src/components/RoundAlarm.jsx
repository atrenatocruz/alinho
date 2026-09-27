import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Chips } from './ui'
import {
  WARN_OPTIONS, loadAlarmPrefs, saveAlarmPrefs, unlockRoundAlarm,
  playRoundTrack, stopRoundTrack, playingRoundKey,
} from '../lib/roundAlarm'

/**
 * O alarme das rondas, por baixo do cronómetro (design-handoff/
 * 2026-09-27-alarmes-das-rondas). Peça partilhada: o mix usa-a e o jogo entre
 * amigos a rodar (Dev 2) também.
 *
 * - roundKey: muda a cada ronda que começa (ex. `${gameId}:${round_started_at}`);
 *   null quando não há ronda a decorrer (mix parado ou terminado → cala-se).
 * - endsAt: quando acaba a ronda (ms). Mudou com a mesma roundKey (o ± do
 *   cronómetro) → a faixa recomeça com o tempo que falta.
 * - roundNumber: a ronda a decorrer (ou a última); a seguinte é +1.
 * - eventName: para o ecrã bloqueado, «Ronda N · <nome>».
 * - defaultOn: como vem a quem nunca mexeu no interruptor — ligado nos mixes,
 *   desligado no resto (Francisco, 27 set).
 */
export default function RoundAlarm({ roundKey, endsAt, roundNumber, eventName, defaultOn = false }) {
  const { t } = useTranslation()
  const [prefs, setPrefs] = useState(() => loadAlarmPrefs(defaultOn))
  const [now, setNow] = useState(Date.now())
  const [blocked, setBlocked] = useState(false) // o telemóvel pediu um toque
  const played = useRef({ key: null, endsAt: null, warn: null })
  const vibrated = useRef({ key: null, warn: false, end: false })

  const running = !!roundKey && !!endsAt && endsAt > now
  const warnLabel = t(`roundalarm.warn_${prefs.warn}`)
  const trackInfo = () => ({
    key: roundKey,
    endsAt,
    warn: prefs.warn,
    title: t('roundalarm.media_title', { number: roundNumber, name: eventName || '' }),
    subtitle: t('roundalarm.media_subtitle', { warn: warnLabel }),
  })

  const start = () => {
    const info = trackInfo()
    played.current = { key: info.key, endsAt: info.endsAt, warn: info.warn }
    playRoundTrack(info).then(() => setBlocked(false)).catch(() => setBlocked(true))
  }

  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(i)
  }, [])

  // Pôr a tocar, acertar (±, aviso) ou calar, conforme a ronda.
  useEffect(() => {
    if (!prefs.on || !roundKey) {
      if (playingRoundKey()) stopRoundTrack()
      played.current = { key: null, endsAt: null, warn: null }
      setBlocked(false)
      return
    }
    const p = played.current
    if (p.key === roundKey && p.endsAt === endsAt && p.warn === prefs.warn) return
    if (p.key !== roundKey && playingRoundKey()) stopRoundTrack()
    if (!endsAt || endsAt - Date.now() <= 1000) {
      played.current = { key: roundKey, endsAt, warn: prefs.warn }
      return
    }
    start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.on, prefs.warn, roundKey, endsAt])

  // Sair da página cala o alarme («se a página ficar aberta»).
  useEffect(() => () => stopRoundTrack(), [])

  // Qualquer toque na página serve: desbloqueia o som para a próxima ronda
  // (o toque de quem organiza a começar a ronda) ou, se a ronda já vai a meio
  // e o telemóvel recusou, põe-na a tocar logo.
  useEffect(() => {
    if (!prefs.on) return
    const onTap = () => {
      if (playingRoundKey()) return
      if (running && blocked) start()
      else if (!running) unlockRoundAlarm()
    }
    document.addEventListener('click', onTap, true)
    return () => document.removeEventListener('click', onTap, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.on, running, blocked, roundKey, endsAt, prefs.warn])

  // Ecrã ligado enquanto há uma ronda com o alarme ligado.
  useEffect(() => {
    if (!prefs.on || !running || !('wakeLock' in navigator)) return
    let lock = null
    let alive = true
    const request = async () => {
      try { lock = await navigator.wakeLock.request('screen') } catch { lock = null }
      if (!alive) lock?.release?.()
    }
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (!lock || lock.released) request()
      // Uma chamada ou outra app calou a faixa: volta com o tempo que falta.
      if (!playingRoundKey() && played.current.key === roundKey) start()
    }
    request()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onVisible)
      try { lock?.release() } catch { /* já largado */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.on, running, roundKey])

  // Vibra no aviso e no fim (Android; o iPhone não deixa).
  useEffect(() => {
    if (!prefs.on || !roundKey || !endsAt || !('vibrate' in navigator)) return
    const v = vibrated.current
    if (v.key !== roundKey) vibrated.current = { key: roundKey, warn: endsAt - now <= prefs.warn * 1000, end: endsAt <= now }
    const left = endsAt - now
    if (left <= 0 && !vibrated.current.end) {
      vibrated.current.end = true
      if (left > -5000) navigator.vibrate([400, 150, 400, 150, 400])
    } else if (left > 0 && left <= prefs.warn * 1000 && !vibrated.current.warn) {
      vibrated.current.warn = true
      navigator.vibrate([200, 100, 200])
    }
  }, [prefs.on, prefs.warn, roundKey, endsAt, now])

  const update = (next) => {
    const merged = { ...prefs, ...next }
    saveAlarmPrefs(merged)
    setPrefs(merged)
  }
  const toggle = () => {
    if (prefs.on) {
      stopRoundTrack()
      update({ on: false })
      return
    }
    // Ligar é um toque: se a ronda já vai a meio, a faixa arranca já.
    saveAlarmPrefs({ ...prefs, on: true })
    if (running) start()
    else unlockRoundAlarm()
    setPrefs({ ...prefs, on: true })
  }

  if (prefs.on && running && blocked) {
    return (
      <div className="rounded-ctrl bg-amber-50 border border-amber-200 p-3">
        <p className="text-sm text-amber-900">
          <span className="font-extrabold">{t('roundalarm.started', { number: roundNumber })}</span>{' '}
          {t('roundalarm.tap_to_ring')}
        </p>
        <button
          type="button"
          onClick={start}
          className="mt-2.5 w-full min-h-[44px] rounded-ctrl bg-ink-900 text-white text-sm font-extrabold"
        >
          {t('roundalarm.turn_on_round', { number: roundNumber })}
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-ctrl border border-line bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-extrabold text-ink-900">{t('roundalarm.title')}</p>
        <button
          type="button"
          role="switch"
          aria-checked={prefs.on}
          aria-label={t('roundalarm.title')}
          onClick={toggle}
          className={`relative w-10 h-6 rounded-full shrink-0 transition-colors duration-fast ${prefs.on ? 'bg-ink-900' : 'bg-ink-200'}`}
        >
          <span className={`absolute top-1 w-4 h-4 rounded-full transition-all duration-fast ${prefs.on ? 'right-1 bg-lime-400' : 'left-1 bg-white'}`} />
        </button>
      </div>
      {!prefs.on && <p className="mt-1 text-xs text-muted">{t('roundalarm.off_hint')}</p>}
      {prefs.on && !running && (
        <p className="mt-1 text-xs font-bold text-ok">{t('roundalarm.waiting', { number: (roundNumber || 0) + 1 })}</p>
      )}
      {prefs.on && running && (
        <>
          <p className="mt-1 text-xs text-muted">{t('roundalarm.on_hint')}</p>
          <p className="mt-3 mb-1 text-xs text-ink-700">{t('roundalarm.warn_label')}</p>
          <Chips
            label={t('roundalarm.warn_label')}
            value={prefs.warn}
            onChange={(warn) => update({ warn })}
            options={WARN_OPTIONS.map((w) => ({ value: w, label: t(`roundalarm.warn_chip_${w}`) }))}
          />
          <p className="mt-2 rounded-ctrl bg-ink-50 px-3 py-2 text-xs text-ink-700">{t('roundalarm.note')}</p>
        </>
      )}
    </div>
  )
}
