// Os cartões da lista «Jogos entre amigos» com vida (SPEC 2026-10-12-lista-
// jogos-amigos, aprovada pelo Francisco a 12 out: «Bem melhor»). Três tipos,
// pelo estado do jogo:
//   · a jogar agora (live) — cartão preto, com as duplas da ronda em curso,
//     as rondas ganhas em grande e «Marcar a ronda N» (branco);
//   · por fechar (sem «Terminar») — cartão branco, o que já há e, em baixo,
//     o que falta a vermelho («Falta enviar o resultado», «Falta 1 pessoa
//     responder») com a ação à direita («Enviar ›» / «Ver ›»);
//   · histórico (enviado) — cartão bege, quem ganhou primeiro com 🏆, o
//     resultado em grande, a duração e «↗» para partilhar.
// Em todos, «Criado por ti» / «Criado por Rita F.» (acerto de 12 out).
// Dados: list_my_friend_sessions (Dev 3, cff94cff).
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Users } from 'lucide-react'
import { Avatar, EmptyState } from '../ui'
import { kindLabel } from './FriendRoundSheet'
import { pairNames, durationText, sessionDuration } from './friendResult'
import { shortName } from './friendShare'
import { dayText } from './dayText'

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const BEGE = 'bg-[#F2EDE4] border-[#DCD1BF]'
const pill = 'shrink-0 whitespace-nowrap rounded-full px-2 py-[3px] text-[11px] font-extrabold'

function topLine(t, i18n, s) {
  const day = s.scheduled_date === localDay() ? t('friends.list_today') : dayText(s.scheduled_date, i18n.language)
  return [day, s.scheduled_time ? String(s.scheduled_time).slice(0, 5) : null, s.org_name || s.location].filter(Boolean).join(' · ')
}

function creatorText(t, s) {
  if (s.is_creator) return t('friends.created_by_me')
  return s.creator?.name ? t('friends.created_by', { name: shortName(s.creator.name) }) : null
}

/** As fotos de uma dupla, encavalitadas. `ring` = a cor por baixo. */
function Faces({ people = [], ring = 'ring-white', faded = false }) {
  return (
    <span className={`flex shrink-0 -space-x-2 ${faded ? 'opacity-70' : ''}`}>
      {people.map((p, i) => (
        <span key={p.user_id || p.invitee_id || `${p.name}-${i}`} className={`rounded-full ring-2 ${ring}`}>
          <Avatar name={p.name} url={p.avatar_url} size="w-7 h-7 text-[10px]" />
        </span>
      ))}
    </span>
  )
}

/** «🏆 Venceste» / «✓ Contou» / «Amigável» / «À espera de Ana M.» / «Fora do ranking». */
function StatePills({ s }) {
  const { t } = useTranslation()
  const out = []
  if (s.i_won) out.push(<span key="won" className={`${pill} bg-lime-400 text-ink-900`}>{t('friends.list_you_won')}</span>)
  if (s.ranking_state === 'counted') out.push(<span key="st" className={`${pill} bg-[#DCFCE7] text-[#14532D]`}>{t('friends.list_counted')}</span>)
  else if (s.ranking_state === 'rejected') out.push(<span key="st" className={`${pill} bg-danger/10 text-danger`}>{t('friends.list_rejected')}</span>)
  else if (s.ranking_state === 'waiting') {
    const first = s.waiting_for?.[0]?.name
    out.push(<span key="st" className={`${pill} bg-[#FEF3C7] text-[#92400E]`}>{first ? t('friends.list_waiting', { name: shortName(first) }) : t('friends.list_waiting_some')}</span>)
  } else out.push(<span key="st" className={`${pill} bg-white text-ink-700`}>{t('friends.list_friendly')}</span>)
  return <span className="flex shrink-0 flex-wrap justify-end gap-1">{out}</span>
}

/** A jogar agora: cartão preto. */
function LiveCard({ s }) {
  const { t, i18n } = useTranslation()
  const r = s.current_round
  const lp = s.live_pair
  const aLeads = lp ? lp.rounds_a >= lp.rounds_b : true
  const sofar = sessionDuration(s, { live: true })
  const hint = [sofar ? t('friends.list_so_far', { time: durationText(t, sofar.minutes) }) : null,
    r?.round_kind ? t('friends.list_kind_in_round', { kind: kindLabel(t, r.round_kind, r.round_points_to), n: r.number }) : null].filter(Boolean)
  const row = (team, rounds, lead) => (
    <div className="flex items-center gap-2.5 rounded-ctrl bg-white/10 px-3 py-2">
      <Faces people={team} ring="ring-[#26262A]" />
      <span className={`min-w-0 flex-1 truncate text-sm font-extrabold ${lead ? 'text-white' : 'text-white/70'}`}>{pairNames(team)}</span>
      <span className={`font-extrabold text-2xl tabular-nums ${lead ? 'text-lime-400' : 'text-white/50'}`}>{rounds}</span>
    </div>
  )
  return (
    <div className="relative rounded-card bg-ink-900 p-3.5 text-white">
      <Link to={`/jogos-privados/sessao/${s.match_id}`} className="absolute inset-0 rounded-card" aria-label={topLine(t, i18n, s)} />
      <p className="flex items-center gap-2 text-[15px] font-extrabold">
        <span aria-hidden className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-danger" />
        {r ? t('friends.list_live_round', { n: r.number }) : t('friends.list_live')}
      </p>
      <p className="mt-0.5 pl-[18px] text-xs text-white/60">{topLine(t, i18n, s)}</p>
      {creatorText(t, s) && <p className="pl-[18px] text-xs text-white/45">{creatorText(t, s)}</p>}
      {lp && (
        <div className="mt-3 space-y-1.5">
          {row(lp.team_a, lp.rounds_a, aLeads)}
          {row(lp.team_b, lp.rounds_b, !aLeads)}
        </div>
      )}
      {hint.length > 0 && <p className="mt-2 text-xs text-white/60">⏱ {hint.join(' · ')}</p>}
      {r && (
        <Link to={`/jogos-privados/sessao/${s.match_id}?marcar=1`}
          className="press relative mt-3 flex min-h-[48px] w-full items-center justify-center rounded-ctrl bg-white px-4 text-[15px] font-extrabold text-ink-900">
          {t('friends.list_mark_round', { n: r.number })}
        </Link>
      )}
    </div>
  )
}

/** Por fechar: cartão branco, o que falta a vermelho e a ação à direita. */
function ToCloseCard({ s }) {
  const { t, i18n } = useTranslation()
  const pairs = Array.isArray(s.pairs) ? s.pairs : []
  const single = pairs.length === 1 ? pairs[0] : null
  const people = Array.isArray(s.people_list) ? s.people_list : []
  const answered = people.filter((p) => p.status !== 'pending')
  const startsAt = s.scheduled_date ? new Date(`${s.scheduled_date}T${String(s.scheduled_time || '00:00').slice(0, 5)}`) : null
  const before = startsAt && !Number.isNaN(startsAt.getTime()) && startsAt > new Date()
  const missing = s.pending > 0 ? t('friends.list_missing_people', { count: s.pending })
    : (s.rounds_count || 0) > 0 || !before ? t('friends.list_missing_send') : null
  const send = !s.pending && ((s.rounds_count || 0) > 0 || !before)
  return (
    <Link to={`/jogos-privados/sessao/${s.match_id}${send ? '?enviar=1' : ''}`} className="press block rounded-card border border-line bg-white p-3.5">
      <p className="truncate text-xs font-extrabold text-ink-700">{topLine(t, i18n, s)}</p>
      {creatorText(t, s) && <p className="text-xs text-muted">{creatorText(t, s)}</p>}
      {single && (single.rounds_a + single.rounds_b > 0) ? (
        <div className="mt-2.5 flex items-center gap-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="flex items-center gap-2"><Faces people={single.team_a} /><span className="truncate text-sm font-extrabold text-ink-900">{pairNames(single.team_a)}</span></p>
            <p className="flex items-center gap-2"><Faces people={single.team_b} faded /><span className="truncate text-sm font-extrabold text-muted">{pairNames(single.team_b)}</span></p>
          </div>
          <span className="font-extrabold text-xl tabular-nums text-ink-900">{single.rounds_a}–{single.rounds_b}</span>
        </div>
      ) : pairs.length > 1 || s.pairing_mode === 'rotating' ? (
        <p className="mt-2.5 flex items-center gap-2"><Faces people={answered} /><span className="text-sm font-extrabold text-ink-900">{t('friends.list_rotating', { count: s.people || 0 })}</span></p>
      ) : (
        <p className="mt-2.5 flex items-center gap-2">
          <Faces people={answered} />
          <span className="flex -space-x-2">{Array.from({ length: s.pending || 0 }, (_, i) => <span key={i} className="h-7 w-7 rounded-full border-[1.5px] border-dashed border-ink-200 bg-white" />)}</span>
          <span className="text-sm font-extrabold text-ink-900">{t('friends.list_scheduled_count', { n: answered.length, total: s.people || answered.length })}</span>
        </p>
      )}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-2.5">
        {missing ? <span className="text-sm font-extrabold text-danger">{missing}</span> : <span className="text-sm text-muted">{t('friends.list_scheduled')}</span>}
        <span className="shrink-0 text-sm font-extrabold text-ink-900">{send ? t('friends.list_action_send') : t('friends.list_action_see')}</span>
      </div>
    </Link>
  )
}

/** Histórico: cartão bege, quem ganhou primeiro, o resultado em grande. */
function HistoryCard({ s }) {
  const { t, i18n } = useTranslation()
  const pairs = Array.isArray(s.pairs) ? s.pairs : []
  const single = pairs.length === 1 ? pairs[0] : null
  const draw = single?.winner === 'draw'
  const bFirst = single?.winner === 'b'
  const top = single ? (bFirst ? single.team_b : single.team_a) : null
  const bottom = single ? (bFirst ? single.team_a : single.team_b) : null
  const rTop = single ? (bFirst ? single.rounds_b : single.rounds_a) : null
  const rBottom = single ? (bFirst ? single.rounds_a : single.rounds_b) : null
  const dur = sessionDuration(s)
  const rounds = s.rounds_count ? t('friends.rounds_count', { count: s.rounds_count }) : null
  const foot = dur ? `⏱ ${durationText(t, dur.minutes)}${rounds ? ` · ${rounds}` : ''}` : rounds
  const people = Array.isArray(s.people_list) ? s.people_list.filter((p) => p.status !== 'pending') : []
  return (
    <div className={`relative rounded-card border p-3.5 ${BEGE}`}>
      <Link to={`/jogos-privados/sessao/${s.match_id}`} className="absolute inset-0 rounded-card" aria-label={topLine(t, i18n, s)} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-extrabold text-[#6B5B45]">{topLine(t, i18n, s)}</p>
          {creatorText(t, s) && <p className="text-xs text-[#6B5B45]/80">{creatorText(t, s)}</p>}
        </div>
        <StatePills s={s} />
      </div>
      {single ? (
        <div className="mt-2.5 flex items-center gap-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="flex items-center gap-2"><Faces people={top} ring="ring-[#F2EDE4]" />
              <span className="truncate text-sm font-extrabold text-ink-900">{draw ? '' : '🏆 '}{pairNames(top)}</span></p>
            <p className="flex items-center gap-2"><Faces people={bottom} ring="ring-[#F2EDE4]" faded={!draw} />
              <span className={`truncate text-sm font-extrabold ${draw ? 'text-ink-900' : 'text-muted'}`}>{pairNames(bottom)}</span></p>
          </div>
          <span className={`font-extrabold text-[34px] leading-none tabular-nums ${draw ? 'text-muted' : 'text-ink-900'}`}>{rTop}–{rBottom}</span>
        </div>
      ) : (
        <div className="mt-2.5">
          <p className="flex items-center gap-2"><Faces people={people} ring="ring-[#F2EDE4]" />
            <span className="text-sm font-extrabold text-ink-900">{t('friends.list_rotating', { count: s.people || people.length })}</span></p>
          {s.my_rounds_played > 0 && (
            <p className="mt-1.5 text-sm text-ink-700">
              {t('friends.list_me_prefix')} <b className="text-ink-900">{t('friends.list_me_wins', { count: s.my_rounds_won || 0, total: s.my_rounds_played })}</b>
              {s.best_partner?.name ? ` · ${t('friends.list_best_partner', { name: String(s.best_partner.name).split(/\s+/)[0] })}` : ''}
            </p>
          )}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-[#DCD1BF] pt-2.5">
        <span className="text-xs text-[#6B5B45]">{foot || ''}</span>
        <Link to={`/jogos-privados/sessao/${s.match_id}?partilhar=1`} aria-label={t('friends.share_winners')}
          className="press relative flex h-11 w-11 items-center justify-center rounded-full bg-white text-ink-900">↗</Link>
      </div>
    </div>
  )
}

export default function FriendSessionCard({ s }) {
  if (s.live && !s.finished_at) return <LiveCard s={s} />
  if (!s.finished_at) return <ToCloseCard s={s} />
  return <HistoryCard s={s} />
}

/** «6 jogos · 4 vitórias · 7h30 de jogo» em outubro. Sem jogos no mês, nada. */
export function FriendsMonthLine({ sessions = [] }) {
  const { t, i18n } = useTranslation()
  const now = new Date()
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const month = sessions.filter((s) => s.finished_at && String(s.scheduled_date || '').startsWith(ym))
  if (!month.length) return null
  const wins = month.filter((s) => s.i_won).length
  const minutes = month.reduce((n, s) => n + (sessionDuration(s)?.minutes || 0), 0)
  const box = 'rounded-full bg-[#F2EDE4] px-3 py-1.5 text-sm text-ink-700'
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={box}><b className="text-ink-900">{month.length}</b> {t('friends.month_games', { count: month.length })}</span>
      <span className={box}><b className="text-ink-900">{wins}</b> {t('friends.month_wins', { count: wins })}</span>
      {minutes > 0 && <span className={box}><b className="text-ink-900">{durationText(t, minutes)}</b> {t('friends.month_played')}</span>}
      <span className="text-xs text-muted">{t('friends.month_in', { month: now.toLocaleDateString(i18n.language, { month: 'long' }) })}</span>
    </div>
  )
}

/** Sem jogos nenhuns: o EmptyState comum, que traz o Alino a pensar (Dev 1,
 *  regra do Francisco: «o Alino quando não temos nada para mostrar»). */
export function FriendsEmpty() {
  const { t } = useTranslation()
  return <EmptyState icon={Users} title={t('friends.list_empty_title')} subtitle={t('friends.list_empty_text')} />
}
