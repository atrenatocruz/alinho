import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { pricePerPlayer } from '../../lib/tournaments'
import { Search, UserPlus, Euro } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { ratingBand } from '../../lib/elo'
import { Sheet } from '../agenda/AgendaControls'
import { Avatar, Chips, PrimaryButton } from '../ui'
import { FieldLabel } from './TournamentBits'
import { partnerNameError, partnerEmailError, PARTNER_NAME_MAX } from '../../lib/partnerInvite'
import { slotsLeft, isCategoryFull } from '../../lib/tournamentSignup'
import { contemTexto } from '../../lib/semAcentos'
import { searchPlayers } from '../../lib/privateMatches'
import { CategorySpecialLine } from './CategorySpecialPrice'

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

import { TshirtPicker, tshirtOn, tshirtPriceLabel, pairTotalLine, shirtRulesOf } from './tshirt'

export default function TournamentSignupSheet({ tournament, categories: allCategories, category: pageCategory, categoriesLeft, takenIds = [], busy, error, onConfirm, onClose }) {
  const { t, i18n } = useTranslation()
  const { user, profile } = useAuth()
  // As que servem à pessoa primeiro — o género dela (ou misto) e o nível
  // mais perto do dela —, depois as outras, pela ordem do torneio. Com as
  // pastilhas numa fila que desliza, a que interessa fica quase sempre nas
  // três primeiras (designer, 26 set).
  // As categorias onde já estou não entram na lista: a t1 viu a M4 em 1.º
  // lugar, já inscrita nela, e inscrever outra vez ali é recusado (QA, 2 out).
  const categories = allCategories.filter((c) => !takenIds.includes(c.id))
  const category = categories.find((c) => c.id === pageCategory?.id) || null
  const myNum = Number(String(ratingBand(profile?.rating, profile?.gender)?.label || '').replace(/\D/g, '')) || null
  const fitsGender = (c) => !profile?.gender || c.gender === 'misto' || c.gender === profile.gender
  const ordered = [...categories].sort((a, b) => {
    const g = Number(fitsGender(b)) - Number(fitsGender(a))
    if (g) return g
    if (myNum != null) {
      const d = Math.abs((a.level ?? 99) - myNum) - Math.abs((b.level ?? 99) - myNum)
      if (d) return d
    }
    return (a.position ?? 0) - (b.position ?? 0)
  })
  const [categoryId, setCategoryId] = useState(category?.id || ordered[0]?.id || null)
  const [mode, setMode] = useState('partner') // 'partner' | 'named' | 'alone'
  const [members, setMembers] = useState([])
  const [query, setQuery] = useState('')
  const [partnerId, setPartnerId] = useState(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [teamName, setTeamName] = useState('')
  const [touched, setTouched] = useState(false)
  // A t-shirt de cada um (SPEC t-shirts, ponto 2): «Não quero» também é
  // escolha; sem escolha não se envia. A do convidado sem conta escolhe-a
  // quem inscreve.
  const [myShirt, setMyShirt] = useState(null)
  const [guestShirt, setGuestShirt] = useState(null)

  useEffect(() => {
    if (!tournament?.organization_id) return
    let cancelled = false
    supabase
      .from('memberships')
      .select('user_id, profile:profiles(id, name, avatar_url, gender)')
      .eq('organization_id', tournament.organization_id)
      .then(({ data, error: loadErr }) => {
        if (cancelled || loadErr) return
        setMembers((data || [])
          // Quem se está a inscrever não é parceiro de si próprio (#498).
          .filter((m) => m.profile && m.user_id !== user?.id)
          .map((m) => ({ id: m.user_id, name: m.profile.name || '?', avatar_url: m.profile.avatar_url, gender: m.profile.gender || null }))
          .sort((a, b) => a.name.localeCompare(b.name, 'pt')))
      })
    return () => { cancelled = true }
  }, [tournament?.organization_id, user?.id])

  // Sem contar acentos: «goncalves» encontra «Gonçalves».
  const q = query.trim()
  // Torneio público: o parceiro procura-se em toda a app, não só nos membros
  // do clube — quem não era membro não encontrava o parceiro e tinha de o
  // pôr à mão, e ele não recebia o convite (ensaio do QA, 1 out). A procura
  // geral (search_people_basic, Dev 3) esconde os perfis privados a quem não
  // partilha uma organização. Torneio privado: só os membros, como antes.
  const isPublic = tournament?.is_public !== false
  const [found, setFound] = useState([])
  useEffect(() => {
    if (!isPublic || q.length < 2) { setFound([]); return undefined }
    let alive = true
    const timer = setTimeout(() => {
      searchPlayers(q)
        .then((rows) => { if (alive) setFound(rows.filter((r) => r.id !== user?.id)) })
        .catch((err) => { console.error('Error searching players:', err); if (alive) setFound([]) })
    }, 250)
    return () => { alive = false; clearTimeout(timer) }
  }, [q, isPublic, user?.id])
  const shown = useMemo(() => {
    const mine = q ? members.filter((m) => contemTexto(m.name, q)) : members
    if (!q) return mine.slice(0, 6)
    const seen = new Set(mine.map((m) => m.id))
    return [...mine, ...found.filter((p) => !seen.has(p.id))].slice(0, 8)
  }, [members, found, q])

  const chosen = categories.find((c) => c.id === categoryId)
  const nameError = partnerNameError(name)
  const emailError = partnerEmailError(email)
  const shirts = tshirtOn(shirtRulesOf(tournament))
  const shirtsReady = !shirts || (!!myShirt && (mode !== 'named' || !!guestShirt))
  const ready = categoryId && shirtsReady && (
    mode === 'alone' ? true : mode === 'partner' ? !!partnerId : !nameError && !emailError
  )

  const confirm = () => {
    setTouched(true)
    if (!ready || busy) return
    onConfirm({
      categoryId,
      partnerId: mode === 'partner' ? partnerId : null,
      // Só para a pergunta do sexo (SignupSlot); não vai para a base de dados.
      partnerGender: mode === 'partner' ? members.find((m) => m.id === partnerId)?.gender || null : null,
      guestName: mode === 'named' ? name.trim() : null,
      guestEmail: mode === 'named' ? email.trim() : null,
      teamName: teamName.trim() || null,
      ...(shirts ? { tshirtSize: myShirt, partnerTshirtSize: mode === 'named' ? guestShirt : null } : {}),
    })
  }

  const price = (chosen?.price_cents ?? tournament?.entry_fee_cents)

  return (
    <Sheet onClose={onClose} title={t('tsignup.sheet_title', { name: tournament.name })}>
      <div className="space-y-4">
        {/* Categoria */}
        <div>
          <FieldLabel>{t('tsignup.category_label', { max: categoriesLeft })}</FieldLabel>
          {/* Uma escolha de formulário: as pastilhas da regra única (#528).
              Cheia não fecha a porta: o servidor põe quem chega depois como
              suplente, por ordem de chegada — o ecrã só o diz. */}
          {/* A fila vai até à beira da folha: a última pastilha aparece meio
              escondida, a mostrar que há mais (como na Comunidade). */}
          <div className="-mx-5">
          <Chips
            className="!mx-0 !px-5"
            label={t('tsignup.category_label', { max: categoriesLeft })}
            value={categoryId}
            onChange={setCategoryId}
            options={ordered.map((c) => {
              const left = slotsLeft(c)
              return {
                value: c.id,
                label: `${c.code} · ${isCategoryFull(c) ? t('tsignup.category_full_waitlist') : left == null ? c.name : t('tsignup.category_slots', { count: left })}`,
              }
            })}
          />
          </div>
        </div>

        {/* Com quem jogas? */}
        <div className="space-y-2">
          <FieldLabel className="!mb-0">{t('tsignup.partner_label')}</FieldLabel>

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
            {q.length >= 2 && shown.length === 0 && (
              <p className="px-1 text-xs text-muted">{t('tsignup.search_empty')}</p>
            )}
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
                  <p className="text-sm text-danger font-extrabold">{t(`partner.name_error_${nameError}`)}</p>
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
                  <p className="text-sm text-danger font-extrabold">{t('partner.email_error_invalid')}</p>
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
          <FieldLabel>{t('tsignup.team_name_label')}</FieldLabel>
          <input
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            maxLength={40}
            placeholder={t('tsignup.team_name_placeholder')}
            className="input-field"
          />
        </div>

        {/* A t-shirt do torneio (SPEC t-shirts, ponto 2). */}
        {shirts && (
          <div className="space-y-3">
            <div>
              <FieldLabel>{t('tshirt.mine_label', { price: tshirtPriceLabel(shirtRulesOf(tournament), t, i18n.language) })}</FieldLabel>
              <TshirtPicker rules={shirtRulesOf(tournament)} value={myShirt} onChange={setMyShirt} label={t('tshirt.mine_label', { price: '' })} />
            </div>
            {mode === 'named' && name.trim() && (
              <div>
                <FieldLabel>{t('tshirt.guest_label', { name: name.trim().split(/\s+/)[0], price: tshirtPriceLabel(shirtRulesOf(tournament), t, i18n.language) })}</FieldLabel>
                <TshirtPicker rules={shirtRulesOf(tournament)} value={guestShirt} onChange={setGuestShirt} label={t('tshirt.guest_label', { name: name.trim(), price: '' })} />
              </div>
            )}
            <div className="text-xs text-ink-500">
              {mode === 'partner' && partnerId && (
                <p>{t('tshirt.partner_chooses', { name: (members.find((m) => m.id === partnerId) || found.find((m) => m.id === partnerId))?.name?.split(/\s+/)[0] || '' })}</p>
              )}
              {tournament.entries_deadline && (
                <p>{t(mode === 'named' ? 'tshirt.change_until_both' : 'tshirt.change_until', { date: new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short', timeZone: 'Europe/Lisbon' }).format(new Date(tournament.entries_deadline)).replace('.', '').replace(' de ', ' ') })}</p>
              )}
            </div>
            {touched && !shirtsReady && <p className="text-sm text-danger font-extrabold">{t('tshirt.choose_error')}</p>}
          </div>
        )}

        {/* Pagamento — fora da app, texto do organizador */}
        <div className="rounded-ctrl bg-ink-50 px-3 py-2.5 text-sm text-ink-900 flex gap-2">
          <Euro size={16} className="mt-0.5 shrink-0 text-muted" />
          <div>
            {/* Com t-shirts à venda pedidas, o total é da dupla (SPEC, ponto 2). */}
            {price != null && (pairTotalLine(price / 100, shirtRulesOf(tournament), [myShirt, mode === 'named' ? guestShirt : null], t, i18n.language)
              ? <p className="font-extrabold">{pairTotalLine(price / 100, shirtRulesOf(tournament), [myShirt, mode === 'named' ? guestShirt : null], t, i18n.language)}</p>
              : <p className="font-extrabold">{t('tsignup.price', { price: euroWords(price / 100, i18n.language), each: pricePerPlayer(price / 100, i18n.language) })}</p>)}
            {/* Preço especial de quem se inscreve (7 out): «Grátis para ti · …». */}
            <CategorySpecialLine category={chosen} className="font-extrabold text-ok-700" />
            <p className="text-muted">{tournament.organizer_text || t('tsignup.payment_default')}</p>
          </div>
        </div>

        {error && <p className="text-sm text-danger font-extrabold">{error}</p>}

        <PrimaryButton onClick={confirm} disabled={!ready || busy} className="w-full">
          {busy ? t('gamedetails.joining') : t('tsignup.confirm')}
        </PrimaryButton>
      </div>
    </Sheet>
  )
}
