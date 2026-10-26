import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../contexts/AuthContext'
import { PrimaryButton } from '../ui'
import { PlayerOrGuestSlot } from '../../pages/CreatePrivateMatchSlots'
import { createPrivateMatch, submitPrivateMatchScore } from '../../lib/privateMatches'
import { setFriendMatchWatchResult } from '../../lib/friendChallenges'
import { WatchGames } from '../../lib/watchGames'
import { registerWatchGame, setsText } from '../../lib/watchRegister'
import { describeError } from '../../lib/errors'
import { formatDate } from '../../lib/formatDate'
import { card } from './shared'

/* «Registar o jogo» (relógio, Fase C): com quem jogaste e o resultado que veio
   do relógio (editável). Cria um jogo entre amigos com as RPCs de sempre; os
   outros três aceitam. Se o resultado mudou à mão, guarda-se também o do
   relógio, para os outros verem os dois. */
export default function RegistarJogo({ game, onDone, onCancel }) {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const [step, setStep] = useState(1)
  const [people, setPeople] = useState({ partner: null, partnerGuest: '', opp1: null, opp1Guest: '', opp2: null, opp2Guest: '' })
  const [sets, setSets] = useState(() => game.sets.map((s) => [...s]))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const filled = (p, g) => !!(people[p] || people[g].trim())
  const ready = filled('partner', 'partnerGuest') && filled('opp1', 'opp1Guest') && filled('opp2', 'opp2Guest')
  const taken = [user?.id, people.partner?.id, people.opp1?.id, people.opp2?.id].filter(Boolean)
  const changed = setsText(sets) !== setsText(game.sets)
  const isPoints = game.format !== 'm3' && game.format !== 'stb'

  const slot = (key, guestKey, label) => (
    <PlayerOrGuestSlot
      label={label}
      selected={people[key]}
      onSelect={(p) => setPeople((x) => ({ ...x, [key]: p }))}
      onClear={() => setPeople((x) => ({ ...x, [key]: null }))}
      guestName={people[guestKey]}
      onGuestNameChange={(v) => setPeople((x) => ({ ...x, [guestKey]: v }))}
      excludeIds={taken.filter((id) => id !== people[key]?.id)}
    />
  )

  const bump = (k, side, d) => setSets((list) => list.map((s, i) => (i === k ? s.map((v, j) => (j === side ? Math.min(40, Math.max(0, v + d)) : v)) : s)))

  const send = async () => {
    setSaving(true)
    setError('')
    try {
      const trimmed = { ...people, partnerGuest: people.partnerGuest.trim(), opp1Guest: people.opp1Guest.trim(), opp2Guest: people.opp2Guest.trim() }
      const { matchId, scoreSent } = await registerWatchGame({
        game,
        people: trimmed,
        sets,
        api: {
          createPrivateMatch,
          submitPrivateMatchScore,
          setFriendMatchWatchResult,
          markRegistered: (args) => WatchGames.markRegistered(args),
        },
      })
      onDone(matchId, scoreSent)
    } catch (err) {
      setError(describeError(t, err, 'numeros.register_error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <button type="button" onClick={step === 1 ? onCancel : () => setStep(1)} className="text-sm font-extrabold text-ink-700">
        ‹ {step === 1 ? t('numeros.tab_jogos') : t('numeros.register_who')}
      </button>
      <div className={card}>
        <b className="font-display text-base text-ink-900">{step === 1 ? t('numeros.register_who') : t('numeros.register_result')}</b>
        <p className="text-[13px] text-muted">
          {step === 1
            ? `${game.resultText} · ${formatDate(game.startedAt, i18n.language, { day: 'numeric', month: 'short' })} · ${t(`numeros.format_${game.format}`)}`
            : t('numeros.register_result_hint')}
        </p>
        {step === 1 ? (
          <div className="mt-3 space-y-3">
            {slot('partner', 'partnerGuest', t('numeros.register_partner'))}
            {slot('opp1', 'opp1Guest', t('numeros.register_against_1'))}
            {slot('opp2', 'opp2Guest', t('numeros.register_against_2'))}
            <p className="text-[13px] text-muted">{t('numeros.register_where_profile')}</p>
            <PrimaryButton type="button" disabled={!ready} onClick={() => setStep(2)}>{t('numeros.register_continue')}</PrimaryButton>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {sets.map((s, k) => (
              <div key={k} className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted">{isPoints ? t('numeros.register_games') : t('numeros.register_set', { n: k + 1 })}</span>
                <span className="flex items-center gap-3">
                  {[0, 1].map((side) => (
                    <span key={side} className="flex items-center gap-1.5">
                      <button type="button" onClick={() => bump(k, side, -1)} className="h-9 w-9 rounded-full border border-line font-extrabold" aria-label="−">−</button>
                      <b className="w-6 text-center tabular-nums text-ink-900">{s[side]}</b>
                      <button type="button" onClick={() => bump(k, side, 1)} className="h-9 w-9 rounded-full border border-line font-extrabold" aria-label="+">+</button>
                    </span>
                  ))}
                </span>
              </div>
            ))}
            {changed && <p className="rounded-ctrl bg-amber-50 p-2 text-[13px] text-ink-900">{t('numeros.register_changed')}</p>}
            {error && <p className="text-[13px] text-red-700">{error}</p>}
            <PrimaryButton type="button" disabled={saving} onClick={send}>{t('numeros.register_send')}</PrimaryButton>
            <p className="text-[13px] text-muted">{t('numeros.register_note')}</p>
          </div>
        )}
      </div>
    </div>
  )
}
