// A grelha do organizador (Trello #361 · print 10, 1.º telemóvel): as horas
// de um dia por campo, com todas as categorias ao mesmo tempo, cor por
// categoria, e os choques assinalados com a solução ao lado.
//
// É diferente do separador «Calendário» que o jogador vê (CalendarPanel,
// do Dev 3): esse é a lista dos jogos: este é o dia todo de uma vez, que é
// o que quem está a gerir precisa de ver no balcão.
//
// As contas dos choques são do Dev 3 (src/lib/tournamentSchedule.js) — aqui
// só se mostram.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, CalendarDays } from 'lucide-react'
import { listMatchesToScore, rescheduleMatch } from '../../lib/tournamentApi'
import { SCHEDULE_DEFAULTS, canPlace, findConflicts } from '../../lib/tournamentSchedule'
import { describeError, errorKind } from '../../lib/errors'
import { EmptyState } from '../ui'
import { MonoLabel } from './TournamentBits'

// Uma cor por categoria, pela ordem em que aparecem — as três do desenho,
// repetidas se houver mais categorias do que cores.
const CATEGORY_COLORS = [
  { bg: '#EDE9FE', text: '#4338A8' },
  { bg: '#FCE7F3', text: '#9D174D' },
  { bg: '#E0F2FE', text: '#075985' },
  { bg: '#DCFCE7', text: '#14532D' },
  { bg: '#FEF3C7', text: '#78350F' },
]

const pad = (n) => String(n).padStart(2, '0')
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
// O dia tem de sair da DATA, não das dez primeiras letras do texto: as
// horas vêm da base de dados com fuso (…T12:00:00+01:00, ou em UTC), e um
// jogo à meia-noite e meia caía no dia anterior se se cortasse o texto.
const dayOf = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default function TournamentCalendarGrid({ tournament, onBack }) {
  const { t, i18n } = useTranslation()
  const [matches, setMatches] = useState(null)
  const [day, setDay] = useState(null)
  const [categoryCode, setCategoryCode] = useState(null) // null = todas
  const [error, setError] = useState('')
  // Mover é em dois toques, não a arrastar: no telemóvel, de pé no clube e
  // com uma mão, arrastar um bloco de 130 px falha mais vezes do que
  // acerta. Toca-se no jogo, os lugares onde ele cabe acendem-se, toca-se
  // num deles.
  const [moving, setMoving] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    // p_date a null traz o torneio todo: a grelha muda de dia sem voltar à
    // base de dados, que num wi-fi de clube se nota.
    listMatchesToScore(tournament.id, null)
      .then((rows) => setMatches(rows.filter((m) => m.scheduled_at)))
      .catch((err) => {
        if (errorKind(err) !== 'not_ready') console.error('Error loading matches:', err)
        setError(describeError(t, err))
        setMatches([])
      })
  }, [tournament.id, t])

  useEffect(() => { load() }, [load])

  const days = useMemo(
    () => [...new Set((matches || []).map((m) => dayOf(m.scheduled_at)))].sort(),
    [matches],
  )
  const currentDay = day && days.includes(day) ? day : days[0]

  const codes = useMemo(
    () => [...new Set((matches || []).map((m) => m.category_code).filter(Boolean))],
    [matches],
  )
  const colorOf = (code) => CATEGORY_COLORS[Math.max(0, codes.indexOf(code)) % CATEGORY_COLORS.length]

  const duration = Number(tournament?.rules?.duration_max) || SCHEDULE_DEFAULTS.durationMaxMin

  // Os jogos do dia escolhido, já com início e fim — é esta forma que as
  // contas do Dev 3 esperam.
  const ofDay = useMemo(() => (matches || [])
    .filter((m) => dayOf(m.scheduled_at) === currentDay)
    .map((m) => ({
      ...m,
      id: m.match_id,
      court: m.court || '—',
      startsAt: new Date(m.scheduled_at),
      endsAt: new Date(new Date(m.scheduled_at).getTime() + duration * 60000),
      players: [...(m.team_a?.players || []), ...(m.team_b?.players || [])].filter(Boolean),
    })), [matches, currentDay, duration])

  const conflicts = useMemo(
    () => findConflicts(ofDay, { durationMaxMin: duration, maxConsecutive: Number(tournament?.rules?.max_consecutive) || SCHEDULE_DEFAULTS.maxConsecutive }),
    [ofDay, duration, tournament],
  )
  const inTrouble = useMemo(() => new Set(conflicts.flatMap((c) => c.matches || [])), [conflicts])

  const courts = useMemo(
    () => [...new Set(ofDay.map((m) => m.court))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [ofDay],
  )
  // Uma linha por hora de início usada nesse dia: a grelha acompanha o que
  // está marcado, em vez de inventar horas vazias do princípio ao fim.
  const hours = useMemo(
    () => [...new Set(ofDay.map((m) => hhmm(m.startsAt)))].sort(),
    [ofDay],
  )

  // O desenho não assinala só o problema: diz o que fazer («Passar o MX4
  // para as 13:00»). A sugestão é o primeiro lugar livre do dia onde o jogo
  // caberia sem partir nenhuma regra — quem decide é o admin. Quem responde
  // "cabe ou não cabe" é o canPlace do Dev 3; aqui só se procura.
  const suggestionFor = useCallback((conflict) => {
    const ids = conflict.matches || []
    const last = ofDay.filter((m) => ids.includes(m.id)).sort((a, b) => a.startsAt - b.startsAt).pop()
    if (!last) return null
    for (const hour of hours) {
      const [h, min] = hour.split(':').map(Number)
      const startsAt = new Date(last.startsAt)
      startsAt.setHours(h, min, 0, 0)
      if (startsAt.getTime() === last.startsAt.getTime()) continue
      for (const court of courts) {
        const moved = { ...last, court, startsAt, endsAt: new Date(startsAt.getTime() + duration * 60000) }
        if (canPlace(moved, ofDay.filter((m) => m.id !== last.id), { durationMaxMin: duration })) {
          return { match: last, hour, court }
        }
      }
    }
    return null
  }, [ofDay, hours, courts, duration])

  // Os lugares livres onde o jogo escolhido cabe sem partir nenhuma regra.
  // Quem responde é o canPlace do Dev 3.
  const landingSpots = useMemo(() => {
    if (!moving) return new Set()
    const rest = ofDay.filter((m) => m.id !== moving.id)
    const ok = new Set()
    for (const hour of hours) {
      const [h, mi] = hour.split(':').map(Number)
      const startsAt = new Date(moving.startsAt)
      startsAt.setHours(h, mi, 0, 0)
      for (const court of courts) {
        if (rest.some((m) => m.court === court && hhmm(m.startsAt) === hour)) continue
        const moved = { ...moving, court, startsAt, endsAt: new Date(startsAt.getTime() + duration * 60000) }
        if (canPlace(moved, rest, { durationMaxMin: duration })) ok.add(`${hour}|${court}`)
      }
    }
    return ok
  }, [moving, ofDay, hours, courts, duration])

  // Serve os dois caminhos: escolher o jogo e tocar num lugar livre, ou
  // aceitar a sugestão do aviso de choque, que já traz jogo, hora e campo.
  const moveTo = async (match, hour, court) => {
    const [h, mi] = hour.split(':').map(Number)
    const startsAt = new Date(match.startsAt)
    startsAt.setHours(h, mi, 0, 0)
    setBusy(true)
    setError('')
    try {
      await rescheduleMatch(match.id, { scheduled_at: startsAt.toISOString(), court })
      setMoving(null)
      load()
    } catch (err) {
      setError(describeError(t, err, 'tournament.grid.move_error'))
    } finally {
      setBusy(false)
    }
  }

  const shown = categoryCode ? ofDay.filter((m) => m.category_code === categoryCode) : ofDay
  const at = (hour, court) => shown.find((m) => hhmm(m.startsAt) === hour && m.court === court)

  const dayLabel = (iso) => {
    const d = new Date(`${iso}T12:00`)
    const part = (opt) => d.toLocaleDateString(i18n.language, opt).replace('.', '')
    const weekday = part({ weekday: 'short' })
    return `${weekday.charAt(0).toUpperCase() + weekday.slice(1)} ${d.getDate()} ${part({ month: 'short' })}`
  }

  const back = (
    <button type="button" onClick={onBack} className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-extrabold text-ink-700 hover:underline">
      <ArrowLeft size={16} /> {t('common.back')}
    </button>
  )

  if (matches === null) {
    return <div className="flex justify-center py-10"><div className="h-8 w-8 animate-spin rounded-full border-[3px] border-ink-50 border-t-ink-700" /></div>
  }

  return (
    <div>
      {back}
      <h2 className="mt-3 font-display text-lg font-extrabold text-ink-900">
        {currentDay ? t('tournament.grid.title', { day: dayLabel(currentDay) }) : t('tournament.grid.title_empty')}
      </h2>
      {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}

      {ofDay.length === 0 ? (
        <div className="mt-3">
          <EmptyState icon={CalendarDays} title={t('tournament.grid.empty_title')} subtitle={t('tournament.grid.empty_subtitle')} />
        </div>
      ) : (
        <>
          {days.length > 1 && (
            <div className="-mx-1 mt-2 flex gap-1.5 overflow-x-auto no-scrollbar px-1">
              {days.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDay(d)}
                  className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-bold ${d === currentDay ? 'bg-ink-900 text-white' : 'bg-ink-50 text-ink-700'}`}
                >
                  {dayLabel(d)}
                </button>
              ))}
            </div>
          )}

          <div className="-mx-1 mt-2 flex gap-1.5 overflow-x-auto no-scrollbar px-1">
            <button
              type="button"
              onClick={() => setCategoryCode(null)}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] ${categoryCode === null ? 'bg-ink-900 font-bold text-white' : 'border border-line text-ink-700'}`}
            >
              {t('tournament.grid.all_categories')}
            </button>
            {codes.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setCategoryCode(code === categoryCode ? null : code)}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-semibold ${code === categoryCode ? 'bg-ink-900 text-white' : 'border border-line'}`}
                style={code === categoryCode ? undefined : { color: colorOf(code).text }}
              >
                {code}
              </button>
            ))}
          </div>

          {moving && (
            <div className="mt-2 flex items-center justify-between gap-2 rounded-ctrl border border-ink-900 bg-ink-50 px-3 py-2 text-[11.5px]">
              <span className="min-w-0">
                {landingSpots.size > 0
                  ? t('tournament.grid.moving', { match: [moving.category_code, moving.group_label || moving.round_label].filter(Boolean).join(' ') })
                  : t('tournament.grid.moving_nowhere', { match: [moving.category_code, moving.group_label || moving.round_label].filter(Boolean).join(' ') })}
              </span>
              <button type="button" onClick={() => setMoving(null)} className="shrink-0 font-semibold text-ink-700 underline">
                {t('tournament.create.cancel')}
              </button>
            </div>
          )}

          {/* A grelha desliza para o lado: com quatro campos não cabem todos
              a 390 px, e encolher até não se ler é pior. A coluna das horas
              fica fixa, para não se perder a referência. */}
          <div className="-mx-1 mt-3 overflow-x-auto px-1">
            <div className="min-w-max">
              <div className="flex gap-1">
                <div className="sticky left-0 z-10 w-[42px] shrink-0 bg-canvas" />
                {courts.map((court) => (
                  <div key={court} className="w-[132px] shrink-0 pb-1 text-center font-mono text-[9.5px] font-bold uppercase tracking-[0.05em] text-ink-500">
                    {court}
                  </div>
                ))}
              </div>
              {hours.map((hour) => (
                <div key={hour} className="flex items-stretch gap-1 pb-1">
                  <div className="sticky left-0 z-10 flex w-[42px] shrink-0 items-start bg-canvas pt-1 font-mono text-[9.5px] text-ink-500">
                    {hour}
                  </div>
                  {courts.map((court) => {
                    const m = at(hour, court)
                    if (!m) {
                      const free = landingSpots.has(`${hour}|${court}`)
                      return free ? (
                        <button
                          key={court}
                          type="button"
                          disabled={busy}
                          onClick={() => moveTo(moving, hour, court)}
                          className="w-[132px] shrink-0 rounded-lg border-2 border-dashed border-ok bg-[#F0FDF4] text-[9.5px] font-semibold text-ok"
                        >
                          {t('tournament.grid.drop_here')}
                        </button>
                      ) : <div key={court} className="w-[132px] shrink-0" />
                    }
                    const color = colorOf(m.category_code)
                    const bad = inTrouble.has(m.match_id)
                    const chosen = moving?.id === m.id
                    return (
                      <button
                        key={court}
                        type="button"
                        onClick={() => setMoving(chosen ? null : m)}
                        aria-pressed={chosen}
                        className={`w-[132px] shrink-0 rounded-lg px-1.5 py-1 text-left text-[9.5px] leading-[1.3] ${
                          chosen ? 'outline outline-2 -outline-offset-2 outline-ink-900'
                            : bad ? 'outline outline-2 -outline-offset-2 outline-[#B42318]' : ''
                        } ${moving && !chosen ? 'opacity-45' : ''}`}
                        style={{ background: color.bg, color: color.text }}
                      >
                        <b className="block font-semibold">
                          {m.category_code}{m.group_label || m.round_label ? ` · ${m.group_label || m.round_label}` : ''}
                        </b>
                        <span className="block truncate">{m.team_a?.name}</span>
                        <span className="block truncate">{m.team_b?.name}</span>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>

          {conflicts.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {conflicts.map((c, i) => {
                const fix = suggestionFor(c)
                return (
                  <div key={i} className="rounded-ctrl border border-[#F4B4B4] bg-[#FEF0F0] p-2.5 text-[11.5px] text-ink-900">
                    {c.kind === 'jogos_seguidos' && t('tournament.grid.conflict_run', { player: c.player, count: c.count })}
                    {c.kind === 'dois_jogos_a_mesma_hora' && t('tournament.grid.conflict_same_time', { players: (c.players || []).join(', ') })}
                    {c.kind === 'campo_ocupado' && t('tournament.grid.conflict_court', { court: c.court })}
                    {fix && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => moveTo(fix.match, fix.hour, fix.court)}
                        className="mt-1 block text-left text-ink-900 underline"
                      >
                        {t('tournament.grid.conflict_fix', {
                          match: [fix.match.category_code, fix.match.group_label || fix.match.round_label].filter(Boolean).join(' '),
                          hour: fix.hour,
                          court: fix.court,
                        })}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <MonoLabel className="mt-4">{t('tournament.grid.legend')}</MonoLabel>
          <p className="mt-1 text-[11.5px] text-ink-500">{t('tournament.grid.move_later')}</p>
        </>
      )}
    </div>
  )
}
