// As secções da página do clube e do grupo (Trello #419; desenho aprovado
// pelo Francisco a 24 set, design-handoff/2026-09-23-pagina-do-grupo/
// SPEC.md). Uma página que se desce, sem separadores, a mesma para clube e
// grupo: cabeçalho · o que vem aí · pessoas · (grupos do clube) · jogos
// entre membros · sobre. O clube só ACRESCENTA professores, grupos, local e
// contactos — não é outra página.
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Check, ChevronLeft, ChevronRight, Clock, Globe, Heart, Instagram, Lock, Phone, Plus, Share2 } from 'lucide-react'
import KindHero from '../KindHero'
import GlassBar, { GLASS_ROUND, GlassPinned, useUnderBar } from '../GlassBar'
import Alino from '../Alino'
import LocationOpenWith from '../LocationOpenWith'
import { formatLabelKey } from '../../lib/mixLogic'
import { formatCurrency } from '../../lib/formatDate'
import { CLUB_HERO, GROUP_HERO } from '../../lib/kindColors'
import { coverOf, useOrgCovers } from '../../lib/orgCover'
import { Avatar, ConfirmSheet, PrimaryButton, Tabs } from '../ui'
import { supabase } from '../../lib/supabase'
import { describeError, errorKind } from '../../lib/errors'
import { KIND_STYLE, CardClub } from '../agenda/EventCard'
import HomeCard, { BandPill, CardTitle, CardChips, CardState, CardButton, kindColorsOf } from '../agenda/HomeCard'
import FaceCircles from '../event/FaceCircles'
import { toDayKey, fromDayKey, addDays } from '../../lib/agenda'
import { formatDate } from '../../lib/formatDate'
import { SkeletonGate, SkBlock } from '../Skeleton'
import { daysAside, shortDay } from '../event/heroDates'

const asWebsiteUrl = (value) => (/^https?:\/\//i.test(value) ? value : `https://${value}`)
const asInstagramUrl = (value) => (/^https?:\/\//i.test(value)
  ? value : `https://instagram.com/${value.trim().replace(/^@/, '')}`)

/** Símbolo do dono: quadrado (cantos de 28%) = clube, redondo = grupo
 *  (regra de 18 set; confirmada pela UX a 13 out). */
function Symbol({ club, size = 'w-14 h-14 text-lg' }) {
  const shape = club.kind === 'group' ? 'rounded-full' : 'rounded-[28%]'
  if (club.group_logo_url) {
    return <img src={club.group_logo_url} alt="" className={`${size} shrink-0 object-cover ${shape}`} />
  }
  const initials = (club.name || '?').split(/\s+/).filter(Boolean).slice(0, 1).map((w) => w[0]).join('').toUpperCase()
  return (
    <span className={`${size} flex shrink-0 items-center justify-center bg-ink-900 font-extrabold text-lime-400 ${shape}`}>
      {initials}
    </span>
  )
}

/* ── Cabeçalho (R5 do redesign, 13 out) ────────────────────────────────
   design-handoff/2026-10-13-redesign/R5-clube-e-grupo.md. O topo a toda a
   largura com o Alino do clube ou do grupo (R0; a foto do clube entra
   quando houver onde a guardar — dados novos, para 23), e nos cantos «‹»,
   ♡ favorito (só para membros) e partilhar, em botões redondos. O cartão
   branco sobe por cima, com o logótipo a passar por cima do topo, o nome e
   «Clube · Lisboa · 48 membros». Por baixo, UM botão a toda a largura:
   «Entrar» (lima) ou «Pedir para entrar» (contorno); dentro, a caixa
   verde-clara «✓ És membro» (tocar pergunta se queres sair, como o «A
   seguir» de antes); com o pedido feito, a cinzenta «⏳ Pedido enviado» e
   «Cancelar pedido». O favorito saiu de ao lado do botão (nunca lado a
   lado). Só aspeto: as ações são as de antes. */
export function ClubHeader({ club, isFavorite, acting, favoriting, onFollow, onUnfollow, onCancelRequest, onToggleFavorite, onBack = null, onShare = null }) {
  const { t } = useTranslation()
  const kk = (key) => (club.kind === 'group' ? `${key}_group` : key)
  const [asking, setAsking] = useState(false)
  // A capa escolhida no Gerir (o get_club_profile não a traz).
  const covers = useOrgCovers([club.id])
  const [askingCancel, setAskingCancel] = useState(false)
  const member = club.my_status === 'member'
  // «Clube · <cidade> · N membros» (R5). Os dados só têm a morada inteira,
  // que fica em «Sobre»: sem cidade, «Clube · N membros» (UX, 13 out).
  const sub = [
    { text: t(club.kind === 'group' ? 'clubprofile.kind_group' : 'clubprofile.kind_club'), long: false },
    club.kind !== 'group' && club.city ? { text: club.city, long: true } : null,
    club.member_count != null ? { text: t('clubprofile.member_count', { count: club.member_count }), long: false } : null,
  ].filter(Boolean)
  // O «‹», o ♡ e o partilhar sempre no mesmo sítio, presos em cima em
  // círculos de vidro, também por cima da foto (GlassBar; Francisco, 15 out:
  // nada muda de sítio). O vidro e o nome entram juntos quando o nome grande
  // chega aos botões, numa troca cruzada com ele (UX).
  const coverRef = useRef(null)
  const nameRef = useRef(null)
  const rowRef = useRef(null)
  const under = useUnderBar(nameRef, rowRef, [], { lastLine: true })
  // O vidro entra com a primeira linha do nome; o nome sobe para a barra com
  // a última (UX, 15 out).
  const firstUnder = useUnderBar(nameRef, rowRef)
  const coverGone = useUnderBar(coverRef, rowRef, [], { edge: 'bottom' })

  return (
    // Sai das margens da página, como o topo dos eventos (R3).
    <div className="-mx-4 -mt-6">
      <GlassBar anchorRef={coverRef} rowRef={rowRef} filled={under || firstUnder} strip={coverGone} showTitle={under} title={club.name} wide={member && !!onShare}
        left={onBack ? <button type="button" onClick={onBack} aria-label={t('common.back')} className={GLASS_ROUND}><ChevronLeft size={22} /></button> : null}
        right={<>
          {member && (
            <button type="button" onClick={onToggleFavorite} disabled={favoriting}
              aria-label={isFavorite ? t('clubprofile.remove_favorite') : t('clubprofile.mark_favorite')}
              title={isFavorite ? t('clubprofile.remove_favorite') : t(kk('clubprofile.mark_favorite_title'))}
              aria-pressed={isFavorite} className={`${GLASS_ROUND} disabled:opacity-50`}>
              <Heart size={19} className={isFavorite ? 'fill-lime-400 text-lime-600' : ''} />
            </button>
          )}
          {onShare && <button type="button" onClick={onShare} aria-label={t('ui.share')} className={GLASS_ROUND}><Share2 size={18} /></button>}
        </>} />
      <div ref={coverRef}>
      <KindHero kind="club" src={coverOf(club, covers[club.id])} className="relative h-40">
      </KindHero>
      </div>

      <div className="relative -mt-5 rounded-t-[22px] bg-white px-4 pb-0">
        <div className="flex items-end gap-3.5">
          {/* O logótipo grande, a passar por cima do topo. */}
          <span className={`-mt-7 bg-white p-[3px] ${club.kind === 'group' ? 'rounded-full' : 'rounded-[28%]'}`}>
            <Symbol club={club} size="w-[58px] h-[58px] text-xl" />
          </span>
          <div className="min-w-0 flex-1 pt-3">
            <h1 ref={nameRef} className={`font-display text-2xl font-extrabold leading-tight text-ink-900 [overflow-wrap:anywhere] transition-opacity duration-fast ${under ? 'opacity-0' : 'opacity-100'}`}>{club.name}</h1>
          </div>
        </div>
        <p className="mt-1 text-sm text-muted">
          {sub.map((part, i) => (
            <span key={i} className={part.long ? '[overflow-wrap:anywhere]' : 'whitespace-nowrap'}>{i > 0 && ' · '}{part.text}</span>
          ))}
        </p>

        <div className="mt-4">
          {member ? (
            <button type="button" onClick={() => setAsking(true)} disabled={acting}
              className="flex min-h-[38px] w-full items-center justify-center gap-1.5 rounded-[14px] bg-[#F4F8DC] py-3 font-display text-[14px] font-extrabold leading-none text-[#3F6212] disabled:opacity-40">
              <Check size={15} /> {t('clubprofile.is_member')}
            </button>
          ) : club.my_status === 'pending' ? (
            <div>
              <span className="flex min-h-[38px] w-full items-center justify-center gap-1.5 rounded-[14px] bg-[#F4F5F1] py-3 font-display text-[14px] font-extrabold leading-none text-ink-500">
                <Clock size={15} /> {t('clubprofile.request_sent')}
              </span>
              <p className="mt-1.5 text-center text-[13px] text-muted">{t(kk('clubprofile.request_waiting'))}</p>
              {onCancelRequest && (
                <button type="button" onClick={() => setAskingCancel(true)} disabled={acting}
                  className="mt-3 flex min-h-[48px] w-full items-center justify-center rounded-ctrl border-[1.5px] border-ink-900 bg-white text-base font-extrabold text-ink-900 disabled:opacity-40">
                  {t('lessons.cancel_request')}
                </button>
              )}
            </div>
          ) : club.open_join ? (
            <PrimaryButton onClick={onFollow} disabled={acting} className="w-full">{t('clubprofile.follow_button')}</PrimaryButton>
          ) : (
            <PrimaryButton variant="ghost" onClick={onFollow} disabled={acting} className="w-full !border-ink-900">{t('clubprofile.request_join_button')}</PrimaryButton>
          )}
        </div>
      </div>

      <ConfirmSheet
        open={asking}
        danger
        title={t('clubprofile.unfollow_title', { name: club.name })}
        message={t(kk('clubprofile.unfollow_consequence'))}
        cancelLabel={t('clubprofile.keep_following')}
        confirmLabel={t('clubprofile.unfollow_yes')}
        onConfirm={onUnfollow}
        onClose={() => setAsking(false)}
        // Sem ligação ou sessão: a frase de sempre. O resto: a do clube/grupo,
        // nunca a mensagem técnica da base de dados.
        errorOf={(err) => (['offline', 'session'].includes(errorKind(err)) ? describeError(t, err) : t(kk('clubprofile.error_unfollow')))}
      />
      {onCancelRequest && (
        <ConfirmSheet
          open={askingCancel}
          danger
          title={t('booking.cancel_title')}
          message={t(kk('clubprofile.cancel_request_text'))}
          confirmLabel={t('booking.cancel_confirm')}
          cancelLabel={t('booking.cancel_keep')}
          onConfirm={onCancelRequest}
          onClose={() => setAskingCancel(false)}
          errorOf={(err) => (['offline', 'session'].includes(errorKind(err)) ? describeError(t, err) : t('clubprofile.error_cancel_request'))}
        />
      )}
    </div>
  )
}

/* ── O que vem aí ───────────────────────────────────────────────────────
   Mix, jogo em aberto e torneio, por data, com as cores da Home. Tocar
   abre o evento e é lá que a pessoa se inscreve. Quem não é membro vê os
   eventos apagados e sem abrir, com a razão escrita — nunca esconder sem
   dizer (`locked` vem da base de dados, Dev 3). */
const SHOW = 5

// «O que vem aí» só leva o que ainda não aconteceu, e nunca os cancelados
// (QA, 11 out): um mix que ficou «a decorrer» de outro dia e um torneio
// cancelado apareciam lá. Os de hoje ficam (um mix a decorrer hoje também).
const todayKey = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const localDayKey = (iso) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function buildClubEvents(club, tournaments = []) {
  const today = todayKey()
  const now = Date.now()
  // Um jogo em aberto cuja hora já passou também sai (relatório do QA, 9 out):
  // só fica o que ainda vai acontecer. Os mixes de hoje ficam (a decorrer).
  const games = (club.open_games || []).filter((g) => g.date && localDayKey(g.date) >= today && g.status !== 'cancelled'
    && !(g.origin === 'open_slot' && new Date(g.date).getTime() <= now)).map((g) => ({
    key: `g-${g.id}`,
    kind: g.origin === 'open_slot' ? 'open' : 'mix',
    when: g.date,
    title: g.title,
    game: g,
    locked: !!g.locked,
    myState: g.my_state || null,
    recurring: !!g.recurrence_id,
  }))
  const tours = tournaments
    .filter((x) => !['terminado', 'cancelado'].includes(x.status) && (x.ends_on || x.starts_on || today) >= today)
    .map((x) => ({
      key: `t-${x.id}`,
      kind: 'tournament',
      when: x.starts_on ? `${x.starts_on}T12:00:00` : null,
      title: x.name,
      tournament: x,
    }))
  return [...games, ...tours].sort((a, b) => String(a.when || '9').localeCompare(String(b.when || '9')))
}

// R5 (13 out): os eventos do clube com o cartão do R1 (faixa na cor forte do
// tipo e corpo branco), e o tipo no lugar do clube («Mix · recorrente»).
function EventRow({ event, member }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const kindLabel = t(KIND_STYLE[event.kind]?.labelKey || 'agenda.kind_mix')
  const recurring = event.recurring ? t('ui.recurring') : null
  let time, timeAside = null, count = null, chips = null, stateRow = null, free = null
  if (event.tournament) {
    const x = event.tournament
    const a = shortDay(x.starts_on, i18n.language)
    const b = x.ends_on && String(x.ends_on).slice(0, 10) !== String(x.starts_on || '').slice(0, 10) ? shortDay(x.ends_on, i18n.language) : null
    time = b ? `${a.split(' ')[0]}–${b}` : a || '—'
    timeAside = daysAside(x.starts_on, x.ends_on, i18n.language, t)
    chips = null
    if (x.status === 'inscricoes') stateRow = <CardState tone="ok">{t('homecard.open')}</CardState>
  } else {
    const g = event.game
    time = new Date(event.when).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })
    timeAside = recurring ? recurring.toLowerCase() : null
    // Um evento fechado a quem não é membro não traz vagas nem inscritos.
    if (!event.locked && g.max_players) {
      count = { n: g.confirmed_count || 0, of: g.max_players, unit: t(event.kind === 'open' ? 'homecard.unit_players' : 'homecard.unit_signed') }
    }
    // A linha cinzenta do R1: formato · campos · preço (CONFORMIDADE-R5-R8,
    // n.º 3). Só com os dados na lista do clube (pedido ao Dev 3).
    chips = [
      g.format ? t(formatLabelKey(g)) : null,
      g.num_courts ? t('gamedetails.court_count', { count: g.num_courts }) : null,
      g.price_per_player > 0 ? formatCurrency(g.price_per_player, i18n.language) : null,
    ].filter(Boolean).join(' · ') || null
    free = g.max_players ? Math.max(0, g.max_players - (g.confirmed_count || 0)) : null
    if (event.myState === 'in') stateRow = <CardState tone="ok">{t('home.next_in')}</CardState>
    else if (event.myState === 'waitlist') stateRow = <CardState tone="warn">{t('agenda.state_line_waitlist')}</CardState>
    else if (!event.locked && free === 0) stateRow = <CardState tone="warn">{t('homecard.full')}</CardState>
    else if (!event.locked && free > 0) stateRow = <CardState tone="ok">{t('homecard.open')}</CardState>
  }
  const pill = event.locked
    ? <BandPill tone="dark"><Lock size={11} className="inline align-[-1px]" aria-label={t('clubprofile.events')} /></BandPill>
    : event.myState === 'in' ? <BandPill>✓ {t('home.next_in')}</BandPill> : null
  // O torneio abre a toda a gente (página pública). O mix só a membros: a
  // quem não é, a página do mix dava «não encontrado» (#535).
  const to = event.tournament ? `/torneio/${event.tournament.slug || event.tournament.id}`
    : member && !event.locked ? `/jogo/${event.game.id}` : null
  const card = (
    <HomeCard colors={kindColorsOf(event.kind)} label={kindLabel} pill={pill} time={time} timeAside={timeAside} count={count}
      imageUrl={event.game?.image_url || null} mine={event.myState === 'in'} to={to} ariaLabel={`${event.title} — ${time}`}>
      <CardClub event={{}} label={[kindLabel, recurring].filter(Boolean).join(' · ')} />
      <CardTitle>{event.title}</CardTitle>
      {chips && <CardChips>{chips}</CardChips>}
      {stateRow}
      {/* Os círculos e o botão, como na Home (R1; UX, 14 out), em todos os
          cartões — também quando já estou dentro (QA, 14 out). A lista do
          clube só traz quantos estão: o cinzento cheio com o número e os
          tracejados dos lugares que faltam — nunca caras inventadas.
          «Entrar» leva à página do mix, onde se entra; dentro, «Ver». */}
      {(count || (event.myState === 'in' && to)) && (
        <div className="mt-3 flex items-center gap-2.5">
          {count && <FaceCircles count={count.n} free={free || 0} size="sm" />}
          {event.myState === 'in' && to ? (
            <span className="pointer-events-none ml-auto whitespace-nowrap rounded-[14px] border-[1.5px] border-[#CFD2D7] bg-white px-[18px] py-[11px] font-display text-[14.5px] font-extrabold leading-none text-ink-900">{t('homecard.see')}</span>
          ) : to && free > 0 && !event.myState && (
            <div className="relative ml-auto"><CardButton onClick={() => navigate(to)}>{t('home.join_short')}</CardButton></div>
          )}
        </div>
      )}
    </HomeCard>
  )
  if (to) return card
  return event.locked ? <div className="opacity-60" aria-disabled="true">{card}</div> : card
}

// O cabeçalho do dia como o da Home (dayParts, AgendaControls): «Hoje» e
// «segunda, 12 out», ou «Sábado» e «17 out». Não se importa de lá porque
// AgendaControls traz o Google Maps, que não corre nos testes.
const capitalize = (x) => (x ? x[0].toUpperCase() + x.slice(1) : x)
function dayParts(dayKey, t, lang) {
  const today = toDayKey(new Date())
  const d = fromDayKey(dayKey)
  const part = (opts) => formatDate(d, lang, opts).replace(/\./g, '').replace(/-feira$/, '')
  const date = `${d.getDate()} ${part({ month: 'short' })}`
  const near = dayKey === today ? t('ui.today') : dayKey === addDays(today, 1) ? t('ui.tomorrow') : null
  if (near) return { big: near, small: `${part({ weekday: 'long' })}, ${date}` }
  return { big: capitalize(part({ weekday: 'long' })), small: date }
}

// Os eventos por dia, com o cabeçalho da Home (R1): «Hoje» em grande, a data
// a cinzento e, à direita, «2 jogos».
const eventDayKey = (e) => (e.tournament ? String(e.tournament.starts_on || '').slice(0, 10) : e.when ? localDayKey(e.when) : '')
function EventDays({ events, member }) {
  const { t, i18n } = useTranslation()
  const days = []
  for (const e of events) {
    const k = eventDayKey(e)
    if (days.length && days[days.length - 1].k === k) days[days.length - 1].list.push(e)
    else days.push({ k, list: [e] })
  }
  return (
    <div className="space-y-5">
      {days.map(({ k, list }, i) => {
        const dp = k ? dayParts(k, t, i18n.language) : null
        return (
          <section key={k || i} className="space-y-2.5">
            {dp && (
              <div className={`flex items-baseline gap-2 px-0.5 ${i === 0 ? '' : 'pt-1'}`}>
                <b className="font-display text-[22px] font-black leading-none tracking-[-.02em] text-ink-900">{dp.big}</b>
                <span className="font-display text-[14px] font-semibold leading-none text-[#5B6068]">{dp.small}</span>
                <em className="ml-auto font-mono text-[10.5px] not-italic leading-none tracking-[.06em] text-[#8A8E95]">{t('homecard.day_count', { count: list.length })}</em>
              </div>
            )}
            {list.map((e) => <EventRow key={e.key} event={e} member={member} />)}
          </section>
        )
      })}
    </div>
  )
}

export function ClubEvents({ club, events, isAdmin, gerirHref }) {
  const { t } = useTranslation()
  const kk = (key) => (club.kind === 'group' ? `${key}_group` : key)
  const [all, setAll] = useState(false)
  const member = club.my_status === 'member'
  const shown = all ? events : events.slice(0, SHOW)
  const blockedGames = !member && events.some((e) => !e.tournament)
  // «Eventos» com o separador «O que vem aí · Já jogados» (design-handoff/
  // 2026-09-27-jogos-jogados-do-clube, proposta-3; Francisco, 27 set). Abre
  // sempre em «O que vem aí». Grupo fechado visto de fora: só o de hoje.
  const canSeePast = member || club.is_global
  const [tab, setTab] = useState('upcoming')

  return (
    <section>
      {/* Sem rótulo por cima: o separador vem logo a seguir ao botão (R5,
          protótipo; UX 13 out). */}
      {/* Preso por baixo da barra de vidro ao descer (Francisco, 14 out). */}
      {canSeePast && (
        <GlassPinned className="mb-1">
          <Tabs label={t('clubprofile.events')} value={tab} onChange={setTab} options={[
            { value: 'upcoming', label: t('clubprofile.upcoming') },
            { value: 'played', label: t('agenda.show_played') },
          ]} />
        </GlassPinned>
      )}

      {tab === 'played' ? <ClubPlayed club={club} /> : <>
      {blockedGames && (
        <p className="mb-2 text-[13px] text-ink-700">
          {t(club.open_join ? kk('clubprofile.members_only_open') : 'clubprofile.members_only_closed')}
        </p>
      )}

      {events.length === 0 ? (
        // O Alino «a pensar», «Ainda sem jogos marcados» (R5, regra de 12 out:
        // o Alino em todos os vazios). Quem organiza tem o caminho para marcar.
        <div className="px-2.5 py-6 text-center">
          <Alino pose="a-pensar" size={120} className="mx-auto" />
          <b className="mt-2 block font-display text-[19px] font-black leading-tight text-ink-900">{t('clubprofile.empty_title')}</b>
          <p className="mt-1.5 text-[13.5px] leading-normal text-ink-500">{t(kk('clubprofile.empty_hint'))}</p>
          {isAdmin && (
            <Link to={gerirHref} className="mt-2 inline-flex min-h-[44px] items-center gap-1 text-sm font-extrabold text-ink-900">
              <Plus size={15} /> {t('clubprofile.schedule_mix')} <ChevronRight size={15} />
            </Link>
          )}
        </div>
      ) : (
        <>
          <EventDays events={shown} member={member} />
          {events.length > SHOW && !all && (
            <button type="button" onClick={() => setAll(true)} className="mt-1 inline-flex min-h-[44px] items-center gap-0.5 text-sm font-extrabold text-ink-900">
              {t('clubprofile.see_all')} <ChevronRight size={15} />
            </button>
          )}
        </>
      )}
      </>}
    </section>
  )
}

/* «Já jogados» do clube/grupo: as mesmas regras do filtro da Home —
   list_played_events (Dev 3) só deste clube; cinzentos com «Terminado», o
   meu com contorno verde e os meus pontos; mostra 4 e «Ver mais (N)». */
const PLAYED_FIRST = 4
function ClubPlayed({ club }) {
  const { t, i18n } = useTranslation()
  const [data, setData] = useState(null)
  const [all, setAll] = useState(false)
  useEffect(() => {
    let alive = true
    supabase.rpc('list_played_events', { p_organization_id: club.id, p_before: null, p_limit: 100 })
      .then(({ data: res, error }) => {
        if (error) throw error
        if (alive) setData(res || { rows: [], total: 0 })
      })
      .catch((err) => { console.error('Error loading played events:', err); if (alive) setData({ rows: [], total: 0 }) })
    return () => { alive = false }
  }, [club.id])
  // Dois cartões a cinzento em vez da roda (esqueletos, 12 out).
  if (!data) return <SkeletonGate><div className="space-y-2.5"><SkBlock h={92} rounded="rounded-card" /><SkBlock h={92} rounded="rounded-card" /></div></SkeletonGate>
  const rows = data.rows || []
  if (rows.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-line bg-canvas px-3.5 py-3 text-center">
        <p className="text-sm text-ink-700">{t(club.kind === 'group' ? 'clubprofile.played_empty_group' : 'clubprofile.played_empty')}</p>
        <p className="text-[13px] text-muted">{t(club.kind === 'group' ? 'clubprofile.played_empty_hint_group' : 'clubprofile.played_empty_hint')}</p>
      </div>
    )
  }
  const shown = all ? rows : rows.slice(0, PLAYED_FIRST)
  const dayOf = (iso) => new Date(iso).toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '').replace(',', '')
  const timeOf = (iso) => new Date(iso).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })
  return (
    <div className="space-y-2.5">
      {shown.map((r) => {
        // Num clube, a sessão entre amigos é «Jogo em aberto» (Francisco, 28 set).
        const kind = r.kind === 'tournament' ? 'tournament' : r.kind === 'friends' ? (r.org_kind === 'group' ? 'friends' : 'open') : 'mix'
        const to = r.kind === 'mix' ? `/jogo/${r.id}` : r.kind === 'tournament' ? `/torneio/${r.slug || r.id}` : `/jogos-privados/sessao/${r.id}`
        const title = r.kind === 'friends' && kind === 'open' ? t('agenda.played_open_title')
          : r.kind === 'friends'
          ? (r.creator_name ? t('agenda.played_friends_title', { name: r.creator_name.split(' ')[0] }) : t('agenda.played_friends_title_anon'))
          : r.title
        const people = r.kind === 'tournament'
          ? (r.entries_count != null ? t('agenda.played_teams', { count: Number(r.entries_count) }) : null)
          : r.players_count != null ? t(r.kind === 'mix' ? 'agenda.played_players' : 'agenda.played_people', { count: Number(r.players_count) }) : null
        // Na faixa já vai a hora (ou o dia, no torneio): por baixo, o dia e quantos jogaram.
        const line = [dayOf(r.date), people].filter(Boolean).join(' · ')
        const points = r.i_played && r.my_points != null ? Math.round(Number(r.my_points)) : null
        return (
          // R5 (13 out): o cartão do R1, a cinzento por já ter passado.
          <HomeCard key={`${r.kind}-${r.id}`} colors={kindColorsOf(kind)} label={t(KIND_STYLE[kind]?.labelKey || 'agenda.kind_mix')}
            pill={<BandPill tone="dark">{t('agenda.state_finished')}</BandPill>}
            time={r.kind === 'tournament' ? shortDay(r.date, i18n.language) : timeOf(r.date)} past to={to} ariaLabel={title}>
            <div className="flex items-baseline justify-between gap-2">
              <CardTitle past>{title}</CardTitle>
              {points != null && <b className={`shrink-0 text-sm font-extrabold ${points > 0 ? 'text-[#3F6212]' : 'text-muted'}`}>{t('agenda.played_points', { points: `${points > 0 ? '+' : ''}${points}` })}</b>}
            </div>
            <CardChips>{line}</CardChips>
          </HomeCard>
        )
      })}
      {!all && rows.length > PLAYED_FIRST && (
        <button type="button" onClick={() => setAll(true)}
          className="w-full min-h-[48px] rounded-ctrl border border-line bg-white text-sm font-extrabold text-ink-900">
          {t('clubprofile.played_more', { count: rows.length - PLAYED_FIRST })}
        </button>
      )}
    </div>
  )
}

/* ── Pessoas ────────────────────────────────────────────────────────────
   Caras e «N membros»; «Ver todos os membros ›» numa linha própria, a toda
   a largura — nunca cortado (provado a 320 px no desenho). Quem organiza à
   vista. Professores (só clube) com o seguir de pessoas que já existe —
   nada de preços nem horários: as aulas estão escondidas até 11 out. */
// Os blocos de baixo (protótipo .blk e .pl): o cartão cinzento-claro e a
// linha branca de cada pessoa.
export const BLOCK = 'rounded-[16px] bg-[#F4F5F1] p-3'
export const ROW = 'mt-2 flex items-center gap-3 rounded-[12px] bg-white px-2.5 py-2'
export const BLOCK_TITLE = 'font-display text-[15px] font-bold leading-tight text-ink-900'

export function ClubPeople({ club, members, teachers, follows, followActing, onFollowTeacher, onUnfollowTeacher }) {
  const { t } = useTranslation()
  const admins = members.filter((m) => m.is_admin)
  const faces = members.slice(0, 6)
  const count = club.member_count ?? members.length
  const extra = Math.max(count - faces.length, 0)

  if (!count && !teachers.length) return null
  // R5 (protótipo, UX 13 out): cada bloco num cartão cinzento-claro com o
  // título dentro — «Pessoas» com «6 MEMBROS» em mono à direita, as caras e
  // «Ver todos os membros ›»; «Quem organiza» com cada pessoa numa linha
  // branca. O «Falar» do protótipo precisa do contacto de quem organiza, que
  // vem com os dados de 23 (DADOS-PARA-23): até lá a linha abre o perfil.
  return (
    <section className="space-y-2">
      {count > 0 && (
        <div className={BLOCK}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-[15px] font-bold leading-tight text-ink-900">{t('clubprofile.people')}</h3>
            <span className="font-mono text-[10.5px] font-medium uppercase tracking-[.08em] text-ink-500">{t('clubprofile.member_count', { count })}</span>
          </div>
          {/* Sem caras, sem a linha: um «+340» sozinho parecia um erro (UX, 14 out). */}
          {faces.length > 0 && <div className="mt-2.5 flex">
            {faces.map((m, i) => (
              <span key={m.id} className="-mr-2 rounded-full border-2 border-white" style={{ zIndex: 10 - i }}>
                <Avatar name={m.name} url={m.avatar_url} size="w-8 h-8 text-[11px]" />
              </span>
            ))}
            {extra > 0 && (
              <span className="-mr-2 grid h-9 w-9 place-items-center rounded-full border-2 border-white bg-[#F1F2EE] font-display text-[10.5px] font-bold text-[#4F535A]">+{extra}</span>
            )}
          </div>}
          <Link to={`/clube/${club.slug}/membros`} className="block pb-0.5 pt-3 font-display text-[13px] font-bold text-ink-900">
            {t('clubprofile.see_all_members')} ›
          </Link>
        </div>
      )}

      {admins.length > 0 && (
        <div className={BLOCK}>
          <h3 className="font-display text-[15px] font-bold leading-tight text-ink-900">{t('clubprofile.organizers')}</h3>
          {admins.map((m) => (
            <Link key={m.id} to={`/jogador/${m.id}`} className={ROW}>
              <Avatar name={m.name} url={m.avatar_url} size="w-9 h-9 text-xs" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-[14px] font-bold text-ink-900">{m.name}</span>
                <span className="block text-[12px] text-ink-500">{t('clubprofile.organizes_mixes')}</span>
              </span>
              <ChevronRight size={16} className="shrink-0 text-ink-500" />
            </Link>
          ))}
        </div>
      )}

      {club.kind !== 'group' && teachers.length > 0 && (
        <div className={BLOCK}>
          <h3 className="font-display text-[15px] font-bold leading-tight text-ink-900">{t('clubprofile.tab_teachers')}</h3>
          {teachers.map((x) => {
            const follow = x.user_id ? follows[x.user_id] : null
            return (
              <div key={x.teacher_profile_id || x.user_id} className={ROW}>
                <Link to={`/professor/${x.teacher_profile_id}`} className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar name={x.name} url={x.avatar_url} size="w-9 h-9 text-xs" />
                  <span className="min-w-0">
                    <span className="block truncate font-display text-[14px] font-bold text-ink-900">{x.name}</span>
                    <span className="block truncate text-[12px] text-ink-500">
                      {[t('comunidade.teacher_label'), club.kind !== 'group' ? club.location : null].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </Link>
                {x.user_id && (follow?.status === 'accepted' ? (
                  <button type="button" disabled={followActing === x.user_id} onClick={() => onUnfollowTeacher(x)}
                    className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-[12px] border border-[#D5D8DE] bg-white px-2.5 font-display text-[12.5px] font-bold text-ink-900">
                    <Check size={13} /> {t('playerdetails.following_button')}
                  </button>
                ) : follow?.status === 'pending' ? (
                  <button type="button" disabled={followActing === x.user_id} onClick={() => onUnfollowTeacher(x, false)}
                    className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-[12px] border border-[#D5D8DE] bg-white px-2.5 font-display text-[12.5px] font-bold text-ink-900 !text-ink-500">
                    <Clock size={13} /> {t('playerdetails.requested_button')}
                  </button>
                ) : (
                  <button type="button" disabled={followActing === x.user_id} onClick={() => onFollowTeacher(x)}
                    className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-[12px] border border-[#D5D8DE] bg-white px-2.5 font-display text-[12.5px] font-bold text-ink-900">
                    {t('playerdetails.follow_button')}
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

/* ── Sobre ──────────────────────────────────────────────────────────────
   Um só cartão: descrição, local e contactos. Cada botão de contacto só
   aparece se essa informação existir (regra do Francisco); sem nada, o
   «Sobre» não aparece. Quem organiza vê, no lugar, o convite a escrever. */
export function ClubAbout({ club, isAdmin, gerirHref }) {
  const { t } = useTranslation()
  const kk = (key) => (club.kind === 'group' ? `${key}_group` : key)
  const isClub = club.kind !== 'group'
  const hasLocation = isClub && !!club.location
  const contacts = isClub ? [
    club.phone && { href: `tel:${club.phone}`, icon: Phone, label: t('clubprofile.call') },
    club.instagram && { href: asInstagramUrl(club.instagram), icon: Instagram, label: 'Instagram', external: true },
    club.website && { href: asWebsiteUrl(club.website), icon: Globe, label: t('clubprofile.website'), external: true },
  ].filter(Boolean) : []
  const empty = !club.description && !hasLocation && contacts.length === 0

  if (empty) {
    if (!isAdmin) return null
    return (
      <section>
        <h3 className="mb-2 text-[11px] font-extrabold uppercase tracking-widest text-muted">{t('clubprofile.about')}</h3>
        <div className="rounded-card border-2 border-dashed border-line p-3.5">
          <p className="text-sm font-extrabold text-ink-900">{t(kk('clubprofile.about_invite'))}</p>
          <p className="text-[13px] text-muted">{t('clubprofile.about_invite_hint')}</p>
          <Link to={gerirHref} className="mt-1 inline-flex min-h-[44px] items-center gap-1 text-sm font-extrabold text-ink-900">
            {t('clubprofile.write_in_gerir')} <ChevronRight size={15} />
          </Link>
        </div>
      </section>
    )
  }

  return (
    // R5 (protótipo): «Sobre o clube» / «Sobre o grupo» no cartão
    // cinzento-claro, com a morada na peça comum («Abrir com…», Dev 2).
    <section>
      <div className={`${BLOCK} space-y-3`}>
        <h3 className="font-display text-[15px] font-bold leading-tight text-ink-900">{t(kk('clubprofile.about_title'))}</h3>
        {club.description && <p className="whitespace-pre-line text-[13px] leading-normal text-ink-700">{club.description}</p>}
        {hasLocation && <LocationOpenWith location={club.location} surface="white" />}
        {/* Cada contacto numa linha branca, empilhadas (UX, 13 out — nunca
            lado a lado): o ícone, o nome e «›». */}
        {contacts.length > 0 && (
          <div className="space-y-2">
            {contacts.map((c) => (
              <a key={c.href} href={c.href} target={c.external ? '_blank' : undefined} rel={c.external ? 'noopener noreferrer' : undefined}
                className="press flex min-h-[48px] items-center gap-3 rounded-[12px] bg-white px-3 py-2.5 font-display text-[14px] font-bold text-ink-900">
                <c.icon size={17} className="shrink-0 text-ink-700" />
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                <ChevronRight size={16} className="shrink-0 text-ink-500" />
              </a>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
