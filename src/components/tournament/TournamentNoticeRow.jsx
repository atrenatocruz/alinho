// Avisos do torneio no sino (Trello #548). Vêm da mesma tabela
// `notifications` dos avisos de mix e de aulas, com o que o ecrã precisa em
// `data` (migration_tournament_suplente_aviso.sql, Dev 3).
//
// 'tournament_promoted': era suplente e subiu para dentro (alguém desistiu,
// uma vaga abriu). Antes ninguém lhe dizia — só dava conta quem voltasse à
// página do torneio. O parceiro que ainda tem de aceitar não recebe este
// aviso: já vê o convite no sino.
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Trophy } from 'lucide-react'
import { TOURNAMENT_TZ } from '../../lib/tournamentDay'
import { shortPersonName } from '../../lib/mixLogic'

//
// 'tournament_correction_requested' (Trello #485, Dev 2): um jogador pediu a
// correção de um resultado; vai aos admins do torneio, que aceitam ou
// recusam no /marcar. O aviso leva direto a esse ecrã.
//
// 'tournament_prize_changed' (AUDITORIA editar-tem-tudo, ponto 2; Francisco,
// 28 set): o organizador mudou o prémio da categoria onde estou inscrito.
// Sai da base de dados (Dev 3) quando o prize_first/prize_second muda.
// 'tournament_cancelled' (1 out, Dev 3): o organizador cancelou o torneio.
// 'tournament_entries_closed' (6 out, Dev 3): o prazo acabou e as inscrições
// fecharam sozinhas; vai a quem organiza, que já pode sortear.
// Categorias que chocam (9 out, Dev 3): 'tournament_removed_clash' a quem
// quem organiza tirou de uma categoria; 'tournament_partner_removed' ao
// parceiro que ficou sem dupla; 'tournament_clash' quando o sorteio ou o
// horário põem dois jogos da mesma pessoa quase à mesma hora.
// 'tournament_category_time_changed' (13 out, Dev 3): quem organiza mudou o
// dia ou a hora da categoria onde estou inscrito, antes do sorteio.
// 'tournament_unpublished' (13 out, Dev 3): voltou a rascunho com inscritos —
// «retirado», nunca «cancelado», como no mix.
// 'tournament_drawn' e 'tournament_finished' (14 out, Dev 3): saiu o sorteio
// da minha categoria (com o meu primeiro jogo, se já houver horas) e a minha
// categoria terminou (com o meu lugar, se fiquei no pódio).
export const TOURNAMENT_NOTICE_KINDS = ['tournament_promoted', 'tournament_correction_requested', 'tournament_prize_changed', 'tournament_cancelled', 'tournament_entries_closed',
  'tournament_removed_clash', 'tournament_partner_removed', 'tournament_clash', 'tournament_category_time_changed', 'tournament_unpublished',
  'tournament_drawn', 'tournament_finished']

/** «150 € + troféu» ou, com os dois, «1.º 150 € · 2.º 50 €». */
export function prizeText(first, second, t) {
  const a = (first || '').trim()
  const b = (second || '').trim()
  if (a && b) return `${t('tournament.notice_prize_first', { prize: a })} · ${t('tournament.notice_prize_second', { prize: b })}`
  if (b) return t('tournament.notice_prize_second', { prize: b })
  return a
}

/** «qui, 2 out» — o dia até ao qual o parceiro tem de aceitar, na hora do
 *  torneio. */
function dayOf(iso, locale) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const part = (opts) => d.toLocaleDateString(locale, { ...opts, timeZone: TOURNAMENT_TZ }).replace(/\./g, '')
  return `${part({ weekday: 'short' })}, ${part({ day: 'numeric' })} ${part({ month: 'short' })}`
}

/** «sáb 18 out» — um dia sem hora («2026-10-18»), como vem da categoria. */
function plainDay(day, locale) {
  if (!day) return ''
  const d = new Date(`${String(day).slice(0, 10)}T12:00`)
  if (Number.isNaN(d.getTime())) return ''
  const part = (opts) => d.toLocaleDateString(locale, opts).replace(/\./g, '')
  return `${part({ weekday: 'short' })} ${part({ day: 'numeric' })} ${part({ month: 'short' })}`
}

/** «A M4 do Open mudou para sáb 18 out, 14:00 (era 12:00).» — com o dia
 *  antigo só quando o dia também mudou. As horas vêm como «15:00:00». */
export function timeChangedText(d, t, locale) {
  const hm = (v) => (v ? String(v).slice(0, 5) : '')
  const when = (day, time) => [plainDay(day, locale), hm(time)].filter(Boolean).join(', ')
  const sameDay = String(d.old_day || '').slice(0, 10) === String(d.new_day || '').slice(0, 10)
  return t('tournament.notice_time_changed', {
    code: d.category_code || '',
    tournament: d.tournament_name || '',
    when: when(d.new_day, d.new_time),
    was: sameDay ? hm(d.old_time) || plainDay(d.old_day, locale) : when(d.old_day, d.old_time),
  })
}

/** «sáb 17 out, 10:00» — um instante, na hora do torneio. */
function momentText(iso, locale) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const part = (opts) => d.toLocaleDateString(locale, { ...opts, timeZone: TOURNAMENT_TZ }).replace(/\./g, '')
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: TOURNAMENT_TZ })
  return `${part({ weekday: 'short' })} ${part({ day: 'numeric' })} ${part({ month: 'short' })}, ${time}`
}

/** Saiu o sorteio: o primeiro jogo da minha dupla, ou «as horas saem em
 *  breve» enquanto não houver horário. */
export function drawnText(d, t, locale) {
  const vars = { code: d.category_code || '', tournament: d.tournament_name || '' }
  if (!d.first_match_at) return t('tournament.notice_drawn_no_time', vars)
  const when = momentText(d.first_match_at, locale)
  return d.court_name
    ? t('tournament.notice_drawn_court', { ...vars, when, court: d.court_name })
    : t('tournament.notice_drawn', { ...vars, when })
}

/** Quem ganhou: o nome da equipa, se tiver; senão os dois nomes curtos
 *  («Ana Moreira / Rui Costa» → «Ana M. e Rui C.», UX 14 out). */
export function championText(name, t) {
  const raw = String(name || '').trim()
  if (!raw.includes(' / ')) return raw
  return raw.split(' / ').map(shortPersonName).filter(Boolean).join(` ${t('tournament.tree.and')} `)
}

/** A categoria terminou: o meu lugar no pódio, ou quem ganhou. */
export function finishedText(d, t) {
  const vars = { code: d.category_code || '', tournament: d.tournament_name || '', champion: championText(d.champion_name, t) }
  const place = Number(d.final_position)
  if (place === 1) return t('tournament.notice_finished_won', vars)
  if (place === 2 || place === 3) return t('tournament.notice_finished_place', { ...vars, place })
  return vars.champion ? t('tournament.notice_finished_champion', vars) : t('tournament.notice_finished', vars)
}

export default function TournamentNoticeRow({ notice, onOpen }) {
  const { t, i18n } = useTranslation()
  const d = notice.data || {}
  const vars = {
    tournament: d.tournament_name || '',
    code: d.category_code || d.category_name || '',
    partner: d.partner_name || '',
    day: dayOf(d.respond_by, i18n.language),
    name: d.requester_name || d.removed_name || '',
    kept: d.kept_code || '',
    a: d.code_a || '',
    b: d.code_b || '',
    ta: d.at_a ? new Date(d.at_a).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit', timeZone: TOURNAMENT_TZ }) : '',
    tb: d.at_b ? new Date(d.at_b).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit', timeZone: TOURNAMENT_TZ }) : '',
  }
  const correction = notice.kind === 'tournament_correction_requested'
  const prize = notice.kind === 'tournament_prize_changed' ? prizeText(d.prize_first, d.prize_second, t) : null
  // Texto aprovado pelo Francisco (via PO, 25 set) — não mudar.
  const text = correction
    ? t('tournament.notice_correction_requested', vars)
    : notice.kind === 'tournament_cancelled'
    ? t('tournament.notice_cancelled', vars)
    : notice.kind === 'tournament_removed_clash'
    // Sem kept_code (tirado sem choque, Dev 3), sem o «Continuas no …».
    ? t(vars.kept ? 'tclash.notice_removed' : 'tclash.notice_removed_plain', vars)
    : notice.kind === 'tournament_partner_removed'
    ? t('tclash.notice_partner_removed', vars)
    : notice.kind === 'tournament_clash'
    ? t('tclash.notice_clash', vars)
    : notice.kind === 'tournament_entries_closed'
    // pending_count (Dev 3, 11 out): as duplas por validar, à parte das
    // validadas. Os avisos antigos não o trazem: conta como 0.
    ? (d.entry_count != null
      ? (Number(d.pending_count) > 0
        // O total e a ação numa frase só (UX, 11 out): «…fecharam com 84
        // duplas. Valida as 4 que faltam antes do sorteio.»
        ? `${t('tournament.notice_entries_closed_total', { ...vars, count: Number(d.entry_count) + Number(d.pending_count) })} ${t('tournament.notice_entries_closed_validate', { count: Number(d.pending_count) })}`
        : t('tournament.notice_entries_closed_count', { ...vars, count: Number(d.entry_count) }))
      : t('tournament.notice_entries_closed', vars))
    : notice.kind === 'tournament_drawn'
    ? drawnText(d, t, i18n.language)
    : notice.kind === 'tournament_finished'
    ? finishedText(d, t)
    : notice.kind === 'tournament_unpublished'
    ? t('tournament.notice_unpublished', vars)
    : notice.kind === 'tournament_category_time_changed'
    ? timeChangedText(d, t, i18n.language)
    : notice.kind === 'tournament_prize_changed'
    ? (prize ? t('tournament.notice_prize_changed', { ...vars, prize }) : t('tournament.notice_prize_removed', vars))
    : d.partner_pending
    ? t('tournament.notice_promoted_partner_pending', vars)
    : t('tournament.notice_promoted', vars)
  // Retirado: a página deixou de se ver, por isso o aviso não leva a ela.
  const page = notice.kind !== 'tournament_unpublished' && (d.tournament_slug || d.tournament_id) ? `/torneio/${d.tournament_slug || d.tournament_id}` : null
  const to = page ? (correction ? `${page}/marcar` : page) : '/'
  return (
    <Link to={to} onClick={() => onOpen(notice)}
      className="flex items-center gap-3 px-4 py-3 transition-colors duration-fast hover:bg-ink-50">
      <div className="w-9 h-9 rounded-full bg-kind-tournament-light text-kind-tournament-dark flex items-center justify-center shrink-0">
        <Trophy size={16} />
      </div>
      <p className="flex-1 min-w-0 text-sm text-ink-900">{text}</p>
      <span aria-hidden="true" className="w-2 h-2 rounded-full bg-lime-400 shrink-0" />
    </Link>
  )
}
