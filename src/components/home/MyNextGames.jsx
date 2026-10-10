// «Os teus próximos jogos» (Home do futuro, SPEC-2, ponto 1 — aprovado pelo
// Francisco a 9 out, design-handoff/2026-10-08-home-do-futuro). Logo por
// baixo da barra: uma fila que desliza com um cartão pequeno por evento em
// que estou (inscrito, aceitei), por ordem de data e hora. Cada cartão na cor
// do tipo: a hora grande, o dia e o tipo na mesma linha; o nome; o sítio; e,
// encostada em baixo, «✓ Estás dentro» / «✓ Aceitaste». Tocar abre o evento.
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { KIND_STYLE, friendsMatchTitle } from '../agenda/EventCard'
import { eventTitle, eventPlace } from '../agenda/homeSearchMatch'
import { fromDayKey, EVENT_KINDS } from '../../lib/agenda'
import { formatDate, formatTime } from '../../lib/formatDate'

// Os estados em que «estou dentro»: não os convites por responder, os pedidos,
// a lista de suplentes nem o «não vou».
const IN_STATES = new Set(['in', 'confirm', 'playing'])

/** Os meus eventos ainda por jogar, por ordem de data e hora. */
export function myNextEvents(events, todayKey) {
  return events
    .filter((e) => e.mine && IN_STATES.has(e.myState) && !e.finished && e.dayKey >= todayKey)
    .sort((a, b) => a.startsAt - b.startsAt)
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

// Nos jogos entre amigos, quem foi convidado lê «Aceitaste».
const FRIEND_SOURCES = new Set(['private_match', 'friend_session'])

function NextCard({ event, todayKey, userId, to }) {
  const { t, i18n } = useTranslation()
  const style = KIND_STYLE[event.kind] || KIND_STYLE.mix
  const title = eventTitle(event)
    || (event.source === 'private_match' || event.source === 'group_match' ? friendsMatchTitle(event.raw || {}, userId, t) : '')
    || t(style.labelKey)
  const place = [event.orgName, eventPlace(event)].filter(Boolean).join(' · ')
  const accepted = FRIEND_SOURCES.has(event.source) && event.raw && event.raw.is_creator === false
  const body = (
    <>
      <p className="flex items-baseline whitespace-nowrap font-display text-[20px] font-extrabold leading-none text-ink-900">
        {event.hasTime === false ? '—' : formatTime(event.startsAt, i18n.language, { hour: '2-digit', minute: '2-digit' })}
        <small className="ml-[5px] font-sans text-[11px] font-bold text-[#4B5563]">{whenShort(event.dayKey, todayKey, t, i18n.language)}</small>
        <span className={`ml-1 min-w-0 truncate font-sans text-[11px] font-extrabold ${style.text}`}>· {t(SHORT_KIND[event.kind] || style.labelKey)}</span>
      </p>
      <p className="mt-1 line-clamp-2 text-[13px] font-extrabold leading-[1.3] text-ink-900">{title}</p>
      {place && <p className="mb-3.5 mt-0.5 truncate text-[11px] text-[#4B5563]">{place}</p>}
      <p className="mt-auto border-t border-black/[.08] pt-2 text-[11px] font-bold text-ink-900">
        ✓ {t(accepted ? 'home.next_accepted' : 'home.next_in')}
      </p>
    </>
  )
  const cls = `flex w-[210px] shrink-0 snap-start flex-col rounded-2xl border px-[11px] py-2.5 text-left ${style.card}`
  return to ? <Link to={to} className={`press ${cls}`}>{body}</Link> : <div className={cls}>{body}</div>
}

/** A pastilha «⚙ Personalizar» ao lado do título. */
export function CustomizePill({ onClick, long = false }) {
  const { t } = useTranslation()
  if (long) {
    return (
      <button type="button" onClick={onClick}
        className="press mx-auto mt-5 flex h-10 items-center justify-center gap-1.5 rounded-full border-[1.5px] border-dashed border-[#D1D5DB] bg-white px-4 text-[12.5px] font-extrabold text-ink-700">
        ⚙ {t('home.customize_home')}
      </button>
    )
  }
  return (
    <button type="button" onClick={onClick}
      className="press flex h-7 shrink-0 items-center rounded-full border border-line bg-white px-2.5 text-[11.5px] font-extrabold normal-case tracking-normal text-ink-900">
      ⚙ {t('home.customize')}
    </button>
  )
}

export function SectionTitle({ children, right = null }) {
  return (
    <div className="mb-2 flex min-h-[28px] items-center justify-between gap-2">
      <p className="font-mono text-[10.5px] font-extrabold uppercase tracking-[.08em] text-ink-700">{children}</p>
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
  if (narrow && rows.length === 0) return <div className="flex justify-end">{pill}</div>
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
