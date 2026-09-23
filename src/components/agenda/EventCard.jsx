import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { MapPin, CheckCircle2, Lock, Play, Trophy, Euro, Swords, Users, Shuffle, CircleDot, Clock, ListOrdered, GraduationCap } from 'lucide-react'
import { PlayerAvatarRow, GroupLevelBadge, PrimaryButton } from '../ui'
import { formatTime, formatCurrency } from '../../lib/formatDate'
import { FORMAT_LABEL_KEY, GENDER_RESTRICTION_LABEL_KEY, mixCapacity, isGenderMismatch, isAgeIneligible } from '../../lib/mixLogic'
import { AGE_LABEL_KEY } from '../../lib/ageCategories'
import { ratingBand } from '../../lib/elo'

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
   Nenhum tipo usa verde, âmbar, lima ou preto. Lima só no botão principal e
   em "A decorrer". As classes são literais completos — o Tailwind não vê
   classes montadas.
   ════════════════════════════════════════════════════════════════════════ */

// `color` = cor do texto da etiqueta, também usada nos pinos do mapa
// (MapView.jsx, opção A escolhida pelo Francisco a 17 set).
export const KIND_STYLE = {
  mix:        { card: 'bg-[#E0F2FE] border-[#A5D8F5]', bg: 'bg-[#E0F2FE]', text: 'text-[#075985]', color: '#075985', icon: Shuffle,     labelKey: 'agenda.kind_mix' },
  open:       { card: 'bg-[#FBE7DE] border-[#F2BFA8]', bg: 'bg-[#FBE7DE]', text: 'text-[#9A3A17]', color: '#9A3A17', icon: CircleDot,   labelKey: 'agenda.kind_open' },
  friends:    { card: 'bg-[#F2EDE4] border-[#DCD1BF]', bg: 'bg-[#F2EDE4]', text: 'text-[#6B5B45]', color: '#6B5B45', icon: Users,       labelKey: 'agenda.kind_friends' },
  // Aulas com professores (Trello #49) — turquesa, SPEC das aulas §9.
  lesson:     { card: 'bg-[#CCFBF1] border-[#8FE3D6]', bg: 'bg-[#CCFBF1]', text: 'text-[#0F766E]', color: '#0F766E', icon: GraduationCap, labelKey: 'agenda.kind_lesson' },
  // Ainda não existem na app — só preparados para a cor (fora de âmbito).
  tournament: { card: 'bg-[#E9E7FB] border-[#C9C3F3]', bg: 'bg-[#E9E7FB]', text: 'text-[#4338A8]', color: '#4338A8', icon: Trophy,      labelKey: 'agenda.kind_tournament' },
  league:     { card: 'bg-[#FAE3EC] border-[#F0BCD1]', bg: 'bg-[#FAE3EC]', text: 'text-[#8C2350]', color: '#8C2350', icon: ListOrdered, labelKey: 'agenda.kind_league' },
}

const ACTION_LABEL_KEY = {
  join: 'ui.action_join',
  waitlist: 'ui.action_waitlist',
  leave: 'ui.action_leave',
  leave_waitlist: 'ui.action_leave_waitlist',
}
const ACTION_VARIANT = {
  join: 'lime',
  waitlist: 'ghost',
  // Sair: contorno preto, como no desenho aprovado (cores.png).
  leave: 'ghost',
  leave_waitlist: 'ghost',
}

const initials = (name) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()

export function KindTag({ kind, past, suffix = null }) {
  const { t } = useTranslation()
  const style = KIND_STYLE[kind]
  const Icon = style.icon
  return (
    <span className={`inline-flex items-center gap-1 bg-white text-[11px] font-extrabold px-2 py-1 rounded-full ${style.text} ${past ? 'opacity-70' : ''}`}>
      <Icon size={12} /> {t(style.labelKey)}{suffix && <> · {suffix}</>}
    </span>
  )
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
    <span className={`inline-flex items-center gap-1 text-[11px] font-extrabold px-2 py-1 rounded-full whitespace-nowrap ${tones[tone]}`}>
      {Icon && <Icon size={12} />} {children}
    </span>
  )
}

/** Linha do dono: logótipo (quadrado = clube, redondo = grupo) + nome + tipo. */
export function Owner({ event, fallbackKey }) {
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
  return (
    <p className="flex items-center gap-1.5 text-sm text-ink-700 min-w-0">
      {event.orgLogo
        ? <img src={event.orgLogo} alt="" className={`w-5 h-5 object-cover shrink-0 ${isGroup ? 'rounded-full' : 'rounded-[5px]'}`} />
        : <span className={`w-5 h-5 text-[8px] font-extrabold flex items-center justify-center shrink-0 ${shape}`}>{initials(event.orgName)}</span>}
      <span className="truncate">{event.orgName} · {t(isGroup ? 'agenda.owner_group' : 'agenda.owner_club')}</span>
    </p>
  )
}

function cardFrame(event, past) {
  if (past) return 'bg-surface border border-line'
  // Contorno verde só quando estou mesmo dentro (ou em espera) — um convite
  // por responder ainda não é "meu" nesse sentido.
  // Lista de espera: âmbar tracejado — nunca verde (SPEC §3).
  if (event.myState === 'in') return `${KIND_STYLE[event.kind].bg} border-2 border-ok`
  if (event.myState === 'waitlist') return `${KIND_STYLE[event.kind].bg} border-2 border-dashed border-[#B86E00]`
  return `${KIND_STYLE[event.kind].card} border`
}

/* ─── Mix e jogo em aberto ──────────────────────────────────────────────── */

/** Local (+ distância) e a linha de factos — igual nos cartões de mix dos
    meus clubes e nos de explorar, para um mix não se descrever de duas formas. */
function GameFacts({ game, distance }) {
  const { t, i18n } = useTranslation()
  const genderRestricted = game.gender_restriction && !['indiferente', 'misto'].includes(game.gender_restriction)
  return (
    <>
      {(game.location || distance != null) && (
        <p className="flex items-center gap-1.5 text-ink-700 text-[13px] mt-1.5 min-w-0">
          <MapPin size={14} className="shrink-0" />
          <span className="truncate">{game.location}</span>
          {distance != null && (
            <span className="shrink-0 font-extrabold text-ink-900">{game.location ? '· ' : ''}{t('agenda.distance_km', { km: distance < 10 ? distance.toFixed(1).replace('.0', '') : Math.round(distance) })}</span>
          )}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-ink-700 text-[13px] mt-1.5">
        <span className="inline-flex items-center gap-1">
          <Swords size={14} className="shrink-0" />
          {t(FORMAT_LABEL_KEY[game.format] || FORMAT_LABEL_KEY.sobe_desce)} · {t('gamedetails.court_count', { count: game.num_courts || 1 })}
          {game.ranked === false && <> · {t('gamedetails.badge_friendly')}</>}
        </span>
        {game.price_per_player > 0 && (
          <span className="inline-flex items-center gap-1">
            <Euro size={14} className="shrink-0" />
            {t('gamedetails.price_per_player', { price: formatCurrency(game.price_per_player, i18n.language) })}
          </span>
        )}
        {game.prize && (
          <span className="inline-flex items-center gap-1 min-w-0">
            <Trophy size={14} className="shrink-0" /> <span className="truncate">{game.prize}</span>
          </span>
        )}
        {genderRestricted && <span className="font-extrabold text-ink-900">{t(GENDER_RESTRICTION_LABEL_KEY[game.gender_restriction])}</span>}
        {game.age_restriction && AGE_LABEL_KEY[game.age_restriction] && (
          <span className="font-extrabold text-ink-900">{t(AGE_LABEL_KEY[game.age_restriction])}</span>
        )}
      </div>
    </>
  )
}

export function GameEventCard({ event, profile, friendIds = null, action = null, result = null, past = false, distance = null }) {
  const { t, i18n } = useTranslation()
  const game = event.raw
  const players = (game.participants || [])
    .filter((p) => p.status === 'confirmed')
    .flatMap((p) => [
      { id: p.user_id, name: p.user?.name, rating: p.user?.rating, isGuest: p.user?.is_guest, avatar_url: p.user?.avatar_url },
      ...(p.partner_id ? [{ id: p.partner_id, name: p.partner?.name, rating: p.partner?.rating, isGuest: p.partner?.is_guest, avatar_url: p.partner?.avatar_url }] : []),
    ])
  // Convidados contam como jogadores mas não entram na média de nível.
  const rated = players.filter((p) => !p.isGuest && p.rating != null)
  const avgRating = rated.length ? rated.reduce((s, p) => s + p.rating, 0) / rated.length : null
  const capacity = mixCapacity(game)
  const isFull = players.length >= capacity
  const isClosed = game.status === 'closed' || (game.status === 'open' && isFull)
  const isLive = game.status === 'in_progress'
  const friendsIn = friendIds ? players.filter((p) => p.id && friendIds.has(p.id)) : []
  const time = formatTime(event.startsAt, i18n.language, { hour: '2-digit', minute: '2-digit' })

  // "Outro nível, género ou idade: aparece, marcado" (Francisco, 16 set).
  // Só para quem não está dentro — a quem já está inscrito não interessa.
  let mismatchKey = null
  if (!event.mine && !past && profile) {
    if (isGenderMismatch(game, profile) || isAgeIneligible(game, profile)) {
      mismatchKey = 'agenda.state_not_for_you'
    } else if (game.level) {
      const mine = ratingBand(profile.rating, profile.gender)
      if (mine?.fullVars?.num != null && String(mine.fullVars.num) !== game.level.slice(1)) {
        mismatchKey = 'agenda.state_other_level'
      }
    }
  }

  let state = null
  if (past || event.finished) state = <StateTag tone="grey" icon={CheckCircle2}>{t('agenda.state_finished')}</StateTag>
  else if (isLive) state = <StateTag tone="live" icon={Play}>{t('ui.status_live')}</StateTag>
  else if (event.myState === 'in') state = <StateTag tone="in" icon={CheckCircle2}>{t('agenda.state_in')}</StateTag>
  else if (event.myState === 'waitlist') state = <StateTag tone="wait">{t('agenda.state_waitlist')}</StateTag>
  else if (mismatchKey) state = <StateTag tone="grey">{t(mismatchKey)}</StateTag>

  return (
    <div className={`relative overflow-hidden rounded-card p-3.5 press ${cardFrame(event, past)}`}>
      <Link to={`/jogo/${game.id}`} className="absolute inset-0" aria-label={`${game.title} — ${time}`} />

      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {/* Recorrência como sufixo da etiqueta, igual à página do evento (Trello #383). */}
          <KindTag kind={event.kind} past={past} suffix={game.recurrence_id ? t('ui.recurring') : null} />
        </div>
        {state}
      </div>

      <p className={`text-[22px] font-extrabold leading-none mt-2.5 ${past ? 'text-muted' : 'text-ink-900'}`}>{time}</p>
      <h3 className={`text-base leading-snug mt-1.5 ${past ? 'text-muted' : 'text-ink-900'}`}>{game.title}</h3>
      <div className="mt-1"><Owner event={event} fallbackKey="agenda.owner_none" /></div>

      <GameFacts game={game} distance={distance} />

      {/* Nomes completos de propósito — regra assente no produto. */}
      {friendsIn.length > 0 && (
        <p className="inline-flex items-center gap-1.5 bg-lime-100 text-ink-900 rounded-full pl-2 pr-2.5 py-1 mt-2 max-w-full">
          <Users size={13} className="text-lime-600 shrink-0" />
          <span className="font-extrabold text-[11px] uppercase tracking-wider truncate">
            {friendsIn.length === 1
              ? t('ui.friend_in_mix_one', { name: friendsIn[0].name })
              : friendsIn.length === 2
                ? t('ui.friend_in_mix_two', { first: friendsIn[0].name, second: friendsIn[1].name })
                : t('ui.friend_in_mix_many', { name: friendsIn[0].name, count: friendsIn.length - 1 })}
          </span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 pt-2.5 mt-2.5 border-t border-ink-900/10">
        <div className="flex items-center gap-2.5 min-w-0">
          <PlayerAvatarRow players={players} max={capacity} size="sm" />
          <GroupLevelBadge rating={avgRating} />
        </div>
        {past ? (
          result && (
            <span className="ml-auto text-xs font-extrabold text-ink-900 tabular-nums">
              {result.mix_won
                ? t('agenda.result_won')
                : result.rating_delta != null
                  ? t('agenda.result_rating_delta', { delta: `${result.rating_delta > 0 ? '+' : ''}${Math.round(result.rating_delta)}` })
                  : null}
            </span>
          )
        ) : action ? (
          <PrimaryButton
            variant={ACTION_VARIANT[action.kind]}
            disabled={action.busy}
            onClick={() => action.onAction()}
            className={`ml-auto relative !py-2 !px-4 !text-sm ${action.kind.startsWith('leave') ? '!bg-white !border-ink-900' : ''}`}
          >
            {t(ACTION_LABEL_KEY[action.kind])}
          </PrimaryButton>
        ) : isClosed && !isLive && !event.finished && !mismatchKey ? (
          <span className="ml-auto inline-flex items-center gap-1.5 bg-surface text-ink-700 text-[11px] font-extrabold px-2.5 py-1 rounded-full">
            <Lock size={13} className="shrink-0" /> {t('ui.court_reserved')}
          </span>
        ) : null}
      </div>
    </div>
  )
}

/* ─── Evento de um clube da Comunidade onde ainda não estou (Fase 2) ───────
   Sem nomes de jogadores (decisão do Francisco, 16 set): só quantos vão, o
   nível médio e que um amigo que sigo é membro do clube. Não abre página —
   a página do mix e a do clube são só para membros — por isso tudo o que
   ajuda a decidir está aqui, e o botão é entrar no clube ou pedir para entrar. */

export function ExploreEventCard({ event, profile, distance = null, onJoin = null, busy = false }) {
  const { t, i18n } = useTranslation()
  const game = event.raw
  const { openJoin, requestStatus, peopleCount, avgRating, friendsInOrg } = event.explore
  const capacity = mixCapacity(game)
  const time = formatTime(event.startsAt, i18n.language, { hour: '2-digit', minute: '2-digit' })
  const pending = requestStatus === 'pending'

  let mismatchKey = null
  if (profile && !pending) {
    if (isGenderMismatch(game, profile) || isAgeIneligible(game, profile)) {
      mismatchKey = 'agenda.state_not_for_you'
    } else if (game.level) {
      const mine = ratingBand(profile.rating, profile.gender)
      if (mine?.fullVars?.num != null && String(mine.fullVars.num) !== game.level.slice(1)) mismatchKey = 'agenda.state_other_level'
    }
  }

  return (
    <div className={`relative overflow-hidden rounded-card p-3.5 border ${KIND_STYLE[event.kind].card}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          <KindTag kind={event.kind} />
          {!openJoin && (
            <span className="inline-flex items-center gap-1 bg-white/80 text-[11px] font-extrabold px-2 py-1 rounded-full text-muted">
              <Lock size={12} /> {t('agenda.explore_private')}
            </span>
          )}
        </div>
        {pending
          ? <StateTag tone="grey" icon={Clock}>{t('agenda.state_request_sent')}</StateTag>
          : mismatchKey && <StateTag tone="grey">{t(mismatchKey)}</StateTag>}
      </div>

      <p className="text-[22px] font-extrabold leading-none mt-2.5 text-ink-900">{time}</p>
      <h3 className="text-base leading-snug mt-1.5 text-ink-900">{game.title}</h3>
      <div className="mt-1"><Owner event={event} fallbackKey="agenda.owner_none" /></div>

      <GameFacts game={game} distance={distance} />

      {friendsInOrg.length > 0 && (
        <p className="inline-flex items-center gap-1.5 bg-lime-100 text-ink-900 rounded-full pl-2 pr-2.5 py-1 mt-2 max-w-full">
          <Users size={13} className="text-lime-600 shrink-0" />
          <span className="font-extrabold text-[11px] uppercase tracking-wider truncate">
            {friendsInOrg.length === 1
              ? t('agenda.friend_member_one', { name: friendsInOrg[0] })
              : t('agenda.friend_member_many', { name: friendsInOrg[0], count: friendsInOrg.length - 1 })}
          </span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 pt-2.5 mt-2.5 border-t border-ink-900/10">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center gap-1 text-sm text-ink-700 tabular-nums">
            <Users size={14} /> <span className="font-extrabold text-ink-900">{peopleCount}</span>/{capacity}
          </span>
          <GroupLevelBadge rating={avgRating} />
        </div>
        {!pending && onJoin && (
          <PrimaryButton
            variant={openJoin ? 'lime' : 'ghost'}
            disabled={busy}
            onClick={onJoin}
            className="ml-auto relative !py-2 !px-4 !text-sm"
          >
            {openJoin ? t('agenda.explore_join_club') : t('agenda.explore_request', { name: event.orgName })}
          </PrimaryButton>
        )}
      </div>
    </div>
  )
}

/* ─── Jogo entre amigos (dentro de um grupo, ou fora de clubes) ─────────── */

const SLOTS = ['team_a_player1', 'team_a_player2', 'team_b_player1', 'team_b_player2']

export function FriendsEventCard({ event, userId, orgSlug = null, invite = null, past = false }) {
  const { t, i18n } = useTranslation()
  const m = event.raw
  // O próprio aparece como "Tu": o cartão é lido por quem está nele.
  const nameOf = (slot) => (m[`${slot}_id`] && m[`${slot}_id`] === userId ? t('agenda.you') : m[`${slot}_name`] || m[`${slot}_guest_name`] || null)
  const team = (prefix) => [nameOf(`${prefix}_player1`), nameOf(`${prefix}_player2`)].filter(Boolean)
  const players = SLOTS
    .filter((s) => m[`${s}_id`] || m[`${s}_guest_name`])
    .map((s) => ({ id: m[`${s}_id`], name: nameOf(s), avatar_url: m[`${s}_avatar`] }))
  const mySlot = SLOTS.find((s) => m[`${s}_id`] === userId)
  const myTeam = mySlot ? mySlot.slice(0, 6).replace('team_', '') : null // 'a' | 'b'
  const ranked = event.source === 'private_match' ? m.ranked_intent : m.ranked
  const to = event.source === 'private_match' ? '/jogos-privados' : orgSlug ? `/clube/${orgSlug}/jogos` : null

  const teamA = team('team_a')
  const teamB = team('team_b')
  const title = teamB.length
    ? `${teamA.join(' + ')} ${t('gamedetails.vs')} ${teamB.join(' + ')}`
    : teamA.join(' + ')

  let state = null
  if (past || event.finished) state = <StateTag tone="grey" icon={CheckCircle2}>{t('agenda.state_finished')}</StateTag>
  else if (event.myState === 'invited') state = <StateTag tone="invited">{t('agenda.state_invited')}</StateTag>
  else if (event.mine) state = <StateTag tone="in" icon={CheckCircle2}>{t('agenda.state_in')}</StateTag>

  // Empate (jogo entre amigos, #420): nem vitória nem derrota.
  const draw = event.finished && m.winner_team === 'draw'
  const won = event.finished && myTeam && m.winner_team && !draw ? m.winner_team === myTeam : null

  return (
    <div className={`relative overflow-hidden rounded-card p-3.5 ${to ? 'press' : ''} ${cardFrame(event, past)}`}>
      {to && <Link to={to} className="absolute inset-0" aria-label={title} />}

      <div className="flex items-start justify-between gap-2">
        <KindTag kind="friends" past={past} />
        {state}
      </div>

      {event.hasTime ? (
        <p className={`text-[22px] font-extrabold leading-none mt-2.5 ${past ? 'text-muted' : 'text-ink-900'}`}>
          {formatTime(event.startsAt, i18n.language, { hour: '2-digit', minute: '2-digit' })}
        </p>
      ) : (
        <p className="flex items-center gap-1 text-xs font-extrabold text-muted mt-2.5"><Clock size={12} /> {t('agenda.no_time')}</p>
      )}
      <h3 className={`text-base leading-snug mt-1.5 ${past ? 'text-muted' : 'text-ink-900'}`}>{title}</h3>
      <div className="mt-1"><Owner event={event} fallbackKey="agenda.owner_friends" /></div>

      {m.location && (
        <p className="flex items-center gap-1.5 text-ink-700 text-[13px] mt-1.5">
          <MapPin size={14} className="shrink-0" /> <span className="truncate">{m.location}</span>
        </p>
      )}
      <p className="text-ink-700 text-[13px] mt-1.5">
        {ranked ? t('agenda.friends_ranked') : t('gamedetails.badge_friendly')}
      </p>

      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 pt-2.5 mt-2.5 border-t border-ink-900/10">
        <div className="flex items-center gap-2 min-w-0">
          <PlayerAvatarRow players={players} max={4} size="sm" />
        </div>
        {event.finished && m.score_a != null ? (
          <span className="ml-auto text-xs font-extrabold text-ink-900 tabular-nums">
            {m.score_a}-{m.score_b}{draw ? <> · {t('agenda.result_draw')}</> : won != null && <> · {t(won ? 'agenda.result_win' : 'agenda.result_loss')}</>}
          </span>
        ) : invite ? (
          <div className="ml-auto flex items-center gap-1.5 relative">
            <PrimaryButton variant="ghost" disabled={invite.busy} onClick={invite.onReject} className="!py-2 !px-3.5 !text-sm">
              {t('agenda.invite_reject')}
            </PrimaryButton>
            <PrimaryButton disabled={invite.busy} onClick={invite.onAccept} className="!py-2 !px-3.5 !text-sm">
              {t('agenda.invite_accept')}
            </PrimaryButton>
          </div>
        ) : null}
      </div>
    </div>
  )
}
