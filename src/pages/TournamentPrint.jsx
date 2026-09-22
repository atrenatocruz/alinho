// Imprimir grupos, quadro e horário (Trello #364, «Torneio 4/6»).
//
// ISTO É O PLANO B DO DIA. Se a app falhar a meio do torneio — wi-fi do
// clube em baixo, telemóvel sem bateria, o que for —, é esta folha que
// deixa o torneio acabar na mesma. Por isso:
//
// • uma folha com TUDO (grupos, quadro e a grelha de horas), e não três
//   botões em sítios diferentes: no dia, com pressa, ninguém procura;
// • ESPAÇO PARA ESCREVER À MÃO em cada jogo e em cada linha da
//   classificação — em papel o resultado escreve-se, não se lê;
// • preto no branco, sem cores de fundo nem sombras, que numa impressora
//   de clube saem cinzentas e comem tinta;
// • uma categoria por folha, para se poderem espalhar pelas mesas.
//
// Abre sem conta: quem está ao balcão pode não ter sessão iniciada.
import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getTournamentPage } from '../lib/tournamentApi'
import { getCategoryBoard, bracketRounds, byDayAndTime } from '../lib/tournamentDraw'

const ROUND_PT = { R32: '16 avos', R16: 'Oitavos', QF: 'Quartos', SF: 'Meias-finais', F: 'Final', '3P': '3.º e 4.º' }

const hhmm = (iso) => (iso ? new Date(iso).toTimeString().slice(0, 5) : '')

const dayLabel = (date, locale) => {
  const d = new Date(`${date}T12:00:00`)
  const weekday = d.toLocaleDateString(locale, { weekday: 'long' }).replace('.', '')
  const short = d.toLocaleDateString(locale, { day: 'numeric', month: 'long' })
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${short}`
}

/** Linha para escrever o resultado à mão. */
const Blank = ({ w = 44 }) => (
  <span className="inline-block border-b border-black align-bottom" style={{ width: w, height: 14 }} />
)

/* ── Grupos: os jogos para escrever, e a tabela para somar ───────────── */
function GroupSheet({ group, matches, entries }) {
  const mine = matches.filter((m) => m.stage === 'grupo' && m.group_id === group.id)
  const nameOf = (id) => entries[id]?.name || '—'

  return (
    <section className="mb-4 break-inside-avoid">
      <h3 className="mb-1 text-[13px] font-bold">{group.name}</h3>

      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr>
            <th className="w-8 border border-black px-1 py-0.5 text-left font-semibold">#</th>
            <th className="border border-black px-1 py-0.5 text-left font-semibold">Dupla</th>
            <th className="w-10 border border-black px-1 py-0.5 text-center font-semibold">J</th>
            <th className="w-10 border border-black px-1 py-0.5 text-center font-semibold">V</th>
            <th className="w-14 border border-black px-1 py-0.5 text-center font-semibold">Jogos</th>
            <th className="w-12 border border-black px-1 py-0.5 text-center font-semibold">Dif</th>
          </tr>
        </thead>
        <tbody>
          {group.teams.map((id, i) => (
            <tr key={id}>
              <td className="border border-black px-1 py-1 text-center">{i + 1}</td>
              <td className="border border-black px-1 py-1">{nameOf(id)}</td>
              <td className="border border-black" />
              <td className="border border-black" />
              <td className="border border-black" />
              <td className="border border-black" />
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="mt-1.5 text-[11px] leading-5">
        {mine.map((m) => (
          <li key={m.id} className="flex items-baseline gap-1.5">
            <span className="w-10 shrink-0 font-mono text-[10px]">
              {m.scheduled_at ? hhmm(m.scheduled_at) : '__:__'}
            </span>
            <span className="w-16 shrink-0 font-mono text-[10px]">{m.court_name || '_______'}</span>
            <span className="flex-1">{nameOf(m.entry_a_id)} × {nameOf(m.entry_b_id)}</span>
            <span className="shrink-0"><Blank w={26} /> – <Blank w={26} /></span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ── Quadro: os lugares e os caminhos, com espaço para escrever ─────── */
function BracketSheet({ matches, entries, title }) {
  const rounds = bracketRounds(matches, 'principal')
  const secondary = bracketRounds(matches, 'secundario')
  if (!rounds.length && !secondary.length) return null

  const side = (m, which) => {
    const id = which === 'a' ? m.entry_a_id : m.entry_b_id
    const source = which === 'a' ? m.source_a : m.source_b
    return entries[id]?.name || source || '—'
  }

  const Bracket = ({ list, label }) => (
    <section className="mb-4 break-inside-avoid">
      <h3 className="mb-1 text-[13px] font-bold">{label}</h3>
      <div className="flex flex-wrap gap-3">
        {list.map(({ round, matches: ms }) => (
          <div key={round} className="min-w-[180px] flex-1">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wide">{ROUND_PT[round] || round}</p>
            {ms.map((m) => (
              <div key={m.id} className="mb-1.5 border border-black p-1 text-[11px]">
                <p className="flex items-baseline justify-between gap-1">
                  <span className="truncate">{side(m, 'a')}</span><Blank w={22} />
                </p>
                <p className="mt-0.5 flex items-baseline justify-between gap-1 border-t border-dotted border-black pt-0.5">
                  <span className="truncate">{side(m, 'b')}</span><Blank w={22} />
                </p>
                <p className="mt-0.5 font-mono text-[9px]">
                  {m.scheduled_at ? hhmm(m.scheduled_at) : '__:__'} · {m.court_name || '_______'}
                </p>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  )

  return (
    <>
      {rounds.length ? <Bracket list={rounds} label={title} /> : null}
      {secondary.length ? <Bracket list={secondary} label="Quadro secundário" /> : null}
    </>
  )
}

/* ── A grelha do dia: horas × campos, todas as categorias ───────────── */
function DayGrid({ day, matches, entries, locale }) {
  const courts = [...new Set(matches.map((m) => m.court_name).filter(Boolean))].sort()
  if (!courts.length) return null
  const times = day.slots.map((s) => s.time)
  const at = (time, court) =>
    day.slots.find((s) => s.time === time)?.matches.find((m) => m.court_name === court)
  const nameOf = (id) => entries[id]?.name || null

  return (
    <section className="mb-4 break-inside-avoid">
      <h3 className="mb-1 text-[13px] font-bold">{dayLabel(day.date, locale)}</h3>
      <table className="w-full border-collapse text-[10px]">
        <thead>
          <tr>
            <th className="w-12 border border-black px-1 py-0.5">Hora</th>
            {courts.map((c) => (
              <th key={c} className="border border-black px-1 py-0.5 text-left">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {times.map((time) => (
            <tr key={time}>
              <td className="border border-black px-1 py-1 text-center font-mono font-bold">{time}</td>
              {courts.map((c) => {
                const m = at(time, c)
                return (
                  <td key={c} className="border border-black px-1 py-1 align-top">
                    {m ? (
                      <>
                        <span className="block font-bold">
                          {m.category_code || ''}{m.group_label ? ` · ${m.group_label}` : ''}
                          {m.round ? ` · ${ROUND_PT[m.round] || m.round}` : ''}
                        </span>
                        <span className="block">
                          {nameOf(m.entry_a_id) || m.source_a || '—'}
                        </span>
                        <span className="block">
                          {nameOf(m.entry_b_id) || m.source_b || '—'}
                        </span>
                        <span className="mt-0.5 block"><Blank w={20} /> – <Blank w={20} /></span>
                      </>
                    ) : null}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

export default function TournamentPrint() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const { i18n } = useTranslation()
  const only = params.get('categoria')

  const [page, setPage] = useState(null)
  const [boards, setBoards] = useState({})
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    getTournamentPage(id)
      .then(async (data) => {
        if (!data || cancelled) { if (!cancelled) setError('nao_encontrado'); return }
        setPage(data)
        const cats = (data.categories || []).filter((c) => !only || c.id === only)
        const loaded = {}
        for (const c of cats) {
          // Uma de cada vez, de propósito: a folha do dia do torneio é
          // impressa uma vez, e assim não se atira com dez pedidos ao
          // mesmo tempo ao wi-fi do clube.
          loaded[c.id] = await getCategoryBoard(c.id)
        }
        if (!cancelled) setBoards(loaded)
      })
      .catch(() => { if (!cancelled) setError('erro') })
    return () => { cancelled = true }
  }, [id, only])

  if (error) {
    return <p className="p-6 text-center text-sm">Não foi possível abrir este torneio.</p>
  }
  if (!page) {
    return <p className="p-6 text-center text-sm">A preparar a folha…</p>
  }

  const t = page.tournament
  const cats = (page.categories || []).filter((c) => !only || c.id === only)

  // Todos os jogos de todas as categorias mostradas, para a grelha do dia.
  const allMatches = cats.flatMap((c) => (boards[c.id]?.matches || []).map((m) => ({
    ...m,
    category_code: c.code,
    group_label: (boards[c.id]?.groups || []).find((g) => g.id === m.group_id)?.name || null,
  })))
  const allEntries = Object.assign({}, ...cats.map((c) => boards[c.id]?.entries || {}))
  const days = byDayAndTime(allMatches)

  return (
    <div className="mx-auto max-w-[880px] bg-white p-6 text-black print:max-w-none print:p-0">
      <style>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          body { background: #fff; }
          .nao-imprimir { display: none !important; }
          .folha-nova { break-before: page; }
          /* A barra de navegacao da app nao vai para o papel, e a folha
             deixa de estar presa a altura do ecra — senao imprimia-se uma
             pagina so, cortada. */
          nav { display: none !important; }
          .h-screen { height: auto !important; }
          .overflow-hidden, .overflow-y-auto { overflow: visible !important; }
        }
      `}</style>

      <div className="nao-imprimir mb-4 flex items-center justify-between gap-3 border-b border-black pb-3">
        <p className="text-[12px]">
          Folha para imprimir — plano B do dia. Confere antes de imprimir e usa o Ctrl+P (ou Cmd+P).
        </p>
        <button
          type="button"
          onClick={() => window.print()}
          className="shrink-0 rounded border border-black px-3 py-1.5 text-[12px] font-bold"
        >
          Imprimir
        </button>
      </div>

      <header className="mb-4">
        <h1 className="text-[18px] font-extrabold">{t.name}</h1>
        <p className="text-[11px]">
          {[t.club_name, t.location].filter(Boolean).join(' · ')}
          {t.starts_on ? ` · ${t.starts_on}${t.ends_on && t.ends_on !== t.starts_on ? ` a ${t.ends_on}` : ''}` : ''}
        </p>
        <p className="mt-0.5 text-[10px]">
          Impresso a {new Date().toLocaleString(i18n.language)}. As horas são previstas.
        </p>
      </header>

      {days.map((day) => (
        <DayGrid key={day.date} day={day} matches={allMatches} entries={allEntries} locale={i18n.language} />
      ))}

      {cats.map((c, i) => {
        const board = boards[c.id]
        return (
          <div key={c.id} className={i > 0 ? 'folha-nova' : ''}>
            <h2 className="mb-2 mt-4 border-b border-black pb-1 text-[15px] font-extrabold">
              {c.code} · {c.name}
            </h2>
            {!board ? (
              <p className="text-[11px]">A preparar…</p>
            ) : !board.groups.length && !board.matches.length ? (
              <p className="text-[11px]">Ainda não foi sorteada.</p>
            ) : (
              <>
                {board.groups.map((g) => (
                  <GroupSheet key={g.id} group={g} matches={board.matches} entries={board.entries} />
                ))}
                <BracketSheet matches={board.matches} entries={board.entries} title="Quadro" />
              </>
            )}
          </div>
        )
      })}

      <footer className="mt-6 border-t border-black pt-2 text-[10px]">
        Se a app falhar: escreve os resultados aqui e passa-os para a app quando voltar.
        A correção de resultados existe e fica registada.
      </footer>
    </div>
  )
}
