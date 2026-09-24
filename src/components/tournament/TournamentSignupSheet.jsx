import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { pricePerPlayer } from '../../lib/tournaments'
import { Search, UserPlus, Euro } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Sheet } from '../agenda/AgendaControls'
import { Avatar, PrimaryButton } from '../ui'
import { partnerNameError, partnerEmailError, PARTNER_NAME_MAX } from '../../lib/partnerInvite'
import { slotsLeft, isCategoryFull } from '../../lib/tournamentSignup'
import { contemTexto } from '../../lib/semAcentos'

/** «25 €» e «12,50 €», nunca «25.00 €»: as casas decimais só aparecem
 *  quando existem, e a vírgula é a do idioma de quem lê. */
const euroWords = (v, locale) => Number(v).toLocaleString(locale, {
  minimumFractionDigits: Number.isInteger(Number(v)) ? 0 : 2, maximumFractionDigits: 2,
})

/* Inscrever a dupla no torneio (Trello #362).
   Desenho: wireframes/inscricoes.html («Inscrever a dupla, não só a mim»)
   e print 03, 2.º telemóvel.

   Pela ordem em que a pessoa pensa: em que categoria → com quem →
   como se chama a equipa → quanto custa e como se paga. As pessoas
   primeiro, a configuração depois.

   O parceiro com conta recebe um pedido e TEM DE ACEITAR; o que não tem
   conta entra pelo nome e recebe um link. Quem grava é a página
   (onConfirm). */

export default function TournamentSignupSheet({ tournament, categories, category, categoriesLeft, busy, error, onConfirm, onClose }) {
  const { t, i18n } = useTranslation()
  const [categoryId, setCategoryId] = useState(category?.id || categories[0]?.id || null)
  const [mode, setMode] = useState('partner') // 'partner' | 'named' | 'alone'
  const [members, setMembers] = useState([])
  const [query, setQuery] = useState('')
  const [partnerId, setPartnerId] = useState(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [teamName, setTeamName] = useState('')
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    if (!tournament?.organization_id) return
    let cancelled = false
    supabase
      .from('memberships')
      .select('user_id, profile:profiles(id, name, avatar_url)')
      .eq('organization_id', tournament.organization_id)
      .then(({ data, error: loadErr }) => {
        if (cancelled || loadErr) return
        setMembers((data || [])
          .filter((m) => m.profile)
          .map((m) => ({ id: m.user_id, name: m.profile.name || '?', avatar_url: m.profile.avatar_url }))
          .sort((a, b) => a.name.localeCompare(b.name, 'pt')))
      })
    return () => { cancelled = true }
  }, [tournament?.organization_id])

  // Sem contar acentos: «goncalves» encontra «Gonçalves».
  const q = query.trim()
  const shown = useMemo(
    () => (q ? members.filter((m) => contemTexto(m.name, q)) : members).slice(0, 6),
    [members, q],
  )

  const chosen = categories.find((c) => c.id === categoryId)
  const nameError = partnerNameError(name)
  const emailError = partnerEmailError(email)
  const ready = categoryId && (
    mode === 'alone' ? true : mode === 'partner' ? !!partnerId : !nameError && !emailError
  )

  const confirm = () => {
    setTouched(true)
    if (!ready || busy) return
    onConfirm({
      categoryId,
      partnerId: mode === 'partner' ? partnerId : null,
      guestName: mode === 'named' ? name.trim() : null,
      guestEmail: mode === 'named' ? email.trim() : null,
      teamName: teamName.trim() || null,
    })
  }

  const price = (chosen?.price_cents ?? tournament?.entry_fee_cents)

  return (
    <Sheet onClose={onClose} title={t('tsignup.sheet_title', { name: tournament.name })}>
      <div className="space-y-4">
        {/* Categoria */}
        <div>
          <p className="mb-1.5 font-mono text-[11px] uppercase tracking-widest text-ink-500">
            {t('tsignup.category_label', { max: categoriesLeft })}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {categories.map((c) => {
              const full = isCategoryFull(c)
              const left = slotsLeft(c)
              return (
                <button
                  key={c.id}
                  disabled={full}
                  onClick={() => setCategoryId(c.id)}
                  className={`press rounded-full px-3 py-1.5 text-sm font-semibold border-2 ${
                    full ? 'border-line text-ink-400 line-through'
                      : categoryId === c.id ? 'border-ink-900 bg-ink-900 text-white' : 'border-line text-ink-900'
                  }`}
                >
                  {c.code} · {full ? t('tsignup.category_full') : left == null ? c.name : t('tsignup.category_slots', { count: left })}
                </button>
              )
            })}
          </div>
        </div>

        {/* Com quem jogas? */}
        <div className="space-y-2">
          <p className="font-mono text-[11px] uppercase tracking-widest text-ink-500">{t('tsignup.partner_label')}</p>

          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setMode('partner') }}
              placeholder={t('partner.search_placeholder')}
              className="input-field pl-9"
            />
          </div>

          <div className="space-y-1.5">
            {shown.map((m) => {
              const picked = mode === 'partner' && partnerId === m.id
              return (
                <button
                  key={m.id}
                  onClick={() => { setMode('partner'); setPartnerId(m.id) }}
                  className={`press w-full flex items-center gap-2.5 rounded-ctrl px-3 py-2 text-left border-2 ${
                    picked ? 'border-ok bg-ok/5' : 'border-transparent bg-ink-50'
                  }`}
                >
                  <Avatar name={m.name} url={m.avatar_url} size="w-8 h-8 text-[11px]" />
                  <span className="text-sm font-semibold text-ink-900 truncate">{m.name}</span>
                </button>
              )
            })}
          </div>

          {/* Sem conta */}
          <div className={`rounded-ctrl border-2 p-3 ${mode === 'named' ? 'border-ok bg-ok/5' : 'border-line'}`}>
            {mode === 'named' ? (
              <div className="space-y-2">
                <p className="text-sm font-extrabold text-ink-900">{t('partner.not_in_app_title')}</p>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={PARTNER_NAME_MAX}
                  placeholder={t('partner.name_placeholder')}
                  className="input-field"
                  autoFocus
                />
                {touched && nameError && (
                  <p className="text-sm text-red-600 font-extrabold">{t(`partner.name_error_${nameError}`)}</p>
                )}
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  inputMode="email"
                  placeholder={t('partner.email_placeholder')}
                  className="input-field"
                />
                {touched && emailError && (
                  <p className="text-sm text-red-600 font-extrabold">{t('partner.email_error_invalid')}</p>
                )}
                {/* O mesmo aviso do mix: o email guarda-se, o convite vai
                    por link enquanto o envio de emails nao existir (#479). */}
                <p className="text-xs text-muted">{t('partner.email_hint')}</p>
                <p className="text-xs text-muted">{t('tsignup.guest_hint')}</p>
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

          <button
            onClick={() => { setMode('alone'); setPartnerId(null) }}
            className={`press w-full rounded-ctrl border-2 p-3 text-left ${mode === 'alone' ? 'border-ok bg-ok/5' : 'border-line'}`}
          >
            <p className="text-sm font-extrabold text-ink-900">{t('tsignup.alone_title')}</p>
            <p className="text-sm text-muted">{t('tsignup.alone_hint')}</p>
          </button>
        </div>

        {/* Nome da equipa */}
        <div>
          <p className="mb-1.5 font-mono text-[11px] uppercase tracking-widest text-ink-500">{t('tsignup.team_name_label')}</p>
          <input
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            maxLength={40}
            placeholder={t('tsignup.team_name_placeholder')}
            className="input-field"
          />
        </div>

        {/* Pagamento — fora da app, texto do organizador */}
        <div className="rounded-ctrl bg-ink-50 px-3 py-2.5 text-sm text-ink-900 flex gap-2">
          <Euro size={16} className="mt-0.5 shrink-0 text-muted" />
          <div>
            {price != null && <p className="font-extrabold">{t('tsignup.price', { price: euroWords(price / 100, i18n.language), each: pricePerPlayer(price / 100, i18n.language) })}</p>}
            <p className="text-muted">{tournament.organizer_text || t('tsignup.payment_default')}</p>
          </div>
        </div>

        {error && <p className="text-sm text-red-600 font-extrabold">{error}</p>}

        <PrimaryButton onClick={confirm} disabled={!ready || busy} className="w-full">
          {busy ? t('gamedetails.joining') : t('tsignup.confirm')}
        </PrimaryButton>
      </div>
    </Sheet>
  )
}
