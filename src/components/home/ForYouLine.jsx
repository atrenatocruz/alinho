// «Para ti» numa linha (Home do futuro, SPEC-2, ponto 3 — aprovado pelo
// Francisco a 9 out). Os ícones empilhados, a primeira coisa, «e mais N
// coisas para ti» e ⌄; tocar abre a lista curta, uma linha por coisa. Por
// agora junta três (UX, 9 out): os resultados de jogos entre amigos por
// confirmar, os convites para jogos entre amigos e os torneios onde marco
// resultados hoje. Cada linha abre o que já abria (sem folha nova). Sem nada
// para ti, a linha não aparece. O lembrete de confirmar o número também vem
// para aqui (UX, 10 out): a linha abre a caixa de sempre numa folha.
// R2 (13 out): a linha branca com o Alino pequeno, «Para ti · N» e o resumo;
// aberta, uma linha por coisa com o botão à direita, a preto (UX).
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { privateMatchActions } from '../../lib/privateMatches'
import { fromDayKey, toDayKey } from '../../lib/agenda'
import { formatDate } from '../../lib/formatDate'
import { friendsMatchTitle } from '../agenda/EventCard'
import { KIND_COLORS } from '../../lib/kindColors'

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
    items.push({ key: 'phone', icon: '📱', bg: '#E0F2FE', title: t('home.foryou_phone'), sub: t('home.foryou_phone_sub'), onClick: onConfirmPhone, cta: t('home.foryou_cta_phone') })
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
      cta: t('home.foryou_cta_confirm'),
    })
  }
  for (const inv of friendInvites) {
    const when = [whenWord(inv.scheduled_date, todayKey, t, lang), hhmm(inv.scheduled_time)].filter(Boolean)
    items.push({
      key: `invite:${inv.match_id}`,
      icon: '👥',
      bg: KIND_COLORS.friends.light,
      title: when.length === 2
        ? t('home.foryou_invite_at', { name: inv.creator_name || '', when: when[0], time: when[1] })
        : when.length === 1 ? t('home.foryou_invite_day', { name: inv.creator_name || '', when: when[0] })
          : t('friends.invite_card_line', { name: inv.creator_name || '' }),
      sub: [inv.location, inv.results_with_me > 0 ? t('friends.invite_card_results', { count: inv.results_with_me }) : null].filter(Boolean).join(' · '),
      to: `/jogos-privados/sessao/${inv.match_id}`,
      cta: t('home.foryou_cta_answer'),
    })
  }
  for (const x of scoreToday) {
    items.push({
      key: `score:${x.id}`,
      icon: '🏆',
      bg: KIND_COLORS.tournament.light,
      title: t('tournament.score.link_cta'),
      sub: x.name,
      to: `/torneio/${x.slug || x.id}/marcar`,
      cta: t('home.foryou_cta_score'),
    })
  }
  return items
}

const Icon = ({ item }) => (
  <span aria-hidden className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] text-[15px]" style={{ background: item.bg }}>{item.icon}</span>
)

/** Uma coisa: o ícone, o que é e, à direita, o botão (preto). */
function Row({ item }) {
  const navigate = useNavigate()
  const go = () => (item.onClick ? item.onClick() : navigate(item.to))
  return (
    <div className="flex items-center gap-3 border-t border-[#F0F1EE] px-3.5 py-3">
      <Icon item={item} />
      <button type="button" onClick={go} className="min-w-0 flex-1 text-left">
        <b className="line-clamp-2 block font-display text-[13.5px] font-extrabold leading-[1.25] text-ink-900">{item.title}</b>
        {item.sub && <small className="mt-0.5 block truncate text-[12px] leading-[1.35] text-[#5B6068]">{item.sub}</small>}
      </button>
      {item.cta && (
        <button type="button" onClick={go}
          // A preto: o lima fica só no botão de cada cartão de evento (UX, 13 out).
          className="press shrink-0 whitespace-nowrap rounded-[12px] bg-ink-900 px-3.5 py-2.5 font-display text-[13px] font-extrabold leading-none text-white">
          {item.cta}
        </button>
      )}
    </div>
  )
}

export default function ForYouLine({ items, show = true }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  if (!show || !items.length) return null
  // O resumo: sem repetidos e, com mais de duas coisas, a primeira e «e mais
  // N» (QA, 13 out: com 10 avisos ocupava meio ecrã).
  const titles = [...new Set(items.map((it) => it.title).filter(Boolean))]
  const summary = items.length <= 2 ? titles.join(' · ') : `${titles[0]} ${t('home.foryou_more', { count: items.length - 1 })}`
  return (
    <section aria-label={t('home.foryou_title')}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className={`press flex w-full items-center gap-3 bg-white px-3.5 py-3 text-left shadow-[0_1px_2px_rgba(17,17,17,.06)] ${open ? 'rounded-t-2xl' : 'rounded-2xl'}`}>
        <img src="/alino/alino-ola.webp" alt="" aria-hidden="true" className="h-10 w-10 shrink-0 object-contain" />
        <span className="min-w-0 flex-1">
          <b className="block font-display text-[15px] font-extrabold text-ink-900">{t('home.foryou_title')} · {items.length}</b>
          <small className={`block text-[12.5px] leading-[1.35] text-[#5B6068] ${open ? '' : 'line-clamp-2'}`}>{summary}</small>
        </span>
        {open ? <ChevronUp size={18} className="shrink-0 text-[#9CA3AF]" /> : <ChevronDown size={18} className="shrink-0 text-[#9CA3AF]" />}
      </button>
      {open && (
        <div className="overflow-hidden rounded-b-2xl bg-white shadow-[0_1px_2px_rgba(17,17,17,.06)]">
          {items.map((it) => <Row key={it.key} item={it} />)}
        </div>
      )}
    </section>
  )
}
