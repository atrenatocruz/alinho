import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, UserPlus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Sheet } from '../agenda/AgendaControls'
import { Avatar, PrimaryButton, RatingBadge, Chips } from '../ui'
import { addPlan } from '../../lib/mixEdit'
import { isGenderMismatch } from '../../lib/mixLogic'
import { contemTexto } from '../../lib/semAcentos'
import { partnerNameError, partnerEmailError, PARTNER_NAME_MAX } from '../../lib/partnerInvite'
import { describeError } from '../../lib/errors'

/* Adicionar jogador a um mix já começado, antes da Ronda 1 (Trello #292).
   Desenho: https://claude.ai/artifact/Kkm4WTP6CUUTu9SNwCA1C5 (ecrãs 2 e 3).

   Passo 1: quem entra (membro do clube/grupo), sozinho ou com parceiro.
   Passo 2, só se não houver lugar: abrir mais um campo (dentro do limite do
   plano) ou ficar como suplente. Quem grava é o GameDetails (onConfirm).

   Desde o #534 (24 set) serve também antes de o mix começar (`beforeStart`):
   a pessoa fica logo inscrita e não há duplas para refazer, por isso os
   textos não falam delas.

   Desde o #546 (25 set, SPEC em design-handoff/2026-09-25-mix-pessoa-sem-conta):
   «Não está na app?» — a caixa do «Entrar com parceiro» (#339), para quem
   entra. Nome obrigatório, email opcional, sem telemóvel. A conta é criada
   (ou encontrada, se o email já tiver uma) pela edge function
   admin-bulk-create-participants em modo create_only; depois a inscrição
   segue o caminho de sempre (vagas, suplente, mais um campo). */

export default function AddPlayerSheet({ game, excludeIds, peopleCount, capacity, maxCourts, ratingInfoById, busy, onConfirm, onClose, beforeStart = false }) {
  const { t } = useTranslation()
  const [members, setMembers] = useState([])
  const [loadError, setLoadError] = useState(false)
  const [query, setQuery] = useState('')
  const [withPartner, setWithPartner] = useState(false)
  const [playerId, setPlayerId] = useState(null)
  const [partnerId, setPartnerId] = useState(null)
  const [step, setStep] = useState('who') // 'who' | 'full'
  const [choice, setChoice] = useState('court')
  // «Não está na app?» (#546)
  const [named, setNamed] = useState(false)
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [touched, setTouched] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [newPlayer, setNewPlayer] = useState(null) // { name, existingAccount }

  useEffect(() => {
    let cancelled = false
    supabase
      .from('memberships')
      .select('user_id, is_guest, profile:profiles(id, name, avatar_url, gender)')
      .eq('organization_id', game.organization_id)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          console.error('Error loading members to add to the mix:', error)
          setLoadError(true)
          return
        }
        setMembers((data || [])
          .filter((m) => m.profile)
          .map((m) => ({ id: m.user_id, name: m.profile.name || '?', avatar_url: m.profile.avatar_url, gender: m.profile.gender }))
          .sort((a, b) => a.name.localeCompare(b.name, 'pt')))
      })
    return () => { cancelled = true }
  }, [game.organization_id])

  const available = useMemo(() => members.filter((m) => !excludeIds.has(m.id)), [members, excludeIds])
  // Sem contar acentos: «goncalves» encontra «Gonçalves».
  const q = query.trim()
  const matches = (list) => (q ? list.filter((m) => contemTexto(m.name, q)) : list).slice(0, 8)
  const byId = (id) => members.find((m) => m.id === id)

  const needed = withPartner ? 2 : 1
  const plan = addPlan({
    capacity, peopleCount, needed,
    numCourts: game.num_courts, maxPlayers: game.max_players, maxCourts,
  })
  const nameError = partnerNameError(newName)
  const emailError = partnerEmailError(newEmail)
  const ready = named
    ? !nameError && !emailError && (!withPartner || partnerId)
    : playerId && (!withPartner || partnerId)
  const names = [byId(playerId)?.name, withPartner ? byId(partnerId)?.name : null].filter(Boolean).join(' e ')

  const seguir = (id, extra, nomes) => {
    if (plan.fits) {
      onConfirm({ playerId: id, partnerId: withPartner ? partnerId : null, choice: 'fits', plan, names: nomes, ...extra })
      return
    }
    setChoice(plan.canAddCourt ? 'court' : 'waitlist')
    setStep('full')
  }

  // Quem não está na app: primeiro a conta (ou a que já existe com esse
  // email), depois a inscrição pelo caminho de sempre.
  const criarEInscrever = async () => {
    setCreating(true)
    setCreateError('')
    try {
      const { data, error } = await supabase.functions.invoke('admin-bulk-create-participants', {
        body: { organization_id: game.organization_id, create_only: true, players: [{ name: newName.trim(), email: newEmail.trim() }] },
      })
      if (error) throw error
      const criado = data?.created?.[0]
      if (!criado) throw new Error(data?.failed?.[0]?.error || 'create_failed')
      const pessoa = { id: criado.user_id, name: criado.name, avatar_url: null, gender: null }
      setMembers((list) => (list.some((m) => m.id === pessoa.id) ? list : [...list, pessoa]))
      const extra = { newPlayer: { name: criado.name, existingAccount: !!criado.existing_account } }
      setNewPlayer(extra.newPlayer)
      setPlayerId(criado.user_id)
      setNamed(false)
      const nomes = [criado.name, withPartner ? byId(partnerId)?.name : null].filter(Boolean).join(' e ')
      seguir(criado.user_id, extra, nomes)
    } catch (error) {
      console.error('Error creating a player without an account:', error)
      setCreateError(describeError(t, error, 'mixedit.error_add'))
    } finally {
      setCreating(false)
    }
  }

  const next = () => {
    setTouched(true)
    if (!ready) return
    if (named) { criarEInscrever(); return }
    seguir(playerId, {}, names)
  }

  const memberRow = (m, selected, onPick) => (
    <button
      key={m.id}
      type="button"
      onClick={onPick}
      className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-ctrl text-left ${selected ? 'bg-lime-100 ring-2 ring-lime-400' : 'hover:bg-ink-50'}`}
    >
      <Avatar name={m.name} url={m.avatar_url} size="w-9 h-9 text-xs" />
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-extrabold text-ink-900 truncate">{m.name}</span>
        {/* O admin pode pôr quem quiser (a base de dados deixa), mas fica avisado. */}
        {isGenderMismatch(game, m) && <span className="block text-[11px] text-amber-700">{t('mixedit.outside_gender')}</span>}
      </span>
      <RatingBadge rating={ratingInfoById[m.id]?.rating} gender={ratingInfoById[m.id]?.gender} />
    </button>
  )

  if (step === 'full') {
    const option = (value, title, text, disabled = false) => (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setChoice(value)}
        className={`w-full text-left rounded-card border px-3.5 py-3 flex flex-col gap-0.5 ${
          disabled ? 'opacity-50 border-line' : choice === value ? 'border-ink-900 ring-1 ring-ink-900' : 'border-line'
        }`}
      >
        <span className="text-sm font-extrabold text-ink-900">{title}</span>
        <span className="text-xs text-muted">{text}</span>
      </button>
    )
    return (
      <Sheet title={t('mixedit.full_title')} onClose={onClose}>
        <div className="space-y-3">
          <p className="text-sm text-muted">{t('mixedit.full_text', { people: peopleCount, capacity, names })}</p>
          {option(
            'court',
            t('mixedit.add_court_title'),
            plan.canAddCourt
              ? t(beforeStart ? 'mixedit.add_court_text_open' : 'mixedit.add_court_text', { from: game.num_courts || 1, to: plan.nextCourts, capacity: plan.nextCapacity })
              : t('mixedit.add_court_limit', { courts: maxCourts }),
            !plan.canAddCourt
          )}
          {option('waitlist', t('mixedit.waitlist_title'), t(beforeStart ? 'mixedit.waitlist_text_open' : 'mixedit.waitlist_text'))}
          <PrimaryButton
            className="w-full"
            disabled={busy}
            onClick={() => onConfirm({ playerId, partnerId: withPartner ? partnerId : null, choice, plan, names, ...(newPlayer ? { newPlayer } : {}) })}
          >
            {busy ? t('mixedit.saving') : t('mixedit.confirm')}
          </PrimaryButton>
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet title={t('mixedit.add_title')} onClose={onClose}>
      <div className="space-y-3">
        <label className="flex items-center gap-2 input-field focus-within:border-ink-500">
          <Search size={16} className="text-muted shrink-0" />
          <input
            id="mixedit-search"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('mixedit.search_placeholder')}
            className="flex-1 min-w-0 bg-transparent outline-none text-base"
          />
        </label>

        {loadError && <p className="text-sm text-danger font-extrabold">{t('mixedit.members_error')}</p>}

        <Chips
          value={withPartner}
          onChange={(v) => { setWithPartner(v); if (!v) setPartnerId(null) }}
          options={[
            { value: false, label: t('mixedit.alone') },
            { value: true, label: t('mixedit.with_partner') },
          ]}
        />

        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted mb-1.5">{t('mixedit.player_label')}</p>
          <div className="space-y-1">
            {matches(available.filter((m) => m.id !== partnerId)).map((m) => memberRow(m, !named && m.id === playerId, () => { setNamed(false); setPlayerId(m.id) }))}
            {available.length === 0 && !loadError && <p className="text-sm text-muted">{t('mixedit.no_members')}</p>}
          </div>
        </div>

        {/* «Não está na app?» (#546): a caixa do «Entrar com parceiro»,
            fechada por baixo de «Quem entra» — primeiro procura-se quem já
            está na app. */}
        <div className={`rounded-ctrl border-2 p-3 ${named ? 'border-ok bg-ok/5' : 'border-line'}`}>
          {named ? (
            <div className="space-y-3">
              <p className="text-sm font-extrabold text-ink-900">{t('partner.not_in_app_title')}</p>
              <div>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  maxLength={PARTNER_NAME_MAX}
                  placeholder={t('mixedit.new_player_name_placeholder')}
                  className="input-field"
                  autoFocus
                />
                {touched && nameError && (
                  <p className="mt-1 text-sm text-red-600 font-extrabold">{t(`partner.name_error_${nameError}`)}</p>
                )}
              </div>
              <div>
                <input
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  type="email"
                  inputMode="email"
                  placeholder={t('partner.email_placeholder')}
                  className="input-field"
                />
                {touched && emailError && (
                  <p className="mt-1 text-sm text-red-600 font-extrabold">{t('partner.email_error_invalid')}</p>
                )}
                <p className="mt-1 text-xs text-muted">{t('mixedit.new_player_email_hint')}</p>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => { setNamed(true); setPlayerId(null); setTouched(false) }} className="press w-full text-left">
              <p className="text-sm font-extrabold text-ink-900 flex items-center gap-2">
                <UserPlus size={16} /> {t('partner.not_in_app_title')}
              </p>
              <p className="text-sm text-muted">{t('mixedit.new_player_hint')}</p>
            </button>
          )}
        </div>
        {createError && <p className="text-sm text-red-600 font-extrabold">{createError}</p>}

        {withPartner && (
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted mb-1.5">{t('mixedit.partner_label')}</p>
            <div className="space-y-1">
              {matches(available.filter((m) => m.id !== playerId)).map((m) => memberRow(m, m.id === partnerId, () => setPartnerId(m.id)))}
            </div>
          </div>
        )}

        <p className="text-xs text-muted">{t(beforeStart ? 'mixedit.add_hint_open' : 'mixedit.reform_hint')}</p>
        <PrimaryButton className="w-full" disabled={!ready || busy || creating} onClick={next}>
          {busy || creating
            ? t('mixedit.saving')
            : named && newName.trim()
              ? t('mixedit.add_named', { name: newName.trim() })
              : plan.fits ? t(beforeStart ? 'mixedit.add_open' : 'mixedit.add_and_reform') : t('mixedit.continue')}
        </PrimaryButton>
      </div>
    </Sheet>
  )
}
