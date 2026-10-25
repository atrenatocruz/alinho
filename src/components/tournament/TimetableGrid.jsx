// A grelha do Horário, só de ver, para todos (UX, 22 out: design-handoff/
// 2026-10-22-torneio-referencia-racketsplayer, ecrã 1): o dia do clube por
// campo, uma linha por hora (um jogo = uma linha), a hora presa à esquerda.
// Com 2 campos cabe a 375; com mais, a grelha desliza por dentro (nunca a
// página). A tua dupla a verde-claro, a decorrer com contorno preto, por
// saber a tracejado; a linha vermelha «AGORA» no dia de hoje. Tocar abre o
// detalhe do jogo. Mover jogos continua a ser no Gerir (TournamentCalendarGrid).
import { useTranslation } from 'react-i18next'
import { isDone } from './treeLayout'

const COL_W = 150

function Team({ name, score, won }) {
  return (
    <span className="mt-0.5 flex items-baseline justify-between gap-1.5 whitespace-nowrap">
      <span className={`min-w-0 truncate ${won ? 'font-extrabold text-ink-900' : 'text-ink-900'}`}>{name}</span>
      {score != null && <span className={`shrink-0 tabular-nums ${won ? 'font-extrabold' : ''}`}>{score}</span>}
    </span>
  )
}

export default function TimetableGrid({ grid, entries, myIds = [], tone, code, phase, labelsOf, nowIndex = null, nowTime = '', onOpen }) {
  const { t } = useTranslation()
  const { courts, rows } = grid
  const wide = courts.length > 2
  // Cada campo tem pelo menos COL_W e cresce para a largura que houver: no
  // telemóvel a grelha desliza, no computador ocupa a largura toda (QA, 23 out).
  const cellW = { flex: '1 1 0', minWidth: 0 }
  const headW = wide ? { flex: `1 0 ${COL_W}px`, minWidth: 0 } : cellW
  const colW = wide ? { flex: `1 0 ${COL_W + 8}px`, minWidth: 0 } : cellW

  const cell = (m) => {
    if (!m) return <div className="m-1" style={cellW} />
    const done = isDone(m)
    const live = m.status === 'a_decorrer'
    const known = m.entry_a_id && m.entry_b_id
    const mine = myIds.includes(m.entry_a_id) || myIds.includes(m.entry_b_id)
    const scored = (done || live) && m.score_a != null && m.score_b != null
    const winner = done ? m.winner_entry_id : null
    const labels = labelsOf(m)
    const name = (id, side) => (id && entries[id]?.name) || labels[side] || t('tournament.draw.tbd')
    const look = mine ? 'bg-[#E9F7D2] shadow-[inset_0_0_0_1.5px_#65A30D]'
      : live ? 'bg-white shadow-[inset_0_0_0_1.5px_#040404]'
        : known ? 'bg-[#F4F5F1]'
          : 'bg-[repeating-linear-gradient(135deg,#F4F5F1_0_6px,#EFF0EB_6px_12px)] text-[#5B6068]'
    return (
      <button type="button" onClick={() => onOpen(m.id)} style={cellW}
        className={`relative m-1 min-w-0 rounded-[10px] px-[7px] py-1.5 text-left text-[11px] font-semibold leading-[1.25] ${look}`}>
        {live && (
          <span className="absolute right-1.5 top-[5px] rounded-[5px] bg-[#FEE2E2] px-1 font-mono text-[8.5px] font-bold uppercase text-[#DC2626]">
            {t('tournament.draw.live_upper')}
          </span>
        )}
        <span className={`flex min-w-0 items-center gap-1 font-display text-[9.5px] font-extrabold tracking-[.02em] text-ink-900`}>
          <span aria-hidden className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: tone(m.category_id) }} />
          {/* A decorrer, a etiqueta ocupa o lugar da fase (como no desenho). */}
          <span className="truncate">{code(m.category_id)}{!live && <span className="font-semibold text-[#5B6068]"> · {phase(m)}</span>}</span>
        </span>
        <Team name={name(m.entry_a_id, 'a')} score={scored ? m.score_a : null} won={!!winner && winner === m.entry_a_id} />
        <Team name={name(m.entry_b_id, 'b')} score={scored ? m.score_b : null} won={!!winner && winner === m.entry_b_id} />
      </button>
    )
  }

  // A linha «AGORA» tem a sua própria faixa entre duas horas, para a
  // etiqueta não tapar o jogo de baixo.
  const nowLine = (
    <div className="relative flex h-[18px] items-center" aria-label={t('tournament.schedule.now_aria', { time: nowTime })}>
      <div className="absolute inset-x-0 top-1/2 border-t-2 border-[#DC2626]" />
      <span className="sticky left-1 z-20 rounded-[5px] bg-[#DC2626] px-1.5 py-px font-mono text-[9px] font-bold uppercase text-white">
        {t('tournament.schedule.now')} · {nowTime}
      </span>
    </div>
  )

  return (
    <div className="overflow-hidden rounded-[14px] bg-white">
      <div className="overflow-x-auto overscroll-x-contain no-scrollbar">
        <div style={{ minWidth: wide ? 44 + courts.length * (COL_W + 8) : undefined }}>
          <div className="flex border-b border-[#ECEDE8]">
            <div className="sticky left-0 z-10 w-11 shrink-0 bg-white" />
            {courts.map((c) => (
              <div key={c} className="m-1 truncate py-1.5 text-center font-mono text-[10px] font-bold uppercase tracking-[.12em] text-[#5B6068]" style={headW}>{c}</div>
            ))}
          </div>
          {rows.map((r, i) => (
            <div key={r.at}>
              {i === nowIndex && nowLine}
              <div className="flex min-h-[64px] border-b border-[#F1F2EE] last:border-b-0">
                <div className="sticky left-0 z-10 w-11 shrink-0 bg-white pl-2 pt-[7px]">
                  <p className="font-mono text-[11px] font-semibold text-ink-900">{r.time}</p>
                  {Object.values(r.cells).some((m) => !isDone(m) && m.status !== 'a_decorrer') && <p className="mt-0.5 text-[9px] text-[#5B6068]">{t('tournament.sheet.planned')}</p>}
                </div>
                {courts.map((c) => <div key={c} className="flex" style={colW}>{cell(r.cells[c])}</div>)}
              </div>
            </div>
          ))}
          {nowIndex === rows.length && nowLine}
        </div>
      </div>
    </div>
  )
}
