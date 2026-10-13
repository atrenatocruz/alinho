// R2 (13 out): o placar escuro de um jogo a decorrer, na folha «A decorrer
// agora» (design-handoff/2026-10-13-redesign/R2-topo-da-home.md, ponto 4).
// Em cima, a faixa da cor do tipo com «● A DECORRER» e o nome; em baixo, em
// #0E1117, a ronda, as duas duplas do campo 1 com o resultado (a que vai à
// frente a lima), a barra das rondas, os outros campos em pastilhas e «Ver o
// mix ›» a lima. Sem os campos (courts_now, Dev 3), quem vai à frente.
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Avatar } from '../ui'
import { kindColorsOf } from '../agenda/HomeCard'
import { shortPersonName } from '../../lib/mixLogic'

const kindOf = (row) => (row.kind === 'friends' && row.org_kind && row.org_kind !== 'group' ? 'open' : row.kind)

function Team({ team, score, lead, hidden = false }) {
  const { t } = useTranslation()
  // Quem esconde os resultados vem sem nomes (Dev 3): «—», sem caras.
  // Nomes curtos, como no resto da app («Rita F.») — QA, 13 out.
  const names = hidden ? [t('homecard.live_hidden')] : (team || []).map((p) => shortPersonName(p.name)).filter(Boolean)
  return (
    <div className="mt-2.5 flex items-center gap-2.5">
      <span className="flex">
        {(team || []).slice(0, 2).map((p, i) => (
          <span key={i} className="-mr-2 rounded-full border-2 border-[#0E1117]">
            <Avatar name={p.name} url={p.avatar_url} size="w-[28px] h-[28px] text-[10px]" />
          </span>
        ))}
      </span>
      <b className={`ml-2 min-w-0 flex-1 truncate font-display text-[14.5px] font-bold leading-[1.2] ${lead === false ? 'text-[#7B8494]' : 'text-white'}`}>{names.join(' / ')}</b>
      <em className={`min-w-[40px] text-right font-display text-[30px] font-black not-italic leading-none tracking-[-.02em] tabular-nums ${lead ? 'text-lime-400' : lead === false ? 'text-[#7B8494]' : 'text-white'}`}>{score ?? '–'}</em>
    </div>
  )
}

/** As rondas: as jogadas a cinzento, a de agora a lima, as que faltam escuras. */
function Rounds({ now, total }) {
  if (!total) return null
  return (
    <div className="mt-3 flex gap-1" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={`h-1 flex-1 rounded-sm ${i + 1 < now ? 'bg-[#7B8494]' : i + 1 === now ? 'bg-lime-400' : 'bg-[#2A2F3A]'}`} />
      ))}
    </div>
  )
}

export default function LiveBoard({ row, card, onOpen }) {
  const { t } = useTranslation()
  const kind = kindOf(row)
  const isMix = row.kind === 'mix'
  const now = isMix ? Number(row.round_number) || 0 : Number(row.game_number) || 0
  const total = isMix ? Number(row.rounds_total) || 0 : Number(row.games_total) || 0
  const courts = Array.isArray(row.courts_now) ? [...row.courts_now].sort((a, b) => (a.court || 0) - (b.court || 0)) : []
  const first = courts[0] || null
  // Sem resultado ainda, nenhum vai à frente (os dois a branco).
  const aLeads = first && first.score_a != null && first.score_b != null
    ? (Number(first.score_a) === Number(first.score_b) ? null : Number(first.score_a) > Number(first.score_b)) : null
  return (
    <Link to={card.to} onClick={onOpen}
      className="press block overflow-hidden rounded-[20px] bg-[#0E1117] text-white shadow-[0_10px_24px_-14px_rgba(0,0,0,.45)]">
      <div className="flex items-center gap-2 px-3.5 py-2.5" style={{ background: kindColorsOf(kind).strong }}>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-black/30 px-[9px] py-1 font-mono text-[10.5px] font-extrabold uppercase leading-none tracking-[.1em]">
          <i className="h-[7px] w-[7px] rounded-full bg-[#FF4D4D] motion-safe:animate-pulse" /> {t('ui.status_live')}
        </span>
        <span className="min-w-0 truncate font-display text-[12.5px] font-bold leading-[1.2] opacity-95">
          {/* Nos amigos, «Entre amigos · <sítio>», como no protótipo (QA, 13 out). */}
          {[row.kind === 'friends' ? t('agenda.kind_friends') : card.title, row.org_name].filter(Boolean).join(' · ')}
        </span>
      </div>
      <div className="px-3.5 pb-3.5 pt-3">
        <div className="flex justify-between gap-2 font-mono text-[10.5px] font-medium uppercase leading-none tracking-[.1em] text-[#9AA3AF]">
          <span>{[first?.court && isMix ? t('homecard.live_court', { n: first.court }) : null, total ? t(isMix ? 'homecard.live_round' : 'homecard.live_game', { n: now, total }) : null].filter(Boolean).join(' · ')}</span>
        </div>
        {first ? (
          <>
            <Team team={first.a} score={first.score_a} lead={aLeads} hidden={first.a_hidden} />
            <Team team={first.b} score={first.score_b} lead={aLeads == null ? null : !aLeads} hidden={first.b_hidden} />
          </>
        ) : card.lead ? (
          <p className="mt-2.5 truncate font-display text-[14.5px] text-[#C9CED6]">
            {card.leadLabel} <b className="text-white">{card.lead}</b>
          </p>
        ) : null}
        <Rounds now={now} total={total} />
        {courts.length > 1 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {courts.slice(1).map((c) => (
              <span key={c.court} className="rounded-full bg-[#1C212B] px-2.5 py-1.5 font-display text-[12px] font-semibold leading-none text-[#C9CED6]">
                {t('homecard.live_court_pill', { n: c.court })} · <b className="text-white">{c.score_a ?? '–'}–{c.score_b ?? '–'}</b>
              </span>
            ))}
          </div>
        )}
        <span className="mt-3 block font-display text-[13px] font-extrabold leading-none text-lime-400">
          {t(isMix ? 'homecard.live_see_mix' : 'homecard.live_see_game')} ›
        </span>
      </div>
    </Link>
  )
}
