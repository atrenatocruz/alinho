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
import { Eye, Pencil, Trash2 } from 'lucide-react'
import { deleteTournament, setTournamentStatus } from '../../lib/tournamentApi'
import { describeError } from '../../lib/errors'
import { canDelete } from '../../lib/tournaments'
import { TOURNAMENT_TZ } from '../../lib/tournamentDay'
import { MonoLabel, StatePill } from './TournamentBits'
import CloseCategories from './CloseCategories'
import { drawProgress, statusKey } from './drawProgress'
import { ConfirmSheet } from '../ui'

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

const STATE_PILL = {
  rascunho: 'grey', inscricoes: 'grey', fechado: 'grey',
  sorteado: 'dark', a_decorrer: 'live', terminado: 'grey',
}

export default function AdminBar({ tournament, categories = [], onChanged, onEdit, onDraw }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // Perguntas na folha da app, não na caixa do telemóvel (#435).
  const [ask, setAsk] = useState(null) // null | 'delete' | 'close'

  const status = tournament?.status
  const next = NEXT_STEP[status]
  // O sorteio anda categoria a categoria (Trello #560): o botão fica
  // enquanto houver uma categoria fechada e por sortear, e o estado diz
  // quantas faltam — o torneio já está «sorteado» desde a primeira.
  const progress = drawProgress(categories)
  const canDraw = status !== 'rascunho' && (status === 'fechado' || progress.toDraw.length > 0)
  const codes = (list) => list.map((c) => c.code).filter(Boolean).join(', ')
  const partialLine = [
    t('tournament.admin.state_draw_partial', { drawn: progress.drawn, total: progress.total }),
    progress.toDraw.length > 0 && t('tournament.admin.state_draw_left', { codes: codes(progress.toDraw) }),
    progress.open.length > 0 && t('tournament.admin.state_draw_open', { codes: codes(progress.open) }),
  ].filter(Boolean).join(' ')
  // `is_preview` vem da base de dados e quer dizer: este torneio NÃO abre a
  // quem chega de fora — ou porque ainda é rascunho, ou porque está
  // escondido. É o que fechava o «#437»: a seta do Gerir dava «Torneio não
  // encontrado» e ninguém percebia se tinha perdido o torneio.
  // Fica dentro desta barra, e não numa segunda caixa por cima: eram duas a
  // dizer quase o mesmo, e o desenho pede o contrário — nada repetido.
  const preview = !!tournament?.is_preview
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

  return (
    <div className="rounded-card border border-line bg-ink-50/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <MonoLabel>{preview ? t('tournament.admin.preview_label') : t('tournament.admin.label')}</MonoLabel>
        <StatePill tone={STATE_PILL[status] || 'grey'}>{t(statusKey(status, progress), { drawn: progress.drawn, total: progress.total })}</StatePill>
      </div>

      {/* A linha que explica o estado ACRESCENTA à pastilha, não a repete:
          a pastilha diz onde se está, a linha diz o que falta. É o ponto do
          desenho — sem ela o estado é decoração. */}
      {preview && (
        <p className="mt-1.5 text-[12px] text-ink-900">
          <b>{t('tournament.admin.preview_nobody')}</b>
          {status === 'rascunho' && ` ${t('tournament.admin.preview_how')}`}
        </p>
      )}

      {/* Em rascunho a linha do estado diria outra vez «só tu o vês» — o que
          a de cima já disse melhor. Duas linhas a dizer o mesmo é o que o
          desenho manda evitar. */}
      {!(preview && status === 'rascunho') && (
        <p className="mt-1.5 text-[12px] text-ink-700">{progress.partial && ['sorteado', 'a_decorrer'].includes(status)
          ? partialLine
          : t(`tournament.admin.state_${status}`, {
            deadline: whenDeadline(tournament?.entries_deadline, i18n.language),
            matches: tournament?.match_count ?? 0,
          })}</p>
      )}

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {next && (
          <button type="button" disabled={busy}
            // Fechar as inscrições pergunta antes (Trello #500): um toque por
            // engano deixava toda a gente de fora. Sem vermelho — reabre-se.
            onClick={() => (next === 'fechado' ? setAsk('close') : go(next))}
            className="min-h-[44px] rounded-ctrl bg-ink-900 px-3 py-2 text-[12px] font-bold text-white disabled:opacity-50">
            {t(`tournament.admin.to_${next}`)}
          </button>
        )}
        {canDraw && (
          <button type="button" disabled={busy} onClick={draw}
            className="min-h-[44px] rounded-ctrl bg-ink-900 px-3 py-2 text-[12px] font-bold text-white disabled:opacity-50">
            {t('tournament.admin.do_draw')}
          </button>
        )}
        {/* Abre AQUI, onde a pessoa já está. Antes mandava para `/gerir` com
            parâmetros que ninguém lê — e `/gerir` sem clube é o ecrã de
            escolher organização, onde há um «Remover foto» que apaga a foto
            de PERFIL. Quem ia editar o torneio podia apagá-la sem perceber.
            O formulário de editar não tem rota própria, por isso não havia
            para onde navegar: tem de abrir no sítio. */}
        <button type="button" onClick={() => onEdit?.()}
          className="inline-flex items-center gap-1.5 min-h-[44px] rounded-ctrl border border-line bg-canvas px-3 py-2 text-[12px] font-bold text-ink-900">
          <Pencil size={14} /> {preview ? t('tournament.admin.keep_editing') : t('tournament.admin.edit')}
        </button>
        <button type="button" onClick={() => {
          const url = new URL(window.location.href)
          url.searchParams.set('ver', 'publico')
          navigate(`${url.pathname}${url.search}`)
        }}
          className="inline-flex items-center gap-1.5 min-h-[44px] rounded-ctrl border border-line bg-canvas px-3 py-2 text-[12px] font-bold text-ink-900">
          <Eye size={14} /> {t('tournament.admin.view_public')}
        </button>
      </div>

      {/* Com o sorteio feito, o passo seguinte é fechar cada categoria — e
          o torneio fecha sozinho com a última (Trello #485). */}
      {(status === 'sorteado' || status === 'a_decorrer') && (
        <CloseCategories tournament={tournament} onChanged={onChanged} />
      )}

      {/* Um botão que sai deixa a razão no lugar dele, nunca um vazio. */}
      {!next && status !== 'fechado' && status !== 'sorteado' && status !== 'a_decorrer' && (
        <p className="mt-2 text-[11.5px] text-ink-500">{t('tournament.admin.no_step')}</p>
      )}
      {deletable ? (
        <button type="button" disabled={busy} onClick={() => setAsk('delete')}
          className="mt-2 inline-flex items-center gap-1.5 min-h-[44px] rounded-ctrl border border-line bg-canvas px-3 py-2 text-[12px] font-bold text-danger disabled:opacity-50">
          <Trash2 size={14} /> {t('tournament.admin.delete')}
        </button>
      ) : (
        <p className="mt-1.5 text-[11.5px] text-ink-500">{t('tournament.admin.cannot_delete')}</p>
      )}
      {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}

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
