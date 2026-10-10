// «Para ti» numa linha (Home do futuro, SPEC-2, ponto 3 — aprovado pelo
// Francisco a 9 out). Os ícones empilhados, a primeira coisa, «e mais N
// coisas para ti» e ⌄; tocar abre a lista curta, uma linha por coisa. Por
// agora junta três (UX, 9 out): os resultados de jogos entre amigos por
// confirmar, os convites para jogos entre amigos e os torneios onde marco
// resultados hoje. Cada linha abre o que já abria (sem folha nova). Sem nada
// para ti, a linha não aparece. O lembrete de confirmar o número também vem
// para aqui (UX, 10 out): a linha abre a caixa de sempre numa folha.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { privateMatchActions } from '../../lib/privateMatches'
import { fromDayKey, toDayKey } from '../../lib/agenda'
import { formatDate } from '../../lib/formatDate'
import { friendsMatchTitle } from '../agenda/EventCard'
import { SectionTitle } from './MyNextGames'

/** «hoje», «ontem», «amanhã», «sexta», «sáb 18 out». */
function whenWord(dayKey, todayKey, t, lang) {
  if (!dayKey) return ''
  const days = Math.round((fromDayKey(dayKey) - fromDayKey(todayKey)) / 86400000)
  if (days === 0) return t('ui.today').toLowerCase()
  if (days === -1) return t('agenda.yesterday').toLowerCase()
  if (days === 1) return t('ui.tomorrow').toLowerCase()
  const d = fromDayKey(dayKey)
  if (days > 1 && days < 7) return formatDate(d, lang, { weekday: 'long' }).replace(/-feira$/, '')
  return `${formatDate(d, lang, { weekday: 'short' }).replace('.', '')} ${d.getDate()} ${formatDate(d, lang, { month: 'short' }).replace('.', '')}`
}

const hhmm = (time) => (time ? String(time).slice(0, 5) : null)

/** As coisas «para ti», pela ordem: confirmar, convites, marcar resultados. */
export function forYouItems({ privateMatches = [], userId, friendInvites = [], scoreToday = [], todayKey, t, lang, onConfirmPhone = null }) {
  const items = []
  if (onConfirmPhone) {
    items.push({ key: 'phone', icon: '📱', bg: '#E0F2FE', title: t('home.foryou_phone'), sub: t('home.foryou_phone_sub'), onClick: onConfirmPhone })
  }
  for (const { match: m } of privateMatchActions(privateMatches, userId).filter((a) => a.kind === 'confirm')) {
    const day = m.scheduled_date || (m.played_at ? toDayKey(new Date(m.played_at)) : null)
    items.push({
      key: `confirm:${m.id}`,
      icon: '✓',
      bg: '#F7FBD9',
      title: day ? t('home.foryou_confirm', { when: whenWord(day, todayKey, t, lang) }) : t('home.foryou_confirm_plain'),
      sub: [friendsMatchTitle(m, userId, t), m.score_a != null && m.score_b != null ? `${m.score_a}-${m.score_b}` : null].filter(Boolean).join(' · '),
      to: m.session_id ? `/jogos-privados/sessao/${m.session_id}` : '/jogos-privados',
    })
  }
  for (const inv of friendInvites) {
    const when = [whenWord(inv.scheduled_date, todayKey, t, lang), hhmm(inv.scheduled_time)].filter(Boolean)
    items.push({
      key: `invite:${inv.match_id}`,
      icon: '👥',
      bg: '#F2EDE4',
      title: when.length === 2
        ? t('home.foryou_invite_at', { name: inv.creator_name || '', when: when[0], time: when[1] })
        : when.length === 1 ? t('home.foryou_invite_day', { name: inv.creator_name || '', when: when[0] })
          : t('friends.invite_card_line', { name: inv.creator_name || '' }),
      sub: [inv.location, inv.results_with_me > 0 ? t('friends.invite_card_results', { count: inv.results_with_me }) : null].filter(Boolean).join(' · '),
      to: `/jogos-privados/sessao/${inv.match_id}`,
    })
  }
  for (const x of scoreToday) {
    items.push({
      key: `score:${x.id}`,
      icon: '🏆',
      bg: '#E9E7FB',
      title: t('tournament.score.link_cta'),
      sub: x.name,
      to: `/torneio/${x.slug || x.id}/marcar`,
    })
  }
  return items
}

const Icon = ({ item, size = 'h-8 w-8 rounded-[10px] text-sm' }) => (
  <span aria-hidden className={`flex shrink-0 items-center justify-center ${size}`} style={{ background: item.bg }}>{item.icon}</span>
)

function Row({ item }) {
  const cls = 'press flex w-full items-center gap-2.5 border-t border-[#F3F4F6] bg-white px-3 py-2.5 text-left first:border-t-0'
  const Tag = item.onClick ? 'button' : Link
  const props = item.onClick ? { type: 'button', onClick: item.onClick } : { to: item.to }
  return (
    <Tag {...props} className={cls}>
      <Icon item={item} />
      <span className="min-w-0 flex-1">
        <b className="line-clamp-2 block text-[13.5px] font-extrabold leading-snug text-ink-900">{item.title}</b>
        {item.sub && <small className="block truncate text-[11.5px] text-muted">{item.sub}</small>}
      </span>
      <ChevronRight size={16} className="shrink-0 text-[#9CA3AF]" />
    </Tag>
  )
}

export default function ForYouLine({ items, show = true }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  if (!show || !items.length) return null
  const head = <SectionTitle right={<span className="text-[11px] font-bold text-[#9CA3AF]">{items.length}</span>}>{t('home.foryou_title')}</SectionTitle>
  // Uma coisa só: a linha já é ela, toca e abre.
  if (open || items.length === 1) {
    return (
      <section aria-label={t('home.foryou_title')}>
        {head}
        <div className="overflow-hidden rounded-[18px] border border-line bg-white">
          {items.map((it) => <Row key={it.key} item={it} />)}
        </div>
      </section>
    )
  }
  return (
    <section aria-label={t('home.foryou_title')}>
      {head}
      <button type="button" onClick={() => setOpen(true)} aria-expanded={false}
        className="press flex w-full items-center gap-2.5 rounded-2xl border border-line bg-white px-3 py-[9px] text-left">
        <span className="flex shrink-0">
          {items.slice(0, 4).map((it, i) => (
            <span key={it.key} className={i ? '-ml-2' : ''}>
              <Icon item={it} size="h-7 w-7 rounded-[9px] border-2 border-white text-[13px]" />
            </span>
          ))}
        </span>
        <span className="min-w-0 flex-1">
          <b className="block truncate text-[13px] font-extrabold text-ink-900">{items[0].title}</b>
          <small className="block truncate text-[11.5px] text-muted">{t('home.foryou_more', { count: items.length - 1 })}</small>
        </span>
        <ChevronDown size={18} className="shrink-0 text-[#9CA3AF]" />
      </button>
    </section>
  )
}
