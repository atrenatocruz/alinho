// Passo 1 «Pessoas» do jogo entre amigos (#342, versão final de 26 set):
// uma lista, sem duplas. Em cima a pesquisa de sempre — o «+» junta a pessoa
// e a pesquisa fica aberta para a seguinte. Por baixo «Quem joga · N», tu
// primeiro. Quem não está na app entra pelo nome (e email, se houver), fica
// logo no jogo com a etiqueta «Convidado». As equipas fazem-se depois.
//
// `people`: [{ key, user_id?, name, avatar_url?, guest?: true, email? }]
// (sem o criador — ele aparece à parte, em primeiro).
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Search, X, UserPlus } from 'lucide-react'
import { Avatar } from '../ui'
import { searchPlayers } from '../../lib/privateMatches'
import { partnerNameError, partnerEmailError, PARTNER_NAME_MAX } from '../../lib/partnerInvite'

export const MIN_PEOPLE = 4

export default function InviteesStep({ me, people, onAdd, onRemove, searchFn = searchPlayers }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const timer = useRef(null)

  useEffect(() => {
    clearTimeout(timer.current)
    const q = query.trim()
    if (q.length < 2) { setResults([]); return undefined }
    timer.current = setTimeout(() => {
      searchFn(q).then(setResults).catch((err) => console.error('Error searching players:', err))
    }, 300)
    return () => clearTimeout(timer.current)
  }, [query, searchFn])

  const inList = new Set([me?.id, ...people.map((p) => p.user_id)].filter(Boolean))
  const count = people.length + 1

  // «Não está na app?» — fechada por omissão; aberta pede nome e email.
  const [guestOpen, setGuestOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [touched, setTouched] = useState(false)
  const nameError = partnerNameError(name)
  const emailError = partnerEmailError(email)
  const addGuest = () => {
    setTouched(true)
    if (nameError || emailError) return
    onAdd({ key: `g-${Date.now()}`, guest: true, name: name.trim(), email: email.trim() || null })
    setName(''); setEmail(''); setTouched(false); setGuestOpen(false)
  }

  const label = 'block text-sm font-medium text-gray-700 mb-2'
  const row = 'flex min-h-[48px] items-center gap-3 rounded-ctrl border border-line bg-white px-3 py-2'

  return (
    <>
      <div>
        <div className="relative">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('partner.search_placeholder')}
            className="input-field pl-10" />
        </div>
        {results.length > 0 && (
          <div className="mt-2 overflow-hidden rounded-ctrl border border-line bg-white shadow-card">
            {results.slice(0, 6).map((r) => (
              <div key={r.id} className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0">
                <Avatar name={r.name} url={r.avatar_url} size="w-8 h-8 text-[11px]" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-900">{r.name}</span>
                {inList.has(r.id) ? (
                  <span className="shrink-0 text-xs font-semibold text-muted">{t('friends.already_in')}</span>
                ) : (
                  <button type="button" aria-label={t('friends.add_person', { name: r.name })}
                    onClick={() => onAdd({ key: r.id, user_id: r.id, name: r.name, avatar_url: r.avatar_url })}
                    className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink-900 text-white">
                    <Plus size={18} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className={label}>{t('friends.who_plays', { count })}</p>
        <div className="space-y-2">
          <div className="flex min-h-[48px] items-center gap-3 rounded-ctrl border border-[#BBF7D0] bg-[#DCFCE7] px-3 py-2">
            <Avatar name={me?.name} url={me?.avatar_url} size="w-8 h-8 text-[11px]" />
            <span className="text-sm font-extrabold text-[#14532D]">{t('friends.me_row', { name: me?.name || '' })}</span>
          </div>
          {people.map((p) => (
            <div key={p.key} className={row}>
              <Avatar name={p.name} url={p.avatar_url} size="w-8 h-8 text-[11px]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink-900">{p.name}</span>
                {p.guest && p.email && <span className="block text-xs text-muted">{t('friends.invite_email_sent')}</span>}
              </span>
              {p.guest && (
                <span className="shrink-0 rounded-full border border-line bg-ink-50 px-2.5 py-0.5 text-xs font-semibold text-ink-700">{t('friends.guest_tag')}</span>
              )}
              <button type="button" onClick={() => onRemove(p.key)} aria-label={t('friends.remove_person', { name: p.name })}
                className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted">
                <X size={18} />
              </button>
            </div>
          ))}
        </div>
        {count > MIN_PEOPLE && <p className="mt-2 text-xs text-muted">{t('friends.rotating_line', { count })}</p>}
      </div>

      {/* A caixa do mix (#546), com as mesmas palavras. Aqui o email vai
          mesmo: é o convite para entrar na app (Francisco, 26 set). */}
      <div className={`rounded-ctrl border p-4 ${guestOpen ? 'border-ok/40 bg-ok/5' : 'border-line bg-white'}`}>
        {guestOpen ? (
          <div className="space-y-4">
            <p className="flex items-center gap-2 text-sm font-extrabold text-ink-900"><UserPlus size={16} /> {t('partner.not_in_app_title')}</p>
            <p className="-mt-3 text-xs text-muted">{t('friends.not_in_app_hint')}</p>
            <div>
              <p className={label}>{t('friends.guest_name_label')}</p>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={PARTNER_NAME_MAX} className="input-field" autoFocus />
              {touched && nameError && <p className="mt-1 text-sm font-extrabold text-danger">{t(`partner.name_error_${nameError}`)}</p>}
            </div>
            <div>
              <p className={label}>{t('friends.guest_email_label')}</p>
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" inputMode="email" className="input-field" />
              {touched && emailError && <p className="mt-1 text-sm font-extrabold text-danger">{t('partner.email_error_invalid')}</p>}
              <p className="mt-2 text-xs text-muted">{t('friends.guest_email_hint')}</p>
            </div>
            <button type="button" onClick={addGuest}
              className="press inline-flex min-h-[48px] w-full items-center justify-center rounded-ctrl bg-ink-900 px-4 text-base font-extrabold text-white">
              {t('friends.add_guest', { name: name.trim() || t('friends.this_person') })}
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setGuestOpen(true)} className="press w-full text-left">
            <p className="flex items-center gap-2 text-sm font-extrabold text-ink-900"><Plus size={16} /> {t('partner.not_in_app_title')}</p>
            <p className="mt-1 text-xs text-muted">{t('friends.not_in_app_hint')}</p>
          </button>
        )}
      </div>
    </>
  )
}
