import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, UserPlus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Sheet } from '../agenda/AgendaControls'
import { Avatar, PrimaryButton } from '../ui'
import { partnerNameError, partnerEmailError, PARTNER_NAME_MAX } from '../../lib/partnerInvite'
import { contemTexto } from '../../lib/semAcentos'

/* Entrar num mix de duplas fixas com parceiro (Trello #339).
   Desenho: design-handoff/2026-09-19-torneios/wireframes/inscricoes.html,
   secção «Inscrever a dupla, não só a mim».

   Duas portas na mesma folha:
   • escolher alguém do grupo que já está na app;
   • «Não está na app?» — escrever o nome (e o email, se quiser), que cria
     uma conta por reclamar e manda-lhe um convite.

   Quem grava é o GameDetails (onConfirm), como no AddPlayerSheet. */

export default function JoinPartnerSheet({ game, excludeIds, busy, error, onConfirm, onClose }) {
  const { t } = useTranslation()
  const [members, setMembers] = useState([])
  const [loadError, setLoadError] = useState(false)
  const [query, setQuery] = useState('')
  const [partnerId, setPartnerId] = useState(null)
  const [mode, setMode] = useState('member') // 'member' | 'named'
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('memberships')
      .select('user_id, profile:profiles(id, name, avatar_url)')
      .eq('organization_id', game.organization_id)
      .then(({ data, error: loadErr }) => {
        if (cancelled) return
        if (loadErr) {
          console.error('Error loading members to join with a partner:', loadErr)
          setLoadError(true)
          return
        }
        setMembers((data || [])
          .filter((m) => m.profile)
          .map((m) => ({ id: m.user_id, name: m.profile.name || '?', avatar_url: m.profile.avatar_url }))
          .sort((a, b) => a.name.localeCompare(b.name, 'pt')))
      })
    return () => { cancelled = true }
  }, [game.organization_id])

  // Sem contar acentos: «goncalves» encontra «Gonçalves».
  const q = query.trim()
  const available = useMemo(() => members.filter((m) => !excludeIds.has(m.id)), [members, excludeIds])
  const shown = (q ? available.filter((m) => contemTexto(m.name, q)) : available).slice(0, 8)

  const nameError = partnerNameError(name)
  const emailError = partnerEmailError(email)
  const ready = mode === 'member' ? !!partnerId : !nameError && !emailError

  const confirm = () => {
    setTouched(true)
    if (!ready || busy) return
    onConfirm(mode === 'member'
      ? { kind: 'member', partnerId }
      : { kind: 'named', name: name.trim(), email: email.trim() })
  }

  return (
    <Sheet onClose={onClose} title={t('partner.sheet_title')}>
      <div className="space-y-4">
        {/* Quem já está na app */}
        <div className="space-y-2">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setMode('member') }}
              placeholder={t('partner.search_placeholder')}
              className="input-field pl-9"
            />
          </div>

          {loadError && <p className="text-sm text-muted">{t('partner.members_error')}</p>}

          <div className="space-y-1.5">
            {shown.map((m) => {
              const picked = mode === 'member' && partnerId === m.id
              return (
                <button
                  key={m.id}
                  onClick={() => { setMode('member'); setPartnerId(m.id) }}
                  className={`press w-full flex items-center gap-2.5 rounded-ctrl px-3 py-2 text-left border-2 ${
                    picked ? 'border-ok bg-ok/5' : 'border-transparent bg-ink-50'
                  }`}
                >
                  <Avatar name={m.name} url={m.avatar_url} size="w-8 h-8 text-[11px]" />
                  <span className="text-sm font-semibold text-ink-900 truncate">{m.name}</span>
                </button>
              )
            })}
            {!loadError && shown.length === 0 && (
              <p className="text-sm text-muted px-1">{t('partner.no_members_found')}</p>
            )}
          </div>
        </div>

        {/* Quem não está na app */}
        <div className={`rounded-ctrl border-2 p-3 ${mode === 'named' ? 'border-ok bg-ok/5' : 'border-line'}`}>
          {mode === 'named' ? (
            <div className="space-y-3">
              <p className="text-sm font-extrabold text-ink-900">{t('partner.not_in_app_title')}</p>
              <div>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={PARTNER_NAME_MAX}
                  placeholder={t('partner.name_placeholder')}
                  className="input-field"
                  autoFocus
                />
                {touched && nameError && (
                  <p className="mt-1 text-sm text-red-600 font-extrabold">{t(`partner.name_error_${nameError}`)}</p>
                )}
              </div>
              <div>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  inputMode="email"
                  placeholder={t('partner.email_placeholder')}
                  className="input-field"
                />
                {touched && emailError && (
                  <p className="mt-1 text-sm text-red-600 font-extrabold">{t('partner.email_error_invalid')}</p>
                )}
                {/* Enquanto o envio de emails não existir, dizer a verdade:
                    o convite vai por link. (Renato está a construir o envio,
                    21 set — quando existir, este texto cai.) */}
                <p className="mt-1 text-xs text-muted">{t('partner.email_hint')}</p>
              </div>
            </div>
          ) : (
            <button onClick={() => { setMode('named'); setPartnerId(null) }} className="press w-full text-left">
              <p className="text-sm font-extrabold text-ink-900 flex items-center gap-2">
                <UserPlus size={16} /> {t('partner.not_in_app_title')}
              </p>
              <p className="text-sm text-muted">{t('partner.not_in_app_hint')}</p>
            </button>
          )}
        </div>

        {error && <p className="text-sm text-red-600 font-extrabold">{error}</p>}

        <PrimaryButton onClick={confirm} disabled={!ready || busy} className="w-full">
          {busy ? t('gamedetails.joining') : t('partner.confirm')}
        </PrimaryButton>
      </div>
    </Sheet>
  )
}
