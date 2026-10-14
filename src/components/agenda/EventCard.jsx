import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { MapPin, CheckCircle2, Lock, Play, Trophy, Users, Shuffle, CircleDot, Clock, ListOrdered, GraduationCap, Building2, ChevronRight } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { sharePageLink } from '../../lib/shareImage'
import { GroupLevelBadge } from '../ui'
import { formatTime, formatCurrency } from '../../lib/formatDate'
import { useSpecialPriceLine } from '../SpecialPriceRoster'
import { GENDER_RESTRICTION_LABEL_KEY, mixCapacity, isGenderMismatch, isAgeIneligible, formatLabelKey, shortPersonName } from '../../lib/mixLogic'
import { AGE_LABEL_KEY } from '../../lib/ageCategories'
import { MascotPill } from './CardMascot'
import { isMixLive } from '../../lib/mixLive'
import HomeCard, { BandPill, CardTitle, CardChips, CardState, CardFoot, CardButton, kindColorsOf } from './HomeCard'
import FaceCircles from '../event/FaceCircles'
import { ratingBand, peopleRatingBand } from '../../lib/elo'
import { parseLevel, levelNumber } from '../../lib/mixLevels'
import { KIND_COLORS } from '../../lib/kindColors'

/* ════════════════════════════════════════════════════════════════════════
   Cartão da agenda da Home (Homepage unificada, Fase 1, Trello #258).

   Substitui o MixCard. Leva TUDO o que o MixCard levava — preço, prémio,
   formato, campos, restrições, amigos, avatares, vagas, nível, ação — mais
   o que a agenda pede: fundo e etiqueta na cor do tipo, dono com logótipo
   (quadrado = clube, redondo = grupo), contorno verde quando é meu, e o
   estado sempre no canto superior direito. O dia sai do cartão: já está no
   topo da página.

   Cores (aprovadas pelo Francisco a 17 set — design-handoff/
   2026-09-17-cores-e-pagina-do-evento/SPEC.md): o TIPO pinta o cartão
   (fundo claro + etiqueta branca com texto na cor); o ESTADO nunca pinta o
   cartão — é uma pastilha cheia e, quando estás inscrito, contorno verde.
   Nenhum tipo usa âmbar, lima ou preto (desde o R0 de 13 out as aulas são
   verde-escuro, #15803D). Lima só no botão principal e
   em "A decorrer". As classes são literais completos — o Tailwind não vê
   classes montadas.
   ════════════════════════════════════════════════════════════════════════ */

// As cores vêm de src/lib/kindColors.js (R0 do redesign, aprovado pelo
// Francisco a 13 out — cores fortes por tipo; saem os pastéis de 17 set).
// `card` = o fundo claro do tipo com o contorno fino; `bg` = o fundo claro;
// `chip` = a pastilha do tipo, cheia na cor forte com texto branco;
// `text` = o tipo escrito na cor forte; `color` = a cor forte em hex (pontos
// dos filtros e pinos do mapa, MapView.jsx). As classes são literais
// completos — o Tailwind não vê classes montadas.
// Horários livres: sem pastilha cheia (o salmão claro não aguenta texto
// branco); o texto vai na cor escura do jogo em aberto.
export const KIND_STYLE = {
  mix:        { card: 'bg-kind-mix-light border-kind-mix-line', bg: 'bg-kind-mix-light', chip: 'bg-kind-mix text-white', text: 'text-kind-mix', color: KIND_COLORS.mix.strong, icon: Shuffle, labelKey: 'agenda.kind_mix' },
  open:       { card: 'bg-kind-open-light border-kind-open-line', bg: 'bg-kind-open-light', chip: 'bg-kind-open text-white', text: 'text-kind-open', color: KIND_COLORS.open.strong, icon: CircleDot, labelKey: 'agenda.kind_open' },
  free:       { card: 'bg-kind-free-light border-kind-free-line', bg: 'bg-kind-free-light', text: 'text-kind-free-dark', color: KIND_COLORS.free.strong, icon: Clock, labelKey: 'agenda.filter_kind_free' },
  friends:    { card: 'bg-kind-friends-light border-kind-friends-line', bg: 'bg-kind-friends-light', chip: 'bg-kind-friends text-white', text: 'text-kind-friends', color: KIND_COLORS.friends.strong, icon: Users, labelKey: 'agenda.kind_friends' },
  // Aulas com professores (Trello #49).
  lesson:     { card: 'bg-kind-lesson-light border-kind-lesson-line', bg: 'bg-kind-lesson-light', chip: 'bg-kind-lesson text-white', text: 'text-kind-lesson', color: KIND_COLORS.lesson.strong, icon: GraduationCap, labelKey: 'agenda.kind_lesson' },
  tournament: { card: 'bg-kind-tournament-light border-kind-tournament-line', bg: 'bg-kind-tournament-light', chip: 'bg-kind-tournament text-white', text: 'text-kind-tournament', color: KIND_COLORS.tournament.strong, icon: Trophy, labelKey: 'agenda.kind_tournament' },
  league:     { card: 'bg-kind-league-light border-kind-league-line', bg: 'bg-kind-league-light', chip: 'bg-kind-league text-white', text: 'text-kind-league', color: KIND_COLORS.league.strong, icon: ListOrdered, labelKey: 'agenda.kind_league' },
}

const ACTION_LABEL_KEY = {
  join: 'ui.action_join',
  waitlist: 'ui.action_waitlist',
  leave: 'ui.action_leave',
  leave_waitlist: 'ui.action_leave_waitlist',
}

// «Rita Figueira» → «Rita F.» (o nome de quem abriu um jogo em aberto): o
// shortPersonName comum (mixLogic), com os números do fim (12 out).

const initials = (name) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()

export function KindTag({ kind, past, suffix = null }) {
  const { t } = useTranslation()
  const style = KIND_STYLE[kind]
  const Icon = style.icon
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-extrabold px-2 py-1 rounded-full ${style.chip ?? `bg-white ${style.text}`} ${past ? 'opacity-70' : ''}`}>
      <Icon size={12} /> {t(style.labelKey)}{suffix && <> · {suffix}</>}
    </span>
  )
}

/** O tipo na linha por baixo do nome do clube (Home do futuro, SPEC-3 —
 *  aprovado pelo Francisco a 9 out): sem pastilha, a negrito pequeno e na
 *  cor do tipo, «⤮ Mix · Recorrente». `label` troca o nome do tipo (ex.:
 *  o tipo da aula). */
export function KindLine({ kind, past = false, suffix = null, label = null }) {
  const { t } = useTranslation()
  const style = KIND_STYLE[kind]
  const Icon = style.icon
  return (
    <span className={`flex min-w-0 items-center gap-1 text-[13px] font-extrabold leading-tight ${past ? 'text-muted' : style.text}`}>
      <Icon size={13} className="shrink-0" />
      <span className="truncate">{label || t(style.labelKey)}{suffix && <> · {suffix}</>}</span>
    </span>
  )
}

/** Os estados compridos («⏳ Falta o parceiro aceitar», «⏳ Pedido enviado»,
 *  «Suplente») numa linha por baixo do nome do evento, sem pastilha, a
 *  negrito pequeno na cor do tipo. No canto só ficam os curtos (UX, 10 out). */
export function StateLine({ kind, children }) {
  const style = KIND_STYLE[kind] || KIND_STYLE.mix
  return <p className={`mt-1.5 text-[12.5px] font-extrabold ${style.text}`}>{children}</p>
}


export function StateTag({ tone, icon: Icon, children }) {
  const tones = {
    in: 'bg-ok text-white',
    live: 'bg-lime-400 text-ink-900',
    wait: 'bg-[#B86E00] text-white',
    invited: 'bg-ink-900 text-white',
    grey: 'bg-surface text-ink-700',
  }
  return (
    <span className={`inline-flex max-w-full items-center gap-1 text-[11px] font-extrabold px-2 py-1 rounded-full whitespace-nowrap ${tones[tone]}`}>
      {Icon && <Icon size={12} className="shrink-0" />} <span className="truncate">{children}</span>
    </span>
  )
}

/** Abre o perfil do clube ou grupo de um evento (design-handoff/2026-09-28-
    cartao-com-organizador). Os eventos da Home trazem o id e nem sempre o
    endereço: pede-se o endereço ao tocar, para não mexer nas consultas da Home. */
export function useOpenOrg(event) {
  const navigate = useNavigate()
  if (!event?.orgName || (!event.orgSlug && !event.orgId)) return null
  return async (e) => {
    e?.preventDefault?.()
    e?.stopPropagation?.()
    let slug = event.orgSlug
    if (!slug) {
      const { data } = await supabase.from('organizations').select('slug').eq('id', event.orgId).maybeSingle()
      slug = data?.slug
    }
    if (slug) navigate(`/clube/${slug}`)
  }
}

/** Em cima de cada cartão da Home: o logótipo redondo de quem organiza, o
    nome com «›» e «Grupo organizador» / «Clube organizador». Tocar aqui abre
    o perfil; o resto do cartão abre o evento (sugestão do Ruben, aprovada
    pelo Francisco a 28 set). `right`: o estado do cartão («A decorrer»,
    «Inscrito»…) no canto de cima, à direita — sem espaço vazio ao lado do
    logótipo (Francisco, 30 set). `kind`: a linha do tipo, que fica no lugar
    de «Clube organizador» (SPEC-3, 9 out). O nome do clube manda: até duas
    linhas e nunca partido letra a letra; o que está no canto é que cede
    (UX, 10 out). */
export function OrgHeader({ event, past = false, right = null, kind = null, mascot = false, pillPos = null }) {
  const { t } = useTranslation()
  const open = useOpenOrg(event)
  if (!event.orgName) return null
  const isGroup = event.orgKind === 'group'
  const Tag = open ? 'button' : 'div'
  const cut = event.orgName.lastIndexOf(' ')
  const nameHead = cut > 0 ? event.orgName.slice(0, cut + 1) : ''
  const nameTail = cut > 0 ? event.orgName.slice(cut + 1) : event.orgName
  const header = (
    <Tag {...(open ? { type: 'button', onClick: open } : {})}
      className={`relative z-[1] flex min-w-0 items-center gap-3 text-left ${right && !mascot ? 'flex-1' : 'mb-2.5 w-full'} ${past ? 'opacity-70' : ''}`}>
      {event.orgLogo
        ? <img src={event.orgLogo} alt="" className="h-[52px] w-[52px] shrink-0 rounded-full object-cover" />
        : <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-ink-900 text-[15px] font-extrabold text-lime-400">{initials(event.orgName)}</span>}
      <span className="min-w-0">
        {/* O nome em até duas linhas, com o «›» logo a seguir — cortado, o «›»
            ficava solto longe do nome (UX, 30 set). */}
        <span className="line-clamp-2 break-normal text-[17px] font-extrabold leading-tight text-ink-900">
          {/* A última palavra e o «›» não se separam: o «›» nunca fica sozinho numa linha. */}
          {nameHead}<span className="whitespace-nowrap">{nameTail}{open && <ChevronRight size={18} strokeWidth={2.75} className="ml-0.5 inline align-[-3px]" />}</span>
        </span>
        {kind ? <span className="mt-0.5 block">{kind}</span> : (
          <span className="mt-0.5 flex items-center gap-1 text-[13px] text-ink-700">
            {isGroup ? <Users size={13} className="shrink-0" /> : <Building2 size={13} className="shrink-0" />}
            {t(isGroup ? 'agenda.org_group_organizer' : 'agenda.org_club_organizer')}
          </span>
        )}
      </span>
    </Tag>
  )
  // Com o boneco (CardMascot): o nome nunca passa por baixo dele e a pastilha
  // desce para por baixo, à altura da hora (12 out).
  if (mascot) return <><div className="pr-[80px]">{header}</div><MascotPill {...(pillPos || {})}>{right}</MascotPill></>
  if (!right) return header
  return <div className="mb-2.5 flex items-start justify-between gap-2">{header}<span className="flex min-w-0 max-w-[42%] shrink justify-end">{right}</span></div>
}

/** Linha do dono: logótipo (quadrado = clube, redondo = grupo) + nome + tipo.
    Com `link`, abre o perfil do clube ou grupo, com «›» (página do evento). */
export function Owner({ event, fallbackKey, link = false }) {
  const open = useOpenOrg(link ? event : null)
  const { t } = useTranslation()
  if (!event.orgName) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-ink-700 min-w-0">
        <span className="w-5 h-5 rounded-full bg-white/80 text-ink-700 flex items-center justify-center shrink-0"><Users size={11} /></span>
        <span className="truncate">{t(fallbackKey)}</span>
      </p>
    )
  }
  const isGroup = event.orgKind === 'group'
  const shape = isGroup ? 'rounded-full bg-ink-700 text-white' : 'rounded-[5px] bg-ink-900 text-lime-400'
  const inner = (
    <>
      {event.orgLogo
        ? <img src={event.orgLogo} alt="" className={`w-5 h-5 object-cover shrink-0 ${isGroup ? 'rounded-full' : 'rounded-[5px]'}`} />
        : <span className={`w-5 h-5 text-[8px] font-extrabold flex items-center justify-center shrink-0 ${shape}`}>{initials(event.orgName)}</span>}
      <span className="truncate">{event.orgName} · {t(isGroup ? 'agenda.owner_group' : 'agenda.owner_club')}</span>
      {open && <ChevronRight size={16} className="shrink-0" />}
    </>
  )
  if (open) {
    return <button type="button" onClick={open} className="flex max-w-full items-center gap-1.5 text-left text-sm text-ink-700 min-w-0 hover:text-ink-900">{inner}</button>
  }
  return <p className="flex items-center gap-1.5 text-sm text-ink-700 min-w-0">{inner}</p>
}


/* ─── Mix e jogo em aberto ──────────────────────────────────────────────── */

/** Local (+ distância) e a linha de factos — igual nos cartões de mix dos
    meus clubes e nos de explorar, para um mix não se descrever de duas formas. */
const HM = { hour: '2-digit', minute: '2-digit' }


export function GameEventCard({ event, profile, friendIds = null, action = null, result = null, past = false, distance = null }) {
  const { t, i18n } = useTranslation()
  const game = event.raw
  // Convidados sem conta (game_guests): titular ou parceiro sem profile —
  // nome vem da linha do convidado, sempre marcados como guest.
  const players = (game.participants || [])
    .filter((p) => p.status === 'confirmed')
    .flatMap((p) => [
      p.user_id
        ? { id: p.user_id, name: p.user?.name, rating: p.user?.rating, gender: p.user?.gender, isGuest: p.user?.is_guest, avatar_url: p.user?.avatar_url }
        : { id: p.guest_id ?? null, name: p.guest?.name || 'Jogador', rating: null, gender: null, isGuest: true, avatar_url: null },
      ...(p.partner_id
        ? [{ id: p.partner_id, name: p.partner?.name, rating: p.partner?.rating, gender: p.partner?.gender, isGuest: p.partner?.is_guest, avatar_url: p.partner?.avatar_url }]
        : p.partner_guest_id
          ? [{ id: p.partner_guest_id, name: p.partner_guest?.name || 'Jogador', rating: null, gender: null, isGuest: true, avatar_url: null }]
          : []),
    ])
  // Convidados contam como jogadores mas não entram na média de nível.
  const rated = players.filter((p) => !p.isGuest && p.rating != null)
  const avgRating = rated.length ? rated.reduce((s, p) => s + p.rating, 0) / rated.length : null
  const capacity = mixCapacity(game)
  const isFull = players.length >= capacity
  const isClosed = game.status === 'closed' || (game.status === 'open' && isFull)
  // Só a decorrer com a ronda 1 começada (mixLive, 12 out).
  const isLive = isMixLive(game)
  const friendsIn = friendIds ? players.filter((p) => p.id && friendIds.has(p.id)) : []
  // Jogo em aberto aberto por alguém (SPEC-4, ponto 5): «Abriste este jogo»
  // para quem o abriu, «<Nome> abriu este jogo» para os outros, e o que falta
  // («Falta 1 dupla», «Faltam 3 pessoas»). Quem o abriu é a 1.ª inscrição.
  const isOpenSlot = game.origin === 'open_slot'
  const opener = isOpenSlot
    ? [...(game.participants || [])].filter((p) => p.status === 'confirmed' && p.user_id)
      .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))[0] || null
    : null
  const iOpened = !!opener && opener.user_id === profile?.id
  const openerName = opener?.user?.name ? shortPersonName(opener.user.name) : ''
  const openTitle = opener ? (iOpened ? t('home.open_you_opened') : openerName ? t('home.open_x_opened', { name: openerName }) : null) : null
  const missing = isOpenSlot && !past && !event.finished ? Math.max(0, capacity - players.length) : 0
  const time = formatTime(event.startsAt, i18n.language, { hour: '2-digit', minute: '2-digit' })

  // "Outro nível, género ou idade: aparece, marcado" (Francisco, 16 set).
  // Só para quem não está dentro — a quem já está inscrito não interessa.
  let mismatchKey = null
  if (!event.mine && !past && profile) {
    if (isGenderMismatch(game, profile) || isAgeIneligible(game, profile)) {
      mismatchKey = 'agenda.state_not_for_you'
    } else if (game.level) {
      const mine = ratingBand(profile.rating, profile.gender)
      if (mine?.fullVars?.num != null && String(mine.fullVars.num) !== levelNumber(game.level)) {
        mismatchKey = 'agenda.state_other_level'
      }
    }
  }

  let state = null
  if (past || event.finished) state = <StateTag tone="grey" icon={CheckCircle2}>{t('agenda.state_finished')}</StateTag>
  else if (isLive) state = <StateTag tone="live" icon={Play}>{t('ui.status_live')}</StateTag>
  else if (event.myState === 'in') state = <StateTag tone="in" icon={CheckCircle2}>{t('agenda.state_in')}</StateTag>
  else if (mismatchKey && event.myState !== 'waitlist') state = <StateTag tone="grey">{t(mismatchKey)}</StateTag>
  // Suplente: estado comprido, numa linha por baixo do nome (UX, 10 out).
  const stateLine = !past && !event.finished && !isLive && event.myState === 'waitlist' ? t('agenda.state_line_waitlist') : null

  // Recorrência e nível (#577) como sufixo do tipo, «Mix · Recorrente · MX4»,
  // igual à página do evento (Trello #383). O nível não vai numa pastilha
  // preta: a de baixo, «N4», é o nível médio dos inscritos (designer, 26 set).
  const kindLine = <KindLine kind={event.kind} past={past} suffix={[
    game.recurrence_id ? t('ui.recurring') : null,
    event.kind === 'mix' && parseLevel(game.level) ? `${parseLevel(game.level).scale}${parseLevel(game.level).num}` : null,
  ].filter(Boolean).join(' · ') || null} />

  // R1 — Cartões da Home (13 out): a faixa da cor do tipo e o corpo branco.
  const level = event.kind === 'mix' && parseLevel(game.level) ? `${parseLevel(game.level).scale}${parseLevel(game.level).num}` : null
  const label = [t(KIND_STYLE[event.kind]?.labelKey || 'agenda.kind_mix'),
    isOpenSlot ? t('gamedetails.court_count', { count: game.num_courts || 1 }) : level].filter(Boolean).join(' · ')
  const endsAt = game.court_time_minutes ? formatTime(new Date(new Date(game.date).getTime() + game.court_time_minutes * 60000), i18n.language, HM) : null
  const timeAside = endsAt ? t('homecard.until', { time: endsAt }) : game.recurrence_id ? t('ui.recurring').toLowerCase() : null
  let pill = null
  if (past || event.finished) pill = <BandPill tone="dark">{t('agenda.state_finished')}</BandPill>
  else if (isLive) pill = <BandPill tone="dark">▶ {t('ui.status_live')}</BandPill>
  else if (event.myState === 'in') pill = <BandPill>✓ {t('home.next_in')}</BandPill>
  else if (mismatchKey && event.myState !== 'waitlist') pill = <BandPill tone="dark">{t(mismatchKey)}</BandPill>
  // A linha de estado: o que falta para fechar o campo, «Inscrições abertas»,
  // «Estás dentro», «Suplente» ou «Completo».
  const free = Math.max(0, capacity - players.length)
  const courtNow = Math.floor(players.length / 4) + 1
  const toClose = (4 - (players.length % 4)) % 4
  let stateRow = null
  if (!past && !event.finished && !isLive) {
    if (event.myState === 'in') stateRow = <CardState tone="ok">{t('home.next_in')}</CardState>
    else if (stateLine) stateRow = <CardState tone="warn">{stateLine}</CardState>
    else if (missing > 0 && opener) stateRow = <CardState tone="warn">{missing === 2 && players.length === 2 ? t('home.open_missing_pair') : t('home.open_missing', { count: missing })}</CardState>
    else if (free === 0) stateRow = <CardState tone="warn">{t('homecard.full')}</CardState>
    else if (!isOpenSlot && toClose > 0 && players.length > 0) stateRow = <CardState tone="warn">{t('homecard.to_close_court', { count: toClose, court: courtNow })}</CardState>
    else if (game.status === 'open') stateRow = <CardState tone="ok">{t('homecard.open')}</CardState>
  }
  const chips = [
    isOpenSlot ? t('openday.players', { count: capacity }) : t(formatLabelKey(game)),
    !isOpenSlot ? t('gamedetails.court_count', { count: game.num_courts || 1 }) : null,
    game.ranked === false ? t('gamedetails.badge_friendly') : null,
    // Quem pode entrar e a idade, quando restringem (como antes).
    game.gender_restriction && !['indiferente', 'misto'].includes(game.gender_restriction) ? t(GENDER_RESTRICTION_LABEL_KEY[game.gender_restriction]) : null,
    game.age_restriction && AGE_LABEL_KEY[game.age_restriction] ? t(AGE_LABEL_KEY[game.age_restriction]) : null,
    distance != null ? t('agenda.distance_km', { km: distance < 10 ? distance.toFixed(1).replace('.0', '') : Math.round(distance) }) : null,
  ].filter(Boolean)
  let button = null
  if (past) {
    button = result && (result.mix_won || result.rating_delta != null) ? (
      <span className="text-xs font-extrabold text-ink-900 tabular-nums">
        {result.mix_won ? t('agenda.result_won') : t('agenda.result_rating_delta', { delta: `${result.rating_delta > 0 ? '+' : ''}${Math.round(result.rating_delta)}` })}
      </span>
    ) : null
  } else if (iOpened) {
    // Quem abriu partilha para encher (contorno); sair faz-se no jogo.
    button = <CardButton variant="out" onClick={() => sharePageLink({ title: game.title, text: t('home.open_share_text', { time, club: event.orgName || '' }), url: `${window.location.origin}/jogo/${game.id}` })}>{t('home.open_share')}</CardButton>
  } else if (action && (action.kind === 'join' || action.kind === 'waitlist')) {
    button = <CardButton variant={action.kind === 'join' ? 'lime' : 'out'} disabled={action.busy} onClick={() => action.onAction()}>{t(ACTION_LABEL_KEY[action.kind])}</CardButton>
  } else if (event.myState === 'in' || event.myState === 'waitlist') {
    // Já dentro: «Ver» em contorno, que abre o evento (o «Sair» fica lá).
    button = <span className="pointer-events-none whitespace-nowrap rounded-[14px] border-[1.5px] border-[#CFD2D7] bg-white px-[18px] py-[11px] font-display text-[14.5px] font-extrabold leading-none text-ink-900">{t('homecard.see')}</span>
  } else if (isClosed && !isLive && !event.finished && !mismatchKey) {
    button = <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-[11px] font-extrabold text-ink-700"><Lock size={13} className="shrink-0" /> {t('ui.court_reserved')}</span>
  }

  return (
    <HomeCard colors={kindColorsOf(event.kind)} label={label} pill={pill} time={time} timeAside={timeAside}
      count={{ n: players.length, of: capacity, unit: t(isOpenSlot ? 'homecard.unit_players' : 'homecard.unit_signed') }}
      imageUrl={game.image_url || null} mine={event.myState === 'in'} past={past}
      to={`/jogo/${game.id}`} ariaLabel={`${game.title} — ${time}`}>
      <CardClub event={event} past={past} />
      <CardTitle past={past}>{openTitle || game.title}</CardTitle>
      <CardChips>
        {chips.join(' · ')}
        {game.price_per_player > 0 && <> · <PriceText game={game} /></>}
      </CardChips>
      {/* Nomes completos de propósito — regra assente no produto. */}
      {friendsIn.length > 0 && (
        <span className="mt-2 inline-block max-w-full truncate rounded-full bg-lime-50 px-[9px] py-[5px] font-display text-[12px] font-bold leading-none text-[#4A5A00]">
          {friendsIn.length === 1
            ? t('ui.friend_in_mix_one', { name: friendsIn[0].name })
            : friendsIn.length === 2
              ? t('ui.friend_in_mix_two', { first: friendsIn[0].name, second: friendsIn[1].name })
              : t('ui.friend_in_mix_many', { name: friendsIn[0].name, count: friendsIn.length - 1 })}
        </span>
      )}
      {stateRow}
      <CardFoot people={players} slots={capacity}>{button}</CardFoot>
    </HomeCard>
  )
}

/** O preço da linha cinzenta: o especial de quem vê, ou o de sempre. */
function PriceText({ game }) {
  const { i18n } = useTranslation()
  const specialLine = useSpecialPriceLine(game.origin === 'open_slot' ? 'open_slot' : 'mix', game.price_per_player > 0 ? game.id : null)
  return specialLine || formatCurrency(game.price_per_player, i18n.language)
}

/** R1: o clube em cima do corpo — logótipo redondo pequeno, o nome e «›»
 *  (abre o clube). Sem clube, quem organiza. `label`: dentro da página do
 *  clube, o tipo em vez do clube. */
export function CardClub({ event, past = false, label = null, place = undefined }) {
  const open = useOpenOrg(event)
  if (label) return <p className="py-1 font-display text-[13.5px] font-semibold leading-none text-[#4F535A]">{label}</p>
  // Amigos sem clube (UX, 13 out): o lugar com o pino, sem «›»; sem lugar,
  // nada — «Sem clube» não ajudava.
  if (!event.orgName && place !== undefined) {
    return place ? (
      <p className={`flex min-w-0 items-center gap-1.5 py-1 font-display text-[13.5px] font-bold leading-none text-ink-900 ${past ? 'opacity-70' : ''}`}>
        <MapPin size={14} className="shrink-0" /> <span className="truncate">{place}</span>
      </p>
    ) : null
  }
  if (!event.orgName) return <div className="py-1"><Owner event={event} fallbackKey="agenda.owner_none" /></div>
  const Tag = open ? 'button' : 'span'
  return (
    <Tag {...(open ? { type: 'button', onClick: (e) => { e.preventDefault(); e.stopPropagation(); open(e) } } : {})}
      className={`relative z-[1] inline-flex max-w-full items-center gap-2 py-1 text-left font-display text-[13.5px] font-bold leading-none text-ink-900 ${past ? 'opacity-70' : ''}`}>
      {event.orgLogo
        ? <img src={event.orgLogo} alt="" className="h-6 w-6 flex-none rounded-full object-cover" />
        : <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-ink-900 text-[9.5px] font-extrabold text-lime-400">{initials(event.orgName)}</span>}
      <span className="truncate">{event.orgName}</span>
      {open && <span className="text-[#8A8E95]">›</span>}
    </Tag>
  )
}

/* ─── Evento de um clube da Comunidade onde ainda não estou (Fase 2) ───────
   Sem nomes de jogadores (decisão do Francisco, 16 set): só quantos vão, o
   nível médio e que um amigo que sigo é membro do clube. O cartão não abre o
   mix (só para membros), mas o cabeçalho abre a página do clube, que se vê
   de fora; o botão é entrar no clube ou pedir para entrar. */

const exploreGenders = (avgGender, restriction) => {
  if (avgGender === 'misto') return ['masculino', 'feminino']
  const g = avgGender || restriction
  return g === 'masculino' || g === 'feminino' ? [g] : []
}

export function ExploreEventCard({ event, profile, distance = null, onJoin = null, busy = false }) {
  const { t, i18n } = useTranslation()
  const game = event.raw
  const { openJoin, requestStatus, peopleCount, avgRating, avgGender, friendsInOrg } = event.explore
  const capacity = mixCapacity(game)
  const time = formatTime(event.startsAt, i18n.language, { hour: '2-digit', minute: '2-digit' })
  const pending = requestStatus === 'pending'

  let mismatchKey = null
  if (profile && !pending) {
    if (isGenderMismatch(game, profile) || isAgeIneligible(game, profile)) {
      mismatchKey = 'agenda.state_not_for_you'
    } else if (game.level) {
      const mine = ratingBand(profile.rating, profile.gender)
      if (mine?.fullVars?.num != null && String(mine.fullVars.num) !== levelNumber(game.level)) mismatchKey = 'agenda.state_other_level'
    }
  }

  // R1 (13 out): a mesma moldura dos outros cartões. Sem nomes nem caras de
  // quem vai (Francisco, 16 set): à direita da faixa, só quantos vão.
  const level = event.kind === 'mix' && parseLevel(game.level) ? `${parseLevel(game.level).scale}${parseLevel(game.level).num}` : null
  const label = [t(KIND_STYLE[event.kind]?.labelKey || 'agenda.kind_mix'), level, !openJoin ? t('agenda.explore_private') : null].filter(Boolean).join(' · ')
  const endsAt = game.court_time_minutes ? formatTime(new Date(new Date(game.date).getTime() + game.court_time_minutes * 60000), i18n.language, HM) : null
  const pill = !pending && mismatchKey ? <BandPill tone="dark">{t(mismatchKey)}</BandPill> : null
  const chips = [
    game.origin === 'open_slot' ? t('openday.players', { count: capacity }) : t(formatLabelKey(game)),
    game.origin !== 'open_slot' ? t('gamedetails.court_count', { count: game.num_courts || 1 }) : null,
    game.gender_restriction && !['indiferente', 'misto'].includes(game.gender_restriction) ? t(GENDER_RESTRICTION_LABEL_KEY[game.gender_restriction]) : null,
    game.age_restriction && AGE_LABEL_KEY[game.age_restriction] ? t(AGE_LABEL_KEY[game.age_restriction]) : null,
    distance != null ? t('agenda.distance_km', { km: distance < 10 ? distance.toFixed(1).replace('.0', '') : Math.round(distance) }) : null,
  ].filter(Boolean)
  return (
    <HomeCard colors={kindColorsOf(event.kind)} label={label} pill={pill} time={time}
      timeAside={endsAt ? t('homecard.until', { time: endsAt }) : null}
      count={{ n: peopleCount, of: capacity, unit: t('homecard.unit_signed') }}
      imageUrl={game.image_url || null}>
      <CardClub event={event} />
      <CardTitle>{game.title}</CardTitle>
      <CardChips>
        {chips.join(' · ')}
        {game.price_per_player > 0 && <> · <PriceText game={game} /></>}
      </CardChips>
      {friendsInOrg.length > 0 && (
        <span className="mt-2 inline-block max-w-full truncate rounded-full bg-lime-50 px-[9px] py-[5px] font-display text-[12px] font-bold leading-none text-[#4A5A00]">
          {friendsInOrg.length === 1
            ? t('agenda.friend_member_one', { name: friendsInOrg[0] })
            : t('agenda.friend_member_many', { name: friendsInOrg[0], count: friendsInOrg.length - 1 })}
        </span>
      )}
      {pending && <CardState tone="warn">{t('agenda.state_line_request_sent')}</CardState>}
      {/* O nível médio de quem vai, com o nome à frente (QA, 13 out: a
          pastilha sozinha não se percebia). A letra vem do avg_gender. Numa
          linha sua, para os círculos caberem ao lado do botão. */}
      {peopleRatingBand(avgRating, exploreGenders(avgGender, game.gender_restriction)) && (
        <span className="mt-2 flex items-center gap-1.5 font-display text-[12px] font-semibold text-[#5B6068]">
          {t('homecard.avg_level')}
          <GroupLevelBadge rating={avgRating} genders={exploreGenders(avgGender, game.gender_restriction)} />
        </span>
      )}
      <div className="mt-3 flex items-center gap-2.5">
        {/* Sem a lista de quem vai: quantos já estão num círculo cinzento e os
            lugares que faltam a tracejado (R1; UX, 14 out). */}
        <FaceCircles count={peopleCount || 0} free={Math.max(0, capacity - (peopleCount || 0))} size="sm" />
        {!pending && onJoin && (
          <div className="relative ml-auto">
            <CardButton variant={openJoin ? 'lime' : 'out'} disabled={busy} onClick={onJoin}>
              {openJoin ? t('agenda.explore_join_club') : t('agenda.explore_request', { name: event.orgName })}
            </CardButton>
          </div>
        )}
      </div>
    </HomeCard>
  )
}

/* ─── Jogo entre amigos (dentro de um grupo, ou fora de clubes) ─────────── */

const SLOTS = ['team_a_player1', 'team_a_player2', 'team_b_player1', 'team_b_player2']

/** O nome de um jogo entre amigos, que não tem título: «Tu + Ana vs Rui + Zé».
 *  O próprio aparece como "Tu". Usado no cartão e na pesquisa da Home (#547). */
export function friendsMatchTitle(m, userId, t) {
  const nameOf = (slot) => (m[`${slot}_id`] && m[`${slot}_id`] === userId ? t('agenda.you') : m[`${slot}_name`] || m[`${slot}_guest_name`] || null)
  const team = (prefix) => [nameOf(`${prefix}_player1`), nameOf(`${prefix}_player2`)].filter(Boolean)
  const teamA = team('team_a')
  const teamB = team('team_b')
  return teamB.length ? `${teamA.join(' + ')} ${t('gamedetails.vs')} ${teamB.join(' + ')}` : teamA.join(' + ')
}

/* Um jogo entre amigos a rodar, num cartão só (desenho da UX, 27 set):
   «Jogo entre amigos · a rodar», «Com Ruben, Claudia e mais 3», as pessoas
   da sessão (6/6); a decorrer «Ronda 2 de 5», acabado «5 jogos · ganhaste 3».
   Tocar abre a sessão. */
export function FriendSessionCard({ event, userId, past = false }) {
  const { t, i18n } = useTranslation()
  const games = event.raw.games
  const people = new Map()
  for (const g of games) {
    for (const s of SLOTS) {
      const id = g[`${s}_id`]
      const guest = g[`${s}_guest_name`]
      if (!id && !guest) continue
      const k = id || `g:${guest}`
      if (!people.has(k)) people.set(k, { id, name: id === userId ? t('agenda.you') : g[`${s}_name`] || guest, avatar_url: g[`${s}_avatar`], me: id === userId })
    }
  }
  const all = [...people.values()]
  // Nomes curtos («Teste X. 1», «Rita F.»): só o primeiro nome deixava
  // iguais duas pessoas com o mesmo (QA, 13 out).
  const others = all.filter((p) => !p.me).map((p) => shortPersonName(p.name)).filter(Boolean)
  // Quem joga lê «Com Rita, Tiago e mais 3»; quem não joga (página do
  // grupo) lê «Rita, Tiago e mais 4», sem o «Com» (UX, 27 set).
  const inSession = all.some((p) => p.me)
  const k = inSession ? 'session_title' : 'session_names'
  const title = others.length > 2
    ? t(`agenda.${k}_more`, { a: others[0], b: others[1], count: others.length - 2 })
    : others.length === 2 ? t(`agenda.${k}_two`, { a: others[0], b: others[1] })
      : t(`agenda.${k}_one`, { a: others[0] || '' })
  const done = (g) => g.score_a != null && g.score_b != null
  const played = games.filter(done)
  const wins = played.filter((g) => {
    const slot = SLOTS.find((s) => g[`${s}_id`] === userId)
    const team = slot ? slot.slice(0, 6).replace('team_', '') : null
    return team && g.winner_team === team
  }).length
  const running = !event.finished && (played.length > 0 || games.some((g) => g.started_at))
  const facts = event.finished
    ? (inSession ? t('agenda.session_done', { count: games.length, wins }) : t('agenda.session_done_plain', { count: games.length }))
    : running ? t('agenda.session_round', { n: games.findIndex((g) => !done(g)) + 1, total: games.length }) : null
  // Só quem jogou abre a sessão; no grupo, para os outros, não se toca
  // (o Francisco não aprovou abrir a sessão a quem não jogou, 27 set).
  const to = !inSession ? null : event.id ? `/jogos-privados/sessao/${event.id}` : '/jogos-privados'
  const m = event.raw

  // O ranking: antes de enviar, o que se escolheu ao criar; depois, o que
  // aconteceu (session_ranking_state, Dev 3). Sem ele, não se diz nada — dizia
  // «Conta para o ranking» num jogo com convidados que não contou (QA, 12 out).
  const rankingState = m.session_ranking_state
  const rankingText = !event.finished ? (m.ranked_intent ? t('agenda.friends_ranked') : t('gamedetails.badge_friendly'))
    : rankingState === 'counted' ? t('friends.list_counted')
      : rankingState === 'waiting' ? t('friends.list_waiting_some')
        : rankingState === 'rejected' ? t('friends.list_rejected')
          : rankingState === 'not_ranked' ? t('friends.list_friendly') : null

  // R1 (13 out): a moldura comum. Num clube é «Jogo em aberto», na cor do
  // aberto; num grupo, «Jogo entre amigos» (Francisco, 28 set).
  const sessionKindKey = event.kind === 'open' ? 'open' : 'friends'
  const label = [t(KIND_STYLE[sessionKindKey].labelKey), m.pairing_mode === 'rotating' ? t('agenda.session_rotating') : null].filter(Boolean).join(' · ')
  let pill = null
  if (past || event.finished) pill = <BandPill tone="dark">{t('agenda.state_finished')}</BandPill>
  else if (running) pill = <BandPill tone="dark">▶ {t('ui.status_live')}</BandPill>
  else if (inSession) pill = <BandPill>✓ {t('home.next_in')}</BandPill>
  return (
    <HomeCard colors={kindColorsOf(sessionKindKey)} label={label} pill={pill}
      time={event.hasTime ? formatTime(event.startsAt, i18n.language, HM) : '—'}
      count={{ n: all.length, of: all.length, unit: t('homecard.unit_players') }}
      mine={inSession && !event.finished} past={past} to={to} ariaLabel={title}>
      <CardClub event={event} past={past} place={m.location || null} />
      <CardTitle past={past}>{title}</CardTitle>
      <CardChips>{[event.orgName ? m.location : null, rankingText, facts].filter(Boolean).join(' · ')}</CardChips>
      {/* A lotação são as pessoas da sessão (6/6), não os 4 de um jogo. */}
      <CardFoot people={all} slots={all.length}>
        {inSession && !past && !event.finished && (
          <span className="pointer-events-none whitespace-nowrap rounded-[14px] border-[1.5px] border-[#CFD2D7] bg-white px-[18px] py-[11px] font-display text-[14.5px] font-extrabold leading-none text-ink-900">{t('homecard.see')}</span>
        )}
      </CardFoot>
    </HomeCard>
  )
}

export function FriendsEventCard({ event, userId, orgSlug = null, invite = null, past = false }) {
  const { t, i18n } = useTranslation()
  if (event.source === 'friend_session') return <FriendSessionCard event={event} userId={userId} past={past} />
  const m = event.raw
  // O próprio aparece como "Tu": o cartão é lido por quem está nele.
  const nameOf = (slot) => (m[`${slot}_id`] && m[`${slot}_id`] === userId ? t('agenda.you') : m[`${slot}_name`] || m[`${slot}_guest_name`] || null)
  const players = SLOTS
    .filter((s) => m[`${s}_id`] || m[`${s}_guest_name`])
    .map((s) => ({ id: m[`${s}_id`], name: nameOf(s), avatar_url: m[`${s}_avatar`] }))
  const mySlot = SLOTS.find((s) => m[`${s}_id`] === userId)
  const myTeam = mySlot ? mySlot.slice(0, 6).replace('team_', '') : null // 'a' | 'b'
  const ranked = event.source === 'private_match' ? m.ranked_intent : m.ranked
  const to = event.source === 'private_match' ? '/jogos-privados' : orgSlug ? `/clube/${orgSlug}/jogos` : null

  const title = friendsMatchTitle(m, userId, t)

  let state = null
  if (past || event.finished) state = <StateTag tone="grey" icon={CheckCircle2}>{t('agenda.state_finished')}</StateTag>
  else if (event.myState === 'invited') state = <StateTag tone="invited">{t('agenda.state_invited')}</StateTag>
  else if (event.mine) state = <StateTag tone="in" icon={CheckCircle2}>{t('agenda.state_in')}</StateTag>

  // Empate (jogo entre amigos, #420): nem vitória nem derrota.
  const draw = event.finished && m.winner_team === 'draw'
  const won = event.finished && myTeam && m.winner_team && !draw ? m.winner_team === myTeam : null

  // R1 (13 out): a moldura comum. Vagas: as pessoas do jogo (4).
  const time = event.hasTime ? formatTime(event.startsAt, i18n.language, HM) : '—'
  const label = t('agenda.kind_friends')
  let pill = null
  if (past || event.finished) pill = <BandPill tone="dark">{t('agenda.state_finished')}</BandPill>
  else if (event.myState === 'invited') pill = <BandPill tone="dark">{t('agenda.state_invited')}</BandPill>
  else if (event.mine) pill = <BandPill>✓ {t('home.next_in')}</BandPill>
  const result = event.finished && m.score_a != null
    ? <span className="text-xs font-extrabold text-ink-900 tabular-nums">{m.score_a}-{m.score_b}{draw ? <> · {t('agenda.result_draw')}</> : won != null && <> · {t(won ? 'agenda.result_win' : 'agenda.result_loss')}</>}</span>
    : null
  const showInvite = invite && !(event.finished && m.score_a != null)
  return (
    <HomeCard colors={kindColorsOf('friends')} label={label} pill={pill} time={time}
      count={{ n: players.length, of: 4, unit: t('homecard.unit_players') }}
      mine={event.mine && event.myState !== 'invited'} past={past} to={to} ariaLabel={title}>
      <CardClub event={event} past={past} place={m.location || null} />
      <CardTitle past={past}>{title}</CardTitle>
      <CardChips>{[event.orgName ? m.location : null, ranked ? t('agenda.friends_ranked') : t('gamedetails.badge_friendly')].filter(Boolean).join(' · ')}</CardChips>
      <CardFoot people={players} slots={4}>
        {result || (showInvite ? (
          <>
            <CardButton disabled={invite.busy} onClick={invite.onAccept}>{t('agenda.invite_accept')}</CardButton>
            <button type="button" disabled={invite.busy} onClick={(e) => { e.preventDefault(); e.stopPropagation(); invite.onReject() }}
              className="relative p-1 font-display text-[12.5px] font-bold leading-none text-[#4F535A] underline underline-offset-[3px] disabled:opacity-40">
              {t('agenda.invite_reject')}
            </button>
          </>
        ) : null)}
      </CardFoot>
    </HomeCard>
  )
}
