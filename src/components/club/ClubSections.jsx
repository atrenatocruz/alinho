// As secções da página do clube e do grupo (Trello #419; desenho aprovado
// pelo Francisco a 24 set, design-handoff/2026-09-23-pagina-do-grupo/
// SPEC.md). Uma página que se desce, sem separadores, a mesma para clube e
// grupo: cabeçalho · o que vem aí · pessoas · (grupos do clube) · jogos
// entre membros · sobre. O clube só ACRESCENTA professores, grupos, local e
// contactos — não é outra página.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Check, ChevronRight, Clock, Globe, Heart, Instagram, Lock, MapPin, Phone, Plus } from 'lucide-react'
import { Avatar, ConfirmSheet, PrimaryButton } from '../ui'
import { describeError, errorKind } from '../../lib/errors'
import { KIND_STYLE, KindTag, StateTag } from '../agenda/EventCard'

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

/* ── Cabeçalho ──────────────────────────────────────────────────────────
   O nome nunca é cortado (passa a duas linhas) e o botão fica SEMPRE por
   baixo, a toda a largura. Lima só no «Seguir»/«Pedir para entrar» — a
   única coisa lima do ecrã. «A seguir» abre a pergunta das janelas de 24
   set: «Continuar a seguir» a preto primeiro, o risco a vermelho por baixo. */
export function ClubHeader({ club, isFavorite, acting, favoriting, onFollow, onUnfollow, onToggleFavorite }) {
  const { t } = useTranslation()
  const kk = (key) => (club.kind === 'group' ? `${key}_group` : key)
  const [asking, setAsking] = useState(false)
  // A terra pode ser uma morada inteira (A2N, 26 set): essa parte pode partir
  // a linha; «Clube» e «N membros» nunca partem. Nada pode empurrar a página
  // para o lado.
  const sub = [
    { text: t(club.kind === 'group' ? 'clubprofile.kind_group' : 'clubprofile.kind_club'), long: false },
    club.kind !== 'group' && club.location ? { text: club.location, long: true } : null,
    club.member_count != null ? { text: t('clubprofile.member_count', { count: club.member_count }), long: false } : null,
  ].filter(Boolean)

  return (
    <div className="card space-y-3.5">
      <div className="flex items-center gap-3.5">
        <Symbol club={club} />
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl leading-tight text-ink-900 [overflow-wrap:anywhere]">{club.name}</h2>
          <p className="mt-0.5 text-sm text-muted">
            {sub.map((part, i) => (
              <span key={i} className={part.long ? '[overflow-wrap:anywhere]' : 'whitespace-nowrap'}>{i > 0 && ' · '}{part.text}</span>
            ))}
          </p>
        </div>
      </div>

      {club.my_status === 'member' ? (
        <div className="flex gap-2.5">
          <button type="button" onClick={() => setAsking(true)} disabled={acting}
            className="flex min-h-[48px] flex-1 items-center justify-center gap-1.5 rounded-ctrl border border-line bg-canvas text-base font-extrabold text-ink-900 disabled:opacity-40">
            <Check size={17} /> {t('clubprofile.following')}
          </button>
          <button type="button" onClick={onToggleFavorite} disabled={favoriting}
            aria-label={isFavorite ? t('clubprofile.remove_favorite') : t('clubprofile.mark_favorite')}
            title={isFavorite ? t('clubprofile.remove_favorite') : t(kk('clubprofile.mark_favorite_title'))}
            className="flex h-12 w-14 shrink-0 items-center justify-center rounded-ctrl border-2 border-lime-400 bg-canvas disabled:opacity-40">
            <Heart size={20} className={isFavorite ? 'fill-lime-600 text-lime-600' : 'text-ink-300'} />
          </button>
        </div>
      ) : club.my_status === 'pending' ? (
        <div>
          <span className="flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-ctrl bg-ink-50 text-base font-extrabold text-muted">
            <Clock size={16} /> {t('clubprofile.request_sent')}
          </span>
          <p className="mt-1.5 text-center text-[13px] text-muted">{t(kk('clubprofile.request_waiting'))}</p>
        </div>
      ) : (
        <PrimaryButton onClick={onFollow} disabled={acting} className="w-full">
          {club.open_join ? t('clubprofile.follow_button') : t('clubprofile.request_join_button')}
        </PrimaryButton>
      )}

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
    </div>
  )
}

/* ── O que vem aí ───────────────────────────────────────────────────────
   Mix, jogo em aberto e torneio, por data, com as cores da Home. Tocar
   abre o evento e é lá que a pessoa se inscreve. Quem não é membro vê os
   eventos apagados e sem abrir, com a razão escrita — nunca esconder sem
   dizer (`locked` vem da base de dados, Dev 3). */
const SHOW = 5

export function buildClubEvents(club, tournaments = []) {
  const games = (club.open_games || []).map((g) => ({
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
    .filter((x) => x.status !== 'terminado')
    .map((x) => ({
      key: `t-${x.id}`,
      kind: 'tournament',
      when: x.starts_on ? `${x.starts_on}T12:00:00` : null,
      title: x.name,
      tournament: x,
    }))
  return [...games, ...tours].sort((a, b) => String(a.when || '9').localeCompare(String(b.when || '9')))
}

function EventRow({ event, member }) {
  const { t, i18n } = useTranslation()
  // «sáb 27 set» e «18:00» — como na Home, sem o ano nem a data repetida.
  const dayOf = (iso, withWeekday) => new Date(iso).toLocaleDateString(i18n.language,
    { ...(withWeekday ? { weekday: 'short' } : {}), day: 'numeric', month: 'short' }).replace(/\./g, '').replace(',', '')
  const timeOf = (iso) => new Date(iso).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })
  let line = ''
  if (event.tournament) {
    const x = event.tournament
    const a = x.starts_on ? dayOf(`${x.starts_on}T12:00:00`) : ''
    const b = x.ends_on && x.ends_on !== x.starts_on ? dayOf(`${x.ends_on}T12:00:00`) : ''
    line = [b ? `${a} – ${b}` : a, t(`tournament.status_${x.status}`)].filter(Boolean).join(' · ')
  } else {
    const g = event.game
    line = [
      dayOf(event.when, true),
      timeOf(event.when),
      // Um evento fechado a quem não é membro não traz vagas nem inscritos.
      !event.locked && g.max_players ? t('clubprofile.players_ratio', { count: g.confirmed_count || 0, max: g.max_players }) : null,
    ].filter(Boolean).join(' · ')
  }

  const state = event.myState === 'in' ? <StateTag tone="in" icon={Check}>{t('agenda.state_in')}</StateTag>
    : event.myState === 'waitlist' ? <StateTag tone="wait">{t('agenda.state_waitlist')}</StateTag>
      : null
  const frame = event.myState === 'in' ? `${KIND_STYLE[event.kind].bg} border-2 border-ok`
    : event.myState === 'waitlist' ? `${KIND_STYLE[event.kind].bg} border-2 border-dashed border-[#B86E00]`
      : `${KIND_STYLE[event.kind].card} border`
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <KindTag kind={event.kind} suffix={event.recurring ? t('ui.recurring') : null} />
        {event.locked ? <Lock size={15} className="mt-1 text-muted" /> : state}
      </div>
      <h4 className="mt-2 text-base font-extrabold leading-snug text-ink-900 [overflow-wrap:anywhere]">{event.title}</h4>
      <p className="mt-0.5 text-[13px] text-ink-700">{line}</p>
    </>
  )
  const cls = `block rounded-card p-3.5 ${frame}`
  // O torneio abre a toda a gente (página pública). O mix só a membros: a
  // quem não é, a página do mix dava «não encontrado» (#535).
  if (event.tournament) return <Link to={`/torneio/${event.tournament.slug || event.tournament.id}`} className={`${cls} press`}>{body}</Link>
  if (member && !event.locked) return <Link to={`/jogo/${event.game.id}`} className={`${cls} press`}>{body}</Link>
  return <div className={`${cls} opacity-60`} aria-disabled="true">{body}</div>
}

export function ClubEvents({ club, events, isAdmin, gerirHref }) {
  const { t } = useTranslation()
  const kk = (key) => (club.kind === 'group' ? `${key}_group` : key)
  const [all, setAll] = useState(false)
  const member = club.my_status === 'member'
  const shown = all ? events : events.slice(0, SHOW)
  const blockedGames = !member && events.some((e) => !e.tournament)

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-extrabold uppercase tracking-widest text-muted">{t('clubprofile.upcoming')}</h3>
        {events.length > SHOW && !all && (
          <button type="button" onClick={() => setAll(true)} className="inline-flex min-h-[44px] items-center gap-0.5 text-sm font-extrabold text-ink-900">
            {t('clubprofile.see_all')} <ChevronRight size={15} />
          </button>
        )}
      </div>

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
        <div className="space-y-2.5">
          {shown.map((e) => <EventRow key={e.key} event={e} member={member} />)}
        </div>
      )}
    </section>
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
