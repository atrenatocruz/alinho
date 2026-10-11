// Ecrã do marcador (Trello #365, «Torneio 5/6»). Desde 11 out (design-handoff/
// 2026-10-11-torneio-marcar-nao-desaparece, «Muito melhor»): «Por marcar» e
// «Já marcados» num separador; todos os jogos do dia são o mesmo cartão
// (ScoreCard), por hora; o que se guarda fica no sítio, a verde, até se mudar
// de separador, de dia ou de página. Guardar o resultado atualiza o quadro,
// as classificações e as horas seguintes — isso é do servidor.
//
// É usado de pé, no clube, com uma mão: os números são grandes, os botões
// são três, e não há menus escondidos.
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BackBar } from '../components/ui'
import { sourceText } from '../components/tournament/sourceText'
import { ArrowLeft, Trophy } from 'lucide-react'
import { useGoBack } from '../lib/useGoBack'
import { getTournamentPage, getTournamentForEdit, listMatchesToScore, markWalkover, saveMatchResult, undoWalkover, resolveMatchCorrection } from '../lib/tournamentApi'
import { saveMatchSchedule } from '../lib/tournamentDraw'
import { describeError, errorKind } from '../lib/errors'
import { dayKeyInTz, msUntilNextDay, hhmmInTz } from '../lib/tournamentDay'
import { unscheduledMatches, proposeSchedule } from '../lib/scorePage'
import { useAuth } from '../contexts/AuthContext'
import { Chips, ConfirmSheet, EmptyState, NeedsYou, Tabs } from '../components/ui'
import { Sheet } from '../components/agenda/AgendaControls'
import { FieldLabel, MonoLabel } from '../components/tournament/TournamentBits'
import { proSetTieBreakTarget } from '../components/tournament/tieBreak'
import ScoreCard, { FINISHED } from '../components/tournament/ScoreCard'
import { StickyTabs } from '../components/tournament/StickyBar'

// Hora de Portugal, nunca cortada do texto da base de dados (vinha em UTC:
// 17:00 onde o resto da app dizia 18:00 — Trello #487).
const hhmm = (iso) => hhmmInTz(iso)

// Botões para usar com o dedo, de pé, à beira do campo: os da app — 48 px,
// rounded-ctrl, extrabold (revisão da designer de 26 set, «parece outra app»).
const BTN = 'inline-flex min-h-[48px] items-center justify-center gap-2 rounded-ctrl px-5 text-base font-extrabold transition-all duration-fast active:scale-[0.98] disabled:opacity-40'
const GHOST = 'bg-surface text-ink-900 border border-line hover:bg-ink-50'
// Numa lista, a ação que se repete em cada cartão é preta — a lima fica
// para o estado vivo (designer, 26 set: um lima por ecrã).
const DARK = 'bg-ink-900 text-white hover:bg-ink-700'

/** A folha que pergunta quem faltou (ou desistiu) e, na falta, se foi
 *  justificada. A sem justificação fica no histórico do jogador, visível
 *  só aos admins (SPEC §7). */
function WalkoverSheet({ match, kind: askedKind = null, onClose, onConfirm, error, t }) {
  // «Falta ou desistência» é um botão só (11 out): a folha pergunta qual.
  const [kind, setKind] = useState(askedKind)
  const [loser, setLoser] = useState(null)
  const [justified, setJustified] = useState(null)
  // Desistir é perder o jogo inteiro: o resultado até ali não conta
  // (Francisco, 23 set — Trello #458). Já não se pergunta «como estava?».
  const ready = loser && (kind === 'desistencia' || justified !== null)

  // A folha da app (Sheet), como as outras — e já vai para o body, o que
  // resolvia o `fixed` preso à página (#458).
  return (
    <Sheet title={t('tournament.score.walkover_or_retirement')} onClose={onClose}>
      <FieldLabel>{t('tournament.score.which_kind')}</FieldLabel>
      <Chips label={t('tournament.score.which_kind')} value={kind} onChange={(k) => { setKind(k); setJustified(null) }}
        options={[{ value: 'falta', label: t('tournament.score.walkover') }, { value: 'desistencia', label: t('tournament.score.retirement') }]} />
      {kind && <>
      <FieldLabel className="mt-4">{t(`tournament.score.${kind}_who`)}</FieldLabel>
      <Chips label={t(`tournament.score.${kind}_who`)} value={loser} onChange={setLoser}
        options={[{ value: 'a', label: match.team_a?.name }, { value: 'b', label: match.team_b?.name }]} />

      {kind === 'falta' && (
        <>
          <FieldLabel className="mt-4">{t('tournament.score.justified_label')}</FieldLabel>
          <Chips label={t('tournament.score.justified_label')} value={justified} onChange={setJustified}
            options={[{ value: true, label: t('tournament.score.justified') }, { value: false, label: t('tournament.score.unjustified') }]} />
          {justified === false && <p className="mt-2 text-xs text-ink-500">{t('tournament.score.unjustified_hint')}</p>}
        </>
      )}

      {/* O que isto faz: explicação, não um aviso — texto normal (designer). */}
      <p className="mt-4 text-sm text-ink-500">{t(`tournament.score.${kind}_effect`)}</p>
      </>}

      {error && <p role="alert" className="mt-3 rounded-ctrl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm font-bold text-danger">{error}</p>}

      {/* Quem marca é quem organiza: preto, não lima; cinzento até estar tudo
          escolhido. «Cancelar» em contorno por baixo (UX, 11 out). */}
      <button type="button" disabled={!ready} onClick={() => onConfirm(kind, loser, justified)}
        className={`${BTN} mt-4 w-full disabled:opacity-100 ${ready ? DARK : 'bg-line text-ink-500'}`}>
        {kind ? t(`tournament.score.${kind}_confirm`) : t('tournament.score.walkover_or_retirement')}
      </button>
      <button type="button" onClick={onClose} className={`${BTN} mt-2 w-full border border-line bg-white text-ink-900`}>
        {t('tournament.create.cancel')}
      </button>
    </Sheet>
  )
}

export default function TournamentScorePage() {
  const { t, i18n } = useTranslation()
  const { id } = useParams()
  const navigate = useNavigate()
  const goBack = useGoBack('/')
  const { memberships } = useAuth()
  const [tournament, setTournament] = useState(null)
  // Todos os jogos do torneio, de uma vez: o dia escolhe-se aqui em baixo.
  // Assim trocar de dia é instantâneo, e vêem-se também os jogos que o
  // sorteio deixou sem hora (esses não pertencem a dia nenhum).
  const [allMatches, setAllMatches] = useState(null)
  const [pageDays, setPageDays] = useState([])
  const [proposal, setProposal] = useState(null) // { slots, preview, left, noCourts }
  const [sheet, setSheet] = useState(null) // { match, kind }
  const [undoing, setUndoing] = useState(null) // o jogo cuja falta se desfaz (#491)
  const [accepting, setAccepting] = useState(null) // o pedido de correção a aceitar (#485)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // «Por marcar» / «Já marcados» (11 out). O que se guarda em «Por marcar»
  // fica lá, a verde, até se mudar de separador, de dia ou de página.
  const [view, setView] = useState('todo')
  const [justSaved, setJustSaved] = useState(() => new Set())
  const [toast, setToast] = useState('')
  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => setToast(''), 3000)
    return () => clearTimeout(timer)
  }, [toast])
  // O jogo onde o erro aconteceu — é aí que ele aparece.
  const [errorFor, setErrorFor] = useState(null)

  // Dia em hora de Portugal, que é como o servidor conta o dia de um jogo
  // (`scheduled_at AT TIME ZONE 'Europe/Lisbon'`), e escolhido entre os dias
  // do torneio — para ensaiar antes e para corrigir o resultado de ontem
  // (Trello #460). Não se usa a hora do aparelho: quem marca pode tê-lo
  // noutro fuso, ou mal acertado, e via o dia trocado sem perceber porquê.
  const [today, setToday] = useState(() => dayKeyInTz())
  const [day, setDay] = useState(today)
  const [days, setDays] = useState([])

  // E o dia vira sozinho à meia-noite: num torneio atrasado é a hora a que
  // ainda se está a marcar, com o ecrã aberto desde a tarde.
  useEffect(() => {
    const timer = setTimeout(() => setToday(dayKeyInTz()), msUntilNextDay())
    return () => clearTimeout(timer)
  }, [today])

  // O endereço traz o nome curto do torneio (/torneio/smash-cup/marcar), e a
  // lista dos jogos quer o código dele: mandar o nome dava erro 22P02 e a
  // página dizia «Nada para marcar hoje» (Trello #487). O código vem da
  // página do torneio, que aceita os dois.
  const tourId = tournament?.id || null

  const load = useCallback(() => {
    if (!tourId) return
    listMatchesToScore(tourId, null)
      .then((rows) => setAllMatches(rows || []))
      .catch((err) => {
        if (errorKind(err) !== 'not_ready') console.error('Error loading matches:', err)
        setAllMatches([])
      })
  }, [tourId])

  useEffect(() => {
    getTournamentPage(id)
      .then((res) => {
        setTournament(res?.tournament || null)
        if (!res?.tournament) setAllMatches([])
        setPageDays(res?.days || [])
        const list = (res?.days || []).map((d) => d.date).filter(Boolean)
        setDays(list)
        // Hoje não é dia de torneio? Abre no primeiro dia, em vez de vazio.
        // À meia-noite isto volta a correr, mas de propósito NÃO muda o dia
        // que está aberto: quem passa da meia-noite a marcar está a acabar
        // os jogos de ontem, e o ecrã não lhe deve fugir debaixo dos dedos.
        // Muda só a marca do «hoje», que passa para o dia seguinte.
        if (list.length && !list.includes(today)) setDay(list[0])
      })
      .catch(() => { setTournament(null); setAllMatches([]) })
  }, [id, today])

  useEffect(() => { load() }, [load])
  const [searchParams] = useSearchParams()
  const wanted = searchParams.get('jogo')
  useEffect(() => {
    const m = wanted && (allMatches || []).find((x) => String(x.match_id) === wanted)
    if (!m) return undefined
    if (m.scheduled_at) setDay(dayKeyInTz(new Date(m.scheduled_at)))
    setView(FINISHED.includes(m.status) ? 'done' : 'todo')
    const timer = setTimeout(() => document.getElementById(`jogo-${m.match_id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 200)
    return () => clearTimeout(timer)
  }, [wanted, allMatches])

  const scoring = tournament?.rules?.scoring || 'pro_set_9'
  const tieTarget = proSetTieBreakTarget(tournament?.rules)
  const isAdmin = !!tournament && (memberships || [])
    .some((m) => m.organization_id === tournament.organization_id && m.is_admin)

  // As horas: o sorteio cria os jogos sem hora, e sem hora não aparecem em
  // dia nenhum. Quem organiza propõe-nas aqui — com o cálculo do horário do
  // torneio — vê a proposta, e grava. Afinar um jogo a seguir é na grelha.
  const propose = async () => {
    setBusy(true)
    setError(''); setErrorFor(null)
    try {
      const edit = await getTournamentForEdit(tourId)
      setProposal(proposeSchedule({
        matches: unscheduledMatches(allMatches || []),
        days: pageDays,
        courts: edit?.courts || [],
        durationMaxMin: Number(tournament?.rules?.duration_max) || undefined,
        // O dia e a hora de início de cada categoria (#502, Dev 3): a
        // proposta não põe uma categoria fora do dia dela.
        categories: edit?.categories || [],
        today,
      }))
    } catch (err) {
      setError(describeError(t, err))
    } finally {
      setBusy(false)
    }
  }

  const saveSchedule = async () => {
    setBusy(true)
    setError(''); setErrorFor(null)
    try {
      // O servidor volta a verificar os choques antes de gravar — se algum
      // escapar, recusa tudo e diz qual.
      await saveMatchSchedule(tourId, proposal.slots)
      setProposal(null)
      load()
    } catch (err) {
      setError(describeError(t, err))
    } finally {
      setBusy(false)
    }
  }

  const save = async (match, input) => {
    setBusy(true)
    setError(''); setErrorFor(null)
    try {
      await saveMatchResult(match.match_id, input)
      // Fica no sítio, a verde (11 out); sai de «Por marcar» ao mudar de vista.
      if (view === 'todo') {
        setJustSaved((prev) => new Set(prev).add(match.match_id))
        setToast(t('tournament.score.saved_stays'))
      }
      load()
      return true
    } catch (err) {
      setError(describeError(t, err)); setErrorFor(match.match_id)
      return false
    } finally {
      setBusy(false)
    }
  }

  const confirmWalkover = async (kind, loser, justified) => {
    const { match } = sheet
    setBusy(true)
    setError(''); setErrorFor(null)
    try {
      // O ecrã mostra já o que fica marcado; o servidor guarda o mesmo.
      await markWalkover(match.match_id, { kind, loser, justified })
      setSheet(null)
      load()
    } catch (err) {
      setError(describeError(t, err)); setErrorFor(match.match_id)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => { setJustSaved(new Set()) }, [day, view])

  const back = <BackBar onBack={goBack} title={tournament?.name} />

  if (allMatches === null) {
    return <div className="flex items-center justify-center py-16"><div className="h-10 w-10 animate-spin rounded-full border-[3px] border-ink-50 border-t-ink-700" /></div>
  }

  // Os jogos do dia escolhido, contado em hora de Portugal (igual ao servidor).
  const matches = allMatches.filter((m) => m.scheduled_at && dayKeyInTz(new Date(m.scheduled_at)) === day)
  const done = matches.filter((m) => FINISHED.includes(m.status))
  const todoCount = matches.length - done.length
  // Por hora: «Por marcar» pela ordem do dia; «Já marcados», os mais recentes
  // em cima (SPEC, pontos 2 e 5).
  const shown = (view === 'todo'
    ? matches.filter((m) => !FINISHED.includes(m.status) || justSaved.has(m.match_id))
    : done)
    .slice()
    .sort((x, y) => (view === 'todo' ? 1 : -1) * (String(x.scheduled_at).localeCompare(String(y.scheduled_at)) || String(x.court).localeCompare(String(y.court), 'pt', { numeric: true })))
  const byHour = []
  for (const m of shown) {
    const h = hhmm(m.scheduled_at)
    if (!byHour.length || byHour[byHour.length - 1].h !== h) byHour.push({ h, list: [] })
    byHour[byHour.length - 1].list.push(m)
  }
  const noTime = unscheduledMatches(allMatches)
  // Pedidos de correção à espera (Trello #485), de todos os dias: o aviso
  // leva ao primeiro, trocando de dia se for preciso.
  const asks = allMatches.filter((m) => m.correction_request)
  const goToAsk = () => {
    const first = asks[0]
    if (!first) return
    if (first.scheduled_at) setDay(dayKeyInTz(new Date(first.scheduled_at)))
    setView('done')
    setTimeout(() => document.getElementById(`jogo-${first.match_id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 150)
  }
  const resolve = async (match, accept) => {
    if (accept) { setAccepting(match); return }
    setBusy(true); setError(''); setErrorFor(null)
    try { await resolveMatchCorrection(match.match_id, false); load() }
    catch (err) { console.error('Error rejecting a correction:', err); setError(describeError(t, err)); setErrorFor(match.match_id) }
    finally { setBusy(false) }
  }
  const labelFor = (iso) => new Date(`${iso}T12:00`).toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '')
  const dayLabel = labelFor(day)
  // «M4 e da F4» / «M4, F4 e MX4» (UX, 2 out).
  const joinCodes = (codes) => (codes.length === 2
    ? codes.join(t('tournament.score.codes_pair_joiner'))
    : codes.length > 2 ? `${codes.slice(0, -1).join(', ')}${t('tournament.score.codes_last_joiner')}${codes[codes.length - 1]}` : codes[0] || '')
  // «sex, 2 out» — a frase do dia que passou (UX, 2 out).
  const dayWithComma = (iso) => {
    const d = new Date(`${iso}T12:00`)
    const wd = d.toLocaleDateString(i18n.language, { weekday: 'short' }).replace(/\./g, '')
    const dm = d.toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' }).replace(/\./g, '').replace(' de ', ' ')
    return `${wd}, ${dm}`
  }
  const shortDay = (iso) => new Date(`${iso}T12:00`).toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric' }).replace(/\./g, '')

  return (
    <div className="space-y-4 pb-28">
      {back}
      <div>
        <h1 className="font-display text-2xl leading-tight text-ink-900">{t('tournament.score.title', { day: dayLabel })}</h1>
        <p className="mt-0.5 text-xs text-ink-500">
          {tournament?.name}{matches.length ? ` · ${t('tournament.score.done_count', { done: done.length, total: matches.length })}` : ''}
        </p>
      </div>

      {/* Os dias e o separador ficam presos ao descer (topo preso, 11 out). */}
      <StickyTabs resetKey={`${day}:${view}`}>
        {days.length > 1 && (
          <Chips label={t('tournament.score.day_picker')} value={day} onChange={setDay}
            options={days.map((d) => ({ value: d, label: `${labelFor(d)}${d === today ? ` · ${t('tournament.score.today')}` : ''}` }))} />
        )}
        <Tabs label={t('tournament.score.view_label')} value={view} onChange={setView}
          options={[
            { value: 'todo', label: t('tournament.score.tab_todo', { count: todoCount }) },
            { value: 'done', label: t('tournament.score.tab_done', { count: done.length }) },
          ]} />
      </StickyTabs>

      {error && !errorFor && <p role="alert" className="rounded-ctrl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm font-bold text-danger">{error}</p>}

      {asks.length > 0 && (
        <NeedsYou action={{ label: t('tcorrection.see'), onClick: goToAsk }}>
          {t('tcorrection.pending', { count: asks.length })}
        </NeedsYou>
      )}

      {isAdmin && noTime.length > 0 && (
        <div className="rounded-card border-2 border-dashed border-ink-900/30 p-3">
          <b className="text-sm text-ink-900">{t('tournament.score.unscheduled_title', { count: noTime.length })}</b>
          {!proposal ? (
            <>
              <p className="mt-1 text-sm text-ink-700">{t('tournament.score.unscheduled_body')}</p>
              <button type="button" disabled={busy} onClick={propose} className={`${BTN} ${DARK} mt-2`}>
                {t('tournament.score.propose')}
              </button>
            </>
          ) : proposal.noCourts ? (
            <p className="mt-1 text-sm text-ink-900">{t('tournament.score.no_courts')}</p>
          ) : (
            <>
              {/* O dia da categoria já passou (QA, 2 out): diz para onde vão
                  as horas, ou — sem dias por passar — porquê e onde se
                  marcam à mão. */}
              {proposal.moved?.map((mv) => (
                <p key={mv.code} className="mt-2 text-sm font-semibold text-ink-900">
                  {t('tournament.score.day_moved', { code: mv.code, from: dayWithComma(mv.from), to: dayWithComma(mv.to) })}
                </p>
              ))}
              {/* Uma frase só para todas (UX, 2 out): «O dia da M4 e da F4…». */}
              {proposal.stuck?.length > 0 && (
                <p className="mt-2 text-sm font-semibold text-ink-900">{t('tournament.score.day_gone', { codes: joinCodes(proposal.stuck.map((st) => st.code)) })}</p>
              )}
              {proposal.stuck?.length > 0 && (
                <button type="button" onClick={() => navigate(`/torneio/${id}?admin=horario`)} className={`${BTN} mt-2 border border-line bg-surface text-ink-900`}>
                  {t('tournament.score.open_grid')}
                </button>
              )}
              <div className="mt-2">
                {[...proposal.preview].sort((x, y) => String(x.scheduled_at).localeCompare(String(y.scheduled_at))).map((m) => (
                  <div key={m.match_id} className="grid grid-cols-[104px_minmax(0,1fr)] items-center gap-2 border-t border-line py-2 text-xs">
                    <b className="whitespace-nowrap font-mono text-xs text-ink-900">{shortDay(dayKeyInTz(new Date(m.scheduled_at)))} · {hhmm(m.scheduled_at)}</b>
                    <span className="min-w-0 text-ink-700">
                      {m.court} · {m.category_code} · {m.team_a?.name || sourceText(m.source_a, null, t)} × {m.team_b?.name || sourceText(m.source_b, null, t)}
                    </span>
                  </div>
                ))}
              </div>
              {proposal.left.length > 0 && (
                <p className="mt-1.5 text-xs text-danger">{t('tournament.score.schedule_left', { count: proposal.left.length })}</p>
              )}
              <div className="mt-2.5 flex flex-wrap gap-2">
                {/* Sem nada para gravar (o dia já passou), não há «Guardar». */}
                {(proposal.slots.length > 0 || !proposal.stuck?.length) && (
                  <button type="button" disabled={busy || !proposal.slots.length} onClick={saveSchedule} className={`${BTN} ${DARK}`}>
                    {t('tournament.score.save_schedule')}
                  </button>
                )}
                <button type="button" onClick={() => setProposal(null)} className="min-h-[44px] px-3 text-sm text-ink-500 hover:underline">
                  {t('tournament.create.cancel')}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {matches.length === 0 ? (
        <EmptyState icon={Trophy} title={t('tournament.score.empty_title')} subtitle={t('tournament.score.empty_subtitle')} />
      ) : shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">{t(view === 'todo' ? 'tournament.score.none_todo' : 'tournament.score.none_done')}</p>
      ) : byHour.map(({ h, list }) => (
        <section key={h} className="space-y-2.5">
          <MonoLabel>{h}</MonoLabel>
          {list.map((m) => (
            <ScoreCard key={m.match_id} match={m} scoring={scoring} tieTarget={tieTarget} busy={busy} t={t}
              saved={view === 'todo' && justSaved.has(m.match_id)}
              onSave={save} onWalkover={(match) => setSheet({ match })} onUndoWalkover={isAdmin ? setUndoing : null}
              onResolve={resolve} error={errorFor === m.match_id && !sheet ? error : null} />
          ))}
        </section>
      ))}

      {/* Aceitar mexe no resultado e, com a categoria fechada, nos pontos:
          pergunta uma vez, sem vermelho (regra das janelas). */}
      <ConfirmSheet
        open={!!accepting}
        title={t('tcorrection.accept_title')}
        message={accepting ? t('tcorrection.accept_message', {
          from: `${accepting.score_a}-${accepting.score_b}`,
          to: `${accepting.correction_request?.score_a}-${accepting.correction_request?.score_b}`,
        }) : ''}
        confirmLabel={t('tcorrection.accept')}
        cancelLabel={t('tournament.score.undo_not_now')}
        onConfirm={async () => { await resolveMatchCorrection(accepting.match_id, true); load() }}
        onClose={() => setAccepting(null)}
        errorOf={(err) => describeError(t, err)}
      />

      {sheet && (
        <WalkoverSheet match={sheet.match} t={t}
          error={errorFor === sheet.match.match_id ? error : null}
          onClose={() => { setSheet(null); setError(''); setErrorFor(null) }} onConfirm={confirmWalkover} />
      )}
      {undoing && (
        <ConfirmSheet
          open
          title={t(undoing.status === 'falta' ? 'tournament.score.undo_walkover_title' : 'tournament.score.undo_retirement_title',
            { a: undoing.team_a?.name || '?', b: undoing.team_b?.name || '?' })}
          message={t('tournament.score.undo_walkover_consequence')}
          confirmLabel={t(undoing.status === 'falta' ? 'tournament.score.undo_walkover' : 'tournament.score.undo_retirement')}
          cancelLabel={t('tournament.score.undo_not_now')}
          onConfirm={async () => { await undoWalkover(undoing.match_id); load() }}
          onClose={() => setUndoing(null)}
          errorOf={(err) => describeError(t, err)}
        />
      )}

      {/* No body, como as tiras da página do mix: dentro da página, o
          «fixed» ficava preso a ela e a tira ia para o fundo. */}
      {toast && createPortal(
        <div role="status" className="fixed inset-x-4 bottom-[104px] z-50 mx-auto max-w-md rounded-ctrl bg-ink-900 px-4 py-3 text-sm font-extrabold text-white animate-fade-up">
          {toast}
        </div>,
        document.body,
      )}
    </div>
  )
}
