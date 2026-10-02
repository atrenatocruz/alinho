// A barra de quem organiza (Trello #436 e #439, ponto 2 do desenho de 23
// set). Até aqui a página do torneio não tinha UMA acção de administrador:
// para abrir inscrições, sortear ou editar era preciso sair, ir ao Gerir,
// achar o separador certo e o cartão certo. No dia do torneio isso é o
// organizador de telemóvel na mão, no meio do clube, com gente à espera.
//
// Regras do desenho, todas de propósito:
//   · só aparece a quem é admin DAQUELE clube;
//   · o estado vem com uma linha a dizer em que ponto se está — sem ela o
//     estado é decoração;
//   · UM botão para o passo seguinte, com o nome do que faz;
//   · nunca um ícone sozinho — cada acção diz-se por extenso;
//   · um botão que desaparece deixa no lugar a RAZÃO, não um espaço vazio.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { MoreHorizontal, Pencil } from 'lucide-react'
import { deleteTournament, setTournamentStatus } from '../../lib/tournamentApi'
import { describeError } from '../../lib/errors'
import { canDelete } from '../../lib/tournaments'
import { TOURNAMENT_TZ } from '../../lib/tournamentDay'
import CloseCategories from './CloseCategories'
import { deadlinePassed, drawProgress, statusKey } from './drawProgress'
import { ConfirmSheet } from '../ui'
import EventActionsSheet from '../EventActionsSheet'

/** O passo seguinte de cada estado. Do sorteio em diante não se anda à mão:
 *  é o que a `set_tournament_status` deixa fazer, e a barra não promete o
 *  que o servidor recusa. */
const NEXT_STEP = {
  rascunho: 'inscricoes',
  inscricoes: 'fechado',
  fechado: null, // o sorteio faz-se no ecrã do sorteio, não aqui
}

/** "5 out, 23:59" — no relógio do torneio (Lisboa), não no do telemóvel:
 *  é o mesmo prazo que o formulário grava e que as inscrições respeitam
 *  (Trello #487). */
function whenDeadline(iso, locale) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const day = d.toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: TOURNAMENT_TZ }).replace('.', '')
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: TOURNAMENT_TZ })
  return `${day}, ${time}`
}

// Compactos, para os três caberem numa linha no telemóvel (como no mix).
const PRIMARY = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-ctrl bg-ink-900 px-2.5 text-sm leading-tight font-extrabold text-white disabled:opacity-50'
const SECONDARY = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-ctrl border border-line bg-surface px-2.5 text-sm font-extrabold text-ink-900 shrink-0 whitespace-nowrap'

export default function AdminBar({ tournament, categories = [], onChanged, onEdit, onDraw, onSchedule, onEntries, onScorekeepers, part = 'top' }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // Perguntas na folha da app, não na caixa do telemóvel (#435).
  const [ask, setAsk] = useState(null) // null | 'delete' | 'close'
  // «Mais ⋯» (revisão de 28 set, peça 5): tudo o resto, numa folha.
  const [moreOpen, setMoreOpen] = useState(false)

  const status = tournament?.status
  const next = NEXT_STEP[status]
  const live = status === 'sorteado' || status === 'a_decorrer'
  // O sorteio anda categoria a categoria (Trello #560): o botão fica
  // enquanto houver uma categoria fechada e por sortear, e o estado diz
  // quantas faltam — o torneio já está «sorteado» desde a primeira.
  const progress = drawProgress(categories)
  const canDraw = status !== 'rascunho' && (status === 'fechado' || progress.toDraw.length > 0)
  // Com inscrições feitas há coisas que deixam de se poder fazer. Quando
  // isso acontece, o lugar do botão fica com a RAZÃO escrita — nunca um
  // espaço vazio, que é o que deixa quem monta sem saber se a acção não
  // existe, se está noutro sítio, ou se está trancada.

  const deletable = canDelete(tournament)

  // Se apagar falhar, o erro fica na folha (ConfirmSheet), junto ao botão.
  const remove = async () => {
    await deleteTournament(tournament.id)
    navigate('/gerir')
  }

  const go = async (to) => {
    setBusy(true); setError(null)
    try {
      await setTournamentStatus(tournament.id, to)
      onChanged?.()
    } catch (err) {
      console.error('Error changing tournament status:', err)
      setError(describeError(t, err))
    } finally {
      setBusy(false)
    }
  }

  // Sem pergunta (designer, 24 set — regra 1 do #435): este botão só abre o
  // ecrã do sorteio, que mostra tudo e pede confirmação antes de gravar.
  // Perguntar duas vezes ensina a carregar em «sim» sem ler.
  const draw = () => onDraw?.()

  const deadlineGone = status === 'inscricoes' && deadlinePassed(tournament?.entries_deadline)

  // Em cima, como no mix (pacote da revisão, ponto 1): só «Editar» e
  // «Mais ⋯». Saem «ORGANIZAÇÃO · <estado>» e a frase do estado.
  if (part === 'top') {
    return (
      <div>
        <div className="flex gap-1.5">
          {/* Abre AQUI, onde a pessoa já está (o formulário não tem rota própria). */}
          <button type="button" onClick={() => onEdit?.()} className={SECONDARY}>
            <Pencil size={14} /> {t('eventactions.edit')}
          </button>
          <button type="button" onClick={() => setMoreOpen(true)} aria-haspopup="dialog" className={SECONDARY}>
            {t('eventactions.more')} <MoreHorizontal size={16} />
          </button>
        </div>
        <EventActionsSheet
          open={moreOpen}
          title={tournament?.name || ''}
          subtitle={t(statusKey(status, progress), { drawn: progress.drawn, total: progress.total })}
          onClose={() => setMoreOpen(false)}
          actions={[
            live && { key: 'score', label: t('tournament.score.link_cta'), hint: t('tournament.admin.more_score_hint'),
              onClick: () => navigate(`/torneio/${tournament.slug || tournament.id}/marcar`) },
            live && { key: 'schedule', label: t('tournament.admin.schedule'), hint: t('tournament.admin.more_schedule_hint'), onClick: () => onSchedule?.() },
            { key: 'entries', label: t('tournament.admin.more_entries'), hint: t('tournament.admin.more_entries_hint'), onClick: () => onEntries?.() },
            { key: 'scorekeepers', label: t('tournament.admin.more_scorekeepers'), hint: t('tournament.admin.more_scorekeepers_hint'), onClick: () => onScorekeepers?.() },
            { key: 'notice', label: t('tournament.admin.more_notice'), hint: t('tournament.admin.more_notice_hint'),
              onClick: () => window.dispatchEvent(new CustomEvent('tournament:new-notice')) },
            live && { key: 'finish', label: t('tournament.admin.more_finish'), hint: t('tournament.admin.more_finish_hint'),
              onClick: () => document.getElementById('tournament-close-categories')?.scrollIntoView({ behavior: 'smooth', block: 'center' }) },
            { key: 'public', label: t('tournament.admin.view_public'), hint: t('tournament.admin.more_public_hint'), onClick: () => {
              const url = new URL(window.location.href)
              url.searchParams.set('ver', 'publico')
              navigate(`${url.pathname}${url.search}`)
            } },
            // Sempre em último; sem se poder apagar, apagado e com a razão.
            { key: 'delete', danger: true, disabled: !deletable, label: t('tournament.admin.delete_tournament'),
              hint: deletable ? null : t('tournament.admin.cannot_delete'), onClick: () => setAsk('delete') },
          ].filter(Boolean)}
        />
        <ConfirmSheet
          open={ask === 'delete'}
          danger
          title={t('tournament.admin.delete_title_named', { name: tournament?.name })}
          message={t('tournament.admin.delete_consequence')}
          cancelLabel={t('tournament.admin.delete_keep')}
          confirmLabel={t('tournament.admin.delete_yes')}
          onConfirm={remove}
          onClose={() => setAsk(null)}
          errorOf={(err) => describeError(t, err)}
        />
      </div>
    )
  }

  // Em baixo, por baixo do cartão do torneio, como o preto do mix (ponto 2):
  // o passo seguinte, uma só vez; a frase do prazo só quando já passou; e,
  // com o sorteio feito, o terminar de cada categoria.
  if (!next && !canDraw && !live) return null
  return (
    <div className="space-y-1.5">
      {deadlineGone && (
        <p className="text-xs text-ink-700">{t('tournament.admin.state_deadline_passed', { deadline: whenDeadline(tournament?.entries_deadline, i18n.language) })}</p>
      )}
      {next && (
        <button type="button" disabled={busy}
          // Fechar as inscrições pergunta antes (Trello #500): um toque por
          // engano deixava toda a gente de fora. Sem vermelho — reabre-se.
          onClick={() => (next === 'fechado' ? setAsk('close') : go(next))}
          className={`${PRIMARY} w-full`}>
          {t(`tournament.admin.to_${next}`)}
        </button>
      )}
      {canDraw && (
        <button type="button" disabled={busy} onClick={draw} className={`${PRIMARY} w-full`}>
          {t('tournament.admin.do_draw')}
        </button>
      )}
      {/* Com o sorteio feito, o passo seguinte é fechar cada categoria — e
          o torneio fecha sozinho com a última (Trello #485). */}
      {live && (
        <div id="tournament-close-categories" className="card scroll-mt-20">
          <CloseCategories tournament={tournament} onChanged={onChanged} />
        </div>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
      <ConfirmSheet
        open={ask === 'close'}
        title={t('tournament.admin.close_title', { name: tournament?.name })}
        message={t('tournament.admin.close_consequence')}
        confirmLabel={t('tournament.admin.to_fechado')}
        cancelLabel={t('tournament.admin.close_not_now')}
        onConfirm={async () => { await setTournamentStatus(tournament.id, 'fechado'); onChanged?.() }}
        onClose={() => setAsk(null)}
        errorOf={(err) => describeError(t, err)}
      />
    </div>
  )
}
