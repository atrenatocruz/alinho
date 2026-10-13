// As secções da página do clube e do grupo (Trello #419; desenho aprovado
// pelo Francisco a 24 set, design-handoff/2026-09-23-pagina-do-grupo/
// SPEC.md). Uma página que se desce, sem separadores, a mesma para clube e
// grupo: cabeçalho · o que vem aí · pessoas · (grupos do clube) · jogos
// entre membros · sobre. O clube só ACRESCENTA professores, grupos, local e
// contactos — não é outra página.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Check, ChevronLeft, ChevronRight, Clock, Globe, Heart, Instagram, Lock, MapPin, Phone, Plus, Share2 } from 'lucide-react'
import KindHero from '../KindHero'
import { CLUB_HERO, GROUP_HERO } from '../../lib/kindColors'
import { Avatar, ConfirmSheet, PrimaryButton, Tabs } from '../ui'
import { supabase } from '../../lib/supabase'
import { describeError, errorKind } from '../../lib/errors'
import { KIND_STYLE, CardClub } from '../agenda/EventCard'
import HomeCard, { BandPill, CardTitle, CardChips, CardState, CardFoot, kindColorsOf } from '../agenda/HomeCard'
import { toDayKey, fromDayKey, addDays } from '../../lib/agenda'
import { formatDate } from '../../lib/formatDate'
import { daysAside, shortDay } from '../event/heroDates'

const asWebsiteUrl = (value) => (/^https?:\/\//i.test(value) ? value : `https://${value}`)
const asInstagramUrl = (value) => (/^https?:\/\//i.test(value)
  ? value : `https://instagram.com/${value.trim().replace(/^@/, '')}`)

/** Símbolo do dono: quadrado = clube, redondo = grupo (regra de 18 set). */
function Symbol({ club, size = 'w-14 h-14 text-lg' }) {
  const group = club.kind === 'group'
  if (club.group_logo_url) {
    return <img src={club.group_logo_url} alt="" className={`${size} shrink-0 object-cover ${group ? 'rounded-full' : 'rounded-[12px]'}`} />
  }
  const initials = (club.name || '?').split(/\s+/).filter(Boolean).slice(0, 1).map((w) => w[0]).join('').toUpperCase()
  return (
    <span className={`${size} flex shrink-0 items-center justify-center font-extrabold ${group ? 'rounded-full bg-ink-700 text-white' : 'rounded-[12px] bg-ink-900 text-lime-400'}`}>
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
  const [askingCancel, setAskingCancel] = useState(false)
  const member = club.my_status === 'member'
  // A terra pode ser uma morada inteira (A2N, 26 set): essa parte pode partir
  // a linha; «Clube» e «N membros» nunca partem.
  const sub = [
    { text: t(club.kind === 'group' ? 'clubprofile.kind_group' : 'clubprofile.kind_club'), long: false },
    club.kind !== 'group' && club.location ? { text: club.location, long: true } : null,
    club.member_count != null ? { text: t('clubprofile.member_count', { count: club.member_count }), long: false } : null,
  ].filter(Boolean)
  const round = 'flex h-11 w-11 items-center justify-center rounded-full bg-black/25 text-white backdrop-blur-sm disabled:opacity-50'

  return (
    // Sai das margens da página, como o topo dos eventos (R3).
    <div className="-mx-4 -mt-6">
      <KindHero kind="club" src={club.kind === 'group' ? GROUP_HERO : CLUB_HERO} className="relative h-40">
        <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 px-4" style={{ paddingTop: 'calc(var(--safe-top, env(safe-area-inset-top)) + 12px)' }}>
          {onBack
            ? <button type="button" onClick={onBack} aria-label={t('common.back')} className={round}><ChevronLeft size={22} /></button>
            : <span aria-hidden />}
          <div className="flex items-center gap-2">
            {member && (
              <button type="button" onClick={onToggleFavorite} disabled={favoriting}
                aria-label={isFavorite ? t('clubprofile.remove_favorite') : t('clubprofile.mark_favorite')}
                title={isFavorite ? t('clubprofile.remove_favorite') : t(kk('clubprofile.mark_favorite_title'))}
                aria-pressed={isFavorite} className={round}>
                <Heart size={19} className={isFavorite ? 'fill-lime-400 text-lime-400' : ''} />
              </button>
            )}
            {onShare && <button type="button" onClick={onShare} aria-label={t('ui.share')} className={round}><Share2 size={18} /></button>}
          </div>
        </div>
      </KindHero>

      <div className="relative -mt-5 rounded-t-[22px] bg-white px-4 pb-4">
        <div className="flex items-end gap-3.5">
          {/* O logótipo grande, a passar por cima do topo. */}
          <span className="-mt-7 rounded-[16px] bg-white p-1 shadow-card">
            <Symbol club={club} size="w-[58px] h-[58px] text-xl" />
          </span>
          <div className="min-w-0 flex-1 pt-3">
            <h1 className="font-display text-2xl font-extrabold leading-tight text-ink-900 [overflow-wrap:anywhere]">{club.name}</h1>
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
              className="flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-ctrl bg-[#F1F8D6] text-base font-extrabold text-[#3F5200] disabled:opacity-40">
              <Check size={17} /> {t('clubprofile.is_member')}
            </button>
          ) : club.my_status === 'pending' ? (
            <div>
              <span className="flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-ctrl bg-ink-50 text-base font-extrabold text-muted">
                <Clock size={16} /> {t('clubprofile.request_sent')}
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
  const kindLabel = t(KIND_STYLE[event.kind]?.labelKey || 'agenda.kind_mix')
  const recurring = event.recurring ? t('ui.recurring') : null
  let time, timeAside = null, count = null, chips = null, stateRow = null
  if (event.tournament) {
    const x = event.tournament
    const a = shortDay(x.starts_on, i18n.language)
    const b = x.ends_on && String(x.ends_on).slice(0, 10) !== String(x.starts_on || '').slice(0, 10) ? shortDay(x.ends_on, i18n.language) : null
    time = b ? `${a.split(' ')[0]}–${b}` : a || '—'
    timeAside = daysAside(x.starts_on, x.ends_on, i18n.language, t)
    chips = x.location || null
    if (x.status === 'inscricoes') stateRow = <CardState tone="ok">{t('homecard.open')}</CardState>
  } else {
    const g = event.game
    time = new Date(event.when).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })
    timeAside = recurring ? recurring.toLowerCase() : null
    // Um evento fechado a quem não é membro não traz vagas nem inscritos.
    if (!event.locked && g.max_players) {
      count = { n: g.confirmed_count || 0, of: g.max_players, unit: t(event.kind === 'open' ? 'homecard.unit_players' : 'homecard.unit_signed') }
    }
    chips = g.location || null
    const free = g.max_players ? g.max_players - (g.confirmed_count || 0) : null
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
      {event.myState === 'in' && to && (
        <CardFoot>
          <span className="pointer-events-none whitespace-nowrap rounded-[14px] border-[1.5px] border-[#CFD2D7] bg-white px-[18px] py-[11px] font-display text-[14.5px] font-extrabold leading-none text-ink-900">{t('homecard.see')}</span>
        </CardFoot>
      )}
    </HomeCard>
  )
  return to ? card : <div className="opacity-60" aria-disabled="true">{card}</div>
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
              <div className={`flex items-baseline gap-2 px-0.5 ${i === 0 ? '' : 'border-t border-line pt-3.5'}`}>
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
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-extrabold uppercase tracking-widest text-muted">{t(canSeePast ? 'clubprofile.events' : 'clubprofile.upcoming')}</h3>
        {tab === 'upcoming' && events.length > SHOW && !all && (
          <button type="button" onClick={() => setAll(true)} className="inline-flex min-h-[44px] items-center gap-0.5 text-sm font-extrabold text-ink-900">
            {t('clubprofile.see_all')} <ChevronRight size={15} />
          </button>
        )}
      </div>

      {canSeePast && (
        <Tabs className="mb-3" label={t('clubprofile.events')} value={tab} onChange={setTab} options={[
          { value: 'upcoming', label: t('clubprofile.upcoming') },
          { value: 'played', label: t('agenda.show_played') },
        ]} />
      )}

      {tab === 'played' ? <ClubPlayed club={club} /> : <>
      {blockedGames && (
        <p className="mb-2 text-[13px] text-ink-700">
          {t(club.open_join ? kk('clubprofile.members_only_open') : 'clubprofile.members_only_closed')}
        </p>
      )}

      {events.length === 0 ? (
        isAdmin ? (
          <div className="rounded-card border-2 border-dashed border-line p-3.5">
            <p className="text-sm font-extrabold text-ink-900">{t('clubprofile.nothing_yet_admin')}</p>
            <p className="text-[13px] text-muted">{t(kk('clubprofile.nothing_yet_admin_hint'))}</p>
            <Link to={gerirHref} className="mt-1 inline-flex min-h-[44px] items-center gap-1 text-sm font-extrabold text-ink-900">
              <Plus size={15} /> {t('clubprofile.schedule_mix')} <ChevronRight size={15} />
            </Link>
          </div>
        ) : (
          <div className="rounded-card border border-line bg-canvas px-3.5 py-3">
            <p className="text-sm font-extrabold text-ink-900">{t('clubprofile.nothing_yet')}</p>
            <p className="text-[13px] text-muted">{t(kk('clubprofile.nothing_yet_hint'))}</p>
          </div>
        )
      ) : (
        <EventDays events={shown} member={member} />
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
  if (!data) return <div className="flex justify-center py-6"><div className="h-7 w-7 animate-spin rounded-full border-[3px] border-ink-50 border-t-ink-700" /></div>
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
export function ClubPeople({ club, members, teachers, follows, followActing, onFollowTeacher, onUnfollowTeacher }) {
  const { t } = useTranslation()
  const admins = members.filter((m) => m.is_admin)
  const faces = members.slice(0, 3)
  const count = club.member_count ?? members.length
  const extra = Math.max(count - faces.length, 0)

  if (!count && !teachers.length) return null
  return (
    <section className="space-y-2.5">
      <h3 className="text-[11px] font-extrabold uppercase tracking-widest text-muted">{t('clubprofile.people')}</h3>

      {count > 0 && (
        <div className="card overflow-hidden p-0">
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="flex shrink-0 -space-x-2">
              {faces.map((m) => <Avatar key={m.id} name={m.name} url={m.avatar_url} size="w-9 h-9 text-xs ring-2 ring-surface" />)}
              {extra > 0 && (
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-700 text-[11px] font-extrabold text-white ring-2 ring-surface">+{extra}</span>
              )}
            </div>
            <p className="font-extrabold text-ink-900">{t('clubprofile.member_count', { count })}</p>
          </div>
          <Link to={`/clube/${club.slug}/membros`}
            className="flex min-h-[48px] items-center justify-between border-t border-line px-4 text-sm font-extrabold text-ink-900 hover:bg-ink-50">
            {t('clubprofile.see_all_members')} <ChevronRight size={16} />
          </Link>
        </div>
      )}

      {admins.length > 0 && (
        <div className="card space-y-2.5">
          <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted">{t('clubprofile.organizers')}</p>
          {admins.map((m) => (
            <Link key={m.id} to={`/jogador/${m.id}`} className="flex items-center gap-3">
              <Avatar name={m.name} url={m.avatar_url} size="w-10 h-10 text-sm" />
              <span className="min-w-0">
                <span className="block truncate font-extrabold text-ink-900">{m.name}</span>
                <span className="block text-[13px] text-muted">{t('clubprofile.organizes_mixes')}</span>
              </span>
            </Link>
          ))}
        </div>
      )}

      {club.kind !== 'group' && teachers.length > 0 && (
        <div className="card space-y-2.5">
          <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted">{t('clubprofile.tab_teachers')}</p>
          {teachers.map((x) => {
            const follow = x.user_id ? follows[x.user_id] : null
            return (
              <div key={x.teacher_profile_id || x.user_id} className="flex items-center gap-3">
                <Link to={`/professor/${x.teacher_profile_id}`} className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar name={x.name} url={x.avatar_url} size="w-10 h-10 text-sm" />
                  <span className="min-w-0">
                    <span className="block truncate font-extrabold text-ink-900">{x.name}</span>
                    <span className="block truncate text-[13px] text-muted">
                      {[t('comunidade.teacher_label'), club.kind !== 'group' ? club.location : null].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </Link>
                {x.user_id && (follow?.status === 'accepted' ? (
                  <button type="button" disabled={followActing === x.user_id} onClick={() => onUnfollowTeacher(x)}
                    className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-full border border-line bg-canvas px-3.5 text-sm font-extrabold text-ink-900">
                    <Check size={14} /> {t('playerdetails.following_button')}
                  </button>
                ) : follow?.status === 'pending' ? (
                  <button type="button" disabled={followActing === x.user_id} onClick={() => onUnfollowTeacher(x, false)}
                    className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-full border border-line bg-canvas px-3.5 text-sm font-extrabold text-muted">
                    <Clock size={14} /> {t('playerdetails.requested_button')}
                  </button>
                ) : (
                  <button type="button" disabled={followActing === x.user_id} onClick={() => onFollowTeacher(x)}
                    className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-full border-2 border-ink-900 bg-canvas px-3.5 text-sm font-extrabold text-ink-900">
                    <Plus size={14} /> {t('playerdetails.follow_button')}
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
    <section>
      <h3 className="mb-2 text-[11px] font-extrabold uppercase tracking-widest text-muted">{t('clubprofile.about')}</h3>
      <div className="card space-y-3">
        {club.description && <p className="whitespace-pre-line text-ink-900">{club.description}</p>}
        {hasLocation && (
          <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(club.location)}`} target="_blank" rel="noopener noreferrer"
            className="flex min-h-[44px] items-center justify-between gap-2 border-t border-line pt-2 text-ink-900">
            <span className="flex min-w-0 items-center gap-1.5"><MapPin size={15} className="shrink-0" /> <span className="truncate">{club.location}</span></span>
            <span className="inline-flex shrink-0 items-center text-sm font-extrabold">{t('clubprofile.open_map')} <ChevronRight size={15} /></span>
          </a>
        )}
        {contacts.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            {contacts.map((c) => (
              <a key={c.href} href={c.href} target={c.external ? '_blank' : undefined} rel={c.external ? 'noopener noreferrer' : undefined}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-line bg-canvas px-4 text-sm font-extrabold text-ink-900">
                <c.icon size={15} /> {c.label}
              </a>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
