// «＋ Juntar pessoa» em «Quem joga», sem ir ao Editar (Francisco, 27 set):
// a pesquisa de sempre, e quem não está na app pelo nome (e email). Grava logo
// com add_friend_match_invitees — a pessoa fica por responder e recebe o
// convite no sino (ou no email).
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Search } from 'lucide-react'
import { Sheet } from '../agenda/AgendaControls'
import { Avatar, PrimaryButton } from '../ui'
import { searchPlayers, addFriendMatchInvitees } from '../../lib/privateMatches'
import { partnerNameError, partnerEmailError, PARTNER_NAME_MAX } from '../../lib/partnerInvite'
import { describeError } from '../../lib/errors'

export default function AddPersonSheet({ matchId, inGame, onClose, onSaved }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [guestOpen, setGuestOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const timer = useRef(null)

  useEffect(() => {
    clearTimeout(timer.current)
    const q = query.trim()
    if (q.length < 2) { setResults([]); return undefined }
    timer.current = setTimeout(() => { searchPlayers(q).then(setResults).catch((err) => console.error('Error searching players:', err)) }, 300)
    return () => clearTimeout(timer.current)
  }, [query])

  const add = async (invitee) => {
    setBusy(true); setError('')
    try { await addFriendMatchInvitees(matchId, [invitee]); onSaved() }
    catch (err) {
      console.error('Error adding a person to a friend match:', err)
      setError(err?.code === 'P0001' && err?.message ? err.message : describeError(t, err))
    } finally { setBusy(false) }
  }
  const nameError = partnerNameError(name)
  const emailError = partnerEmailError(email)
  const label = 'block text-sm font-medium text-gray-700 mb-2'

  return (
    <Sheet title={t('friends.add_person_button')} onClose={onClose}>
      <div className="space-y-3">
        <div className="relative">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('partner.search_placeholder')} className="input-field pl-10" autoFocus />
        </div>
        {results.length > 0 && (
          <div className="overflow-hidden rounded-ctrl border border-line bg-white">
            {results.slice(0, 6).map((r) => (
              <div key={r.id} className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0">
                <Avatar name={r.name} url={r.avatar_url} size="w-8 h-8 text-[11px]" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-900">{r.name}</span>
                {inGame.has(r.id) ? (
                  <span className="shrink-0 text-xs font-semibold text-muted">{t('friends.already_in')}</span>
                ) : (
                  <button type="button" disabled={busy} onClick={() => add({ user_id: r.id })} aria-label={t('friends.add_person', { name: r.name })}
                    className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink-900 text-white">
                    <Plus size={18} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {guestOpen ? (
          <div className="space-y-3 rounded-ctrl border border-line p-3">
            <div>
              <p className={label}>{t('friends.guest_name_label')}</p>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={PARTNER_NAME_MAX} className="input-field" />
              {touched && nameError && <p className="mt-1 text-sm font-extrabold text-danger">{t(`partner.name_error_${nameError}`)}</p>}
            </div>
            <div>
              <p className={label}>{t('friends.guest_email_label')}</p>
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" inputMode="email" className="input-field" />
              {touched && emailError && <p className="mt-1 text-sm font-extrabold text-danger">{t('partner.email_error_invalid')}</p>}
            </div>
            <PrimaryButton className="w-full" disabled={busy} onClick={() => {
              setTouched(true)
              if (nameError || emailError) return
              add({ guest_name: name.trim(), ...(email.trim() ? { guest_email: email.trim() } : {}) })
            }}>
              {t('friends.add_guest', { name: name.trim() || t('friends.this_person') })}
            </PrimaryButton>
          </div>
        ) : (
          <button type="button" onClick={() => setGuestOpen(true)} className="press w-full rounded-ctrl border border-line p-3 text-left">
            <span className="flex items-center gap-2 text-sm font-extrabold text-ink-900"><Plus size={16} /> {t('partner.not_in_app_title')}</span>
            <span className="mt-1 block text-xs text-muted">{t('friends.not_in_app_hint')}</span>
          </button>
        )}
        {error && <p className="rounded-ctrl border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-extrabold text-danger">{error}</p>}
      </div>
    </Sheet>
  )
}
