// «Os teus próximos jogos» (Home do futuro, SPEC-2, ponto 1 — aprovado pelo
// Francisco a 9 out, design-handoff/2026-10-08-home-do-futuro). Logo por
// baixo da barra: uma fila que desliza com um cartão pequeno por evento em
// que estou (inscrito, aceitei), por ordem de data e hora. Cada cartão na cor
// do tipo: a hora grande, o dia e o tipo na mesma linha; o nome; o sítio; e,
// encostada em baixo, «✓ Estás dentro». Tocar abre o evento.
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Settings } from 'lucide-react'
import { KIND_STYLE, friendsMatchTitle } from '../agenda/EventCard'
import { eventTitle, eventPlace } from '../agenda/homeSearchMatch'
import { fromDayKey, EVENT_KINDS } from '../../lib/agenda'
import { formatDate, formatTime } from '../../lib/formatDate'
import { InviteFaces } from '../friends/FriendInviteEventCard'
import { kindColorsOf } from '../agenda/HomeCard'
import NoTime from '../NoTime'

// Os estados em que «estou dentro»: não os convites por responder, os pedidos,
// a lista de suplentes nem o «não vou».
const IN_STATES = new Set(['in', 'confirm', 'playing'])

/** Os meus eventos ainda por jogar, por ordem de data e hora; os convites
 *  por responder da sessão nova de amigos vêm primeiro (convite-amigos-na-
 *  home, 12 out). Um jogo já começado continua até acabar. */
export function myNextEvents(events, todayKey) {
  const invites = events
    .filter((e) => e.source === 'friend_invite' && e.myState === 'invited' && !e.finished && e.dayKey >= todayKey)
    .sort((a, b) => a.startsAt - b.startsAt)
  return [...invites, ...events
    .filter((e) => e.mine && IN_STATES.has(e.myState) && !e.finished && e.dayKey >= todayKey)
    .sort((a, b) => a.startsAt - b.startsAt)]
}

/** Com um tipo ou clube escolhido na barra, só os desses (UX, 9 out); sem
 *  nenhum, a secção não aparece. `null` = sem filtro de tipo nem de clube. */
function narrowBy(filters) {
  if (!filters) return null
  const allKinds = EVENT_KINDS.every((k) => filters.kinds?.includes(k))
  if (allKinds && filters.orgIds == null) return null
  const kinds = new Set(filters.kinds || [])
  const orgIds = filters.orgIds ? new Set(filters.orgIds) : null
  return (e) => kinds.has(e.kind) && (!orgIds || (e.orgId != null && orgIds.has(e.orgId)))
}

/** «hoje», «amanhã», «sexta», «18 out» — como na pesquisa da Home. */
function whenShort(dayKey, todayKey, t, lang) {
  const days = Math.round((fromDayKey(dayKey) - fromDayKey(todayKey)) / 86400000)
  if (days === 0) return t('ui.today').toLowerCase()
  if (days === 1) return t('ui.tomorrow').toLowerCase()
  const d = fromDayKey(dayKey)
  if (days > 1 && days < 7) return formatDate(d, lang, { weekday: 'long' }).replace(/-feira$/, '')
  return `${d.getDate()} ${formatDate(d, lang, { month: 'short' }).replace('.', '')}`
}

// O tipo ao lado da hora, curto para caber no cartão («19:00 sexta · Amigos»).
const SHORT_KIND = { friends: 'home.next_kind_friends' }

/** O convite por responder: branco, borda preta de 2 px, «A Rita
 *  convidou-te», as fotos de quem aceitou e os lugares que faltam;
 *  «Responder» e «Novo» em baixo. Tocar abre o ecrã de responder. */
function InviteNextCard({ event, todayKey, to }) {
  const { t, i18n } = useTranslation()
  const r = event.raw
  const place = [event.orgName, r.location].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(' · ')
  return (
    <Link to={to} className="press flex w-[208px] shrink-0 snap-start flex-col overflow-hidden rounded-2xl bg-white text-left shadow-[0_0_0_2px_#111111]">
      <Band kind="friends" time={event.hasTime === false ? <NoTime onBand /> : formatTime(event.startsAt, i18n.language, { hour: '2-digit', minute: '2-digit' })}
        sub={`${whenShort(event.dayKey, todayKey, t, i18n.language)} · ${t(SHORT_KIND.friends)}`} />
      <div className="flex flex-1 flex-col px-3 pb-2.5 pt-2">
        <p className="line-clamp-2 font-display text-[14px] font-extrabold leading-[1.2] text-ink-900">{t('home.invite_by', { name: r.creatorFirst })}</p>
        {place && <small className="block truncate text-[11.5px] leading-[1.3] text-[#5B6068]">{place}</small>}
        <span className="mb-2 mt-1.5"><InviteFaces accepted={r.accepted} slots={r.slots} size="w-6 h-6 text-[9px]" /></span>
        <p className="mt-auto flex items-center justify-between font-display text-[12px] font-bold text-ink-900">
          {t('home.invite_answer')}
          <span className="rounded-full bg-lime-400 px-2 py-0.5 text-[10.5px] font-extrabold text-ink-900">{t('home.invite_new')}</span>
        </p>
      </div>
    </Link>
  )
}

/** R2 (13 out): a faixa da cor do tipo com a hora grande e «hoje · Mix». */
function Band({ kind, time, sub }) {
  return (
    <div className="flex w-full items-baseline gap-2 px-3 py-2 text-white" style={{ background: kindColorsOf(kind).strong }}>
      <b className="font-display text-[20px] font-extrabold leading-none tracking-[-.02em] tabular-nums">{time}</b>
      <span className="truncate font-display text-[11.5px] font-medium leading-none opacity-90">{sub}</span>
    </div>
  )
}

function NextCard({ event, todayKey, userId, to }) {
  const { t, i18n } = useTranslation()
  if (event.source === 'friend_invite' && event.myState === 'invited') return <InviteNextCard event={event} todayKey={todayKey} to={to} />
  const style = KIND_STYLE[event.kind] || KIND_STYLE.mix
  const title = eventTitle(event)
    || (event.source === 'private_match' || event.source === 'group_match' ? friendsMatchTitle(event.raw || {}, userId, t) : '')
    // Um jogo entre amigos aceite, ainda sem equipas: «Rita e amigos».
    || (event.source === 'friend_invite' ? t('agenda.played_friends_title', { name: event.raw.isCreator ? t('agenda.you') : event.raw.creatorFirst }) : '')
    || t(style.labelKey)
  const place = [event.orgName, eventPlace(event)].filter(Boolean).join(' · ')
  const body = (
    <>
      <Band kind={event.kind} time={event.hasTime === false ? <NoTime onBand /> : formatTime(event.startsAt, i18n.language, { hour: '2-digit', minute: '2-digit' })}
        sub={`${whenShort(event.dayKey, todayKey, t, i18n.language)} · ${t(SHORT_KIND[event.kind] || style.labelKey)}`} />
      <div className="flex flex-1 flex-col px-3 pb-2.5 pt-2">
        <p className="line-clamp-2 font-display text-[14px] font-extrabold leading-[1.2] text-ink-900">{title}</p>
        {place && <small className="block truncate text-[11.5px] leading-[1.3] text-[#5B6068]">{place}</small>}
        {/* «Estás dentro» para todos, também quem foi convidado e aceitou (UX, 13 out). */}
        <em className="mt-auto block pt-[7px] font-display text-[12px] font-bold not-italic leading-none text-[#3F6212]">✓ {t('home.next_in')}</em>
      </div>
    </>
  )
  const cls = 'flex w-[208px] shrink-0 snap-start flex-col overflow-hidden rounded-2xl bg-white text-left shadow-[0_1px_2px_rgba(17,17,17,.06)]'
  return to ? <Link to={to} className={`press ${cls}`}>{body}</Link> : <div className={cls}>{body}</div>
}

/** A pastilha «Personalizar» ao lado do título, com o ícone de linha Settings
 *  (o «⚙» era emoji a cores no iPhone; SPEC 2026-10-19-icone-personalizar).
 *  O ícone sobe 1,75 px (1 px no botão comprido) para o centro da roda bater
 *  no centro das maiúsculas, medido na print (UX, 19 out). */
export function CustomizePill({ onClick, long = false }) {
  const { t } = useTranslation()
  if (long) {
    return (
      <button type="button" onClick={onClick}
        className="press mx-auto mt-5 flex h-10 items-center justify-center gap-1.5 rounded-full border-[1.5px] border-dashed border-[#D1D5DB] bg-white px-4 text-[12.5px] font-extrabold text-ink-700">
        <Settings size={15} strokeWidth={2.2} color="#374151" aria-hidden="true" className="shrink-0 -translate-y-px" /><span className="leading-none">{t('home.customize_home')}</span>
      </button>
    )
  }
  return (
    <button type="button" onClick={onClick}
      className="press flex h-7 shrink-0 items-center gap-[5px] rounded-full border border-line bg-white px-2.5 text-[11.5px] font-extrabold normal-case tracking-normal text-ink-900">
      <Settings size={13} strokeWidth={2.2} color="#040404" aria-hidden="true" className="shrink-0 -translate-y-[1.75px]" /><span className="leading-none">{t('home.customize')}</span>
    </button>
  )
}

export function SectionTitle({ children, right = null }) {
  return (
    <div className="mb-2 flex min-h-[28px] items-center justify-between gap-2">
      {/* Mono 500 e cinzento, como no protótipo (UX, 13 out). */}
      <p className="font-mono text-[10.5px] font-medium uppercase tracking-[.08em] text-[#4F535A]">{children}</p>
      {right}
    </div>
  )
}

/** `events`: os da Home; `linkFor`: o caminho de cada evento (o mesmo da
 *  pesquisa); `filters`: os da barra.
 *  `show = false` (escondido no Personalizar): só a pastilha, para se voltar a ligar. */
export default function MyNextGames({ events, todayKey, userId, linkFor, onCustomize, filters = null, show = true }) {
  const { t } = useTranslation()
  const pill = <CustomizePill onClick={onCustomize} />
  if (!show) return <div className="flex justify-end">{pill}</div>
  const narrow = narrowBy(filters)
  const rows = myNextEvents(events, todayKey).filter((e) => !narrow || narrow(e))
  // Vazio por causa de um filtro: nada em cima; chega o «Personalizar a Home» do fim (UX, 10 out).
  if (narrow && rows.length === 0) return null
  return (
    <section aria-label={t('home.next_title')}>
      <SectionTitle right={pill}>{t('home.next_title')}</SectionTitle>
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[#D1D5DB] p-3 text-[12.5px] text-muted">
          <b className="text-ink-900">{t('home.next_empty_title')}</b> {t('home.next_empty_text')}
        </p>
      ) : (
        <div className="-mx-4 flex snap-x scroll-pl-4 gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
          {rows.map((e) => <NextCard key={e.key} event={e} todayKey={todayKey} userId={userId} to={linkFor(e)} />)}
        </div>
      )}
    </section>
  )
}
