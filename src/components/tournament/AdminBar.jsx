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
import { MonoLabel, StatePill } from './TournamentBits'

/** O passo seguinte de cada estado. Do sorteio em diante não se anda à mão:
 *  é o que a `set_tournament_status` deixa fazer, e a barra não promete o
 *  que o servidor recusa. */
const NEXT_STEP = {
  rascunho: 'inscricoes',
  inscricoes: 'fechado',
  fechado: null, // o sorteio faz-se no ecrã do sorteio, não aqui
}

/** "5 out, 23:59" — a hora só aparece quando não é meia-noite, que é o caso
 *  normal de um prazo posto à mão. */
function whenDeadline(iso, locale) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const day = d.toLocaleDateString(locale, { day: 'numeric', month: 'short' }).replace('.', '')
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  return `${day}, ${time}`
}

const STATE_PILL = {
  rascunho: 'grey', inscricoes: 'grey', fechado: 'grey',
  sorteado: 'dark', a_decorrer: 'live', terminado: 'grey',
}

export default function AdminBar({ tournament, onChanged, onEdit, onDraw }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const status = tournament?.status
  const next = NEXT_STEP[status]
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

  const remove = async () => {
    if (!window.confirm(t('tournament.admin.delete_message', { name: tournament.name }))) return
    setBusy(true); setError(null)
    try {
      await deleteTournament(tournament.id)
      navigate('/gerir')
    } catch (err) {
      console.error('Error deleting tournament:', err)
      setError(describeError(t, err)); setBusy(false)
    }
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

  const draw = () => {
    // O sorteio é a última porta, e tem de o dizer em português antes de se
    // atravessar: daqui para a frente não se reabrem inscrições.
    if (!window.confirm(t('tournament.admin.confirm_draw'))) return
    onDraw?.()
  }

  return (
    <div className="rounded-card border border-line bg-ink-50/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <MonoLabel>{preview ? t('tournament.admin.preview_label') : t('tournament.admin.label')}</MonoLabel>
        <StatePill tone={STATE_PILL[status] || 'grey'}>{t(`tournament.status_${status}`)}</StatePill>
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
        <p className="mt-1.5 text-[12px] text-ink-700">{t(`tournament.admin.state_${status}`, {
          deadline: whenDeadline(tournament?.entries_deadline, i18n.language),
          matches: tournament?.match_count ?? 0,
        })}</p>
      )}

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {next && (
          <button type="button" disabled={busy} onClick={() => go(next)}
            className="rounded-ctrl bg-ink-900 px-3 py-2 text-[12px] font-bold text-white disabled:opacity-50">
            {t(`tournament.admin.to_${next}`)}
          </button>
        )}
        {status === 'fechado' && (
          <button type="button" disabled={busy} onClick={draw}
            className="rounded-ctrl bg-ink-900 px-3 py-2 text-[12px] font-bold text-white disabled:opacity-50">
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
          className="inline-flex items-center gap-1.5 rounded-ctrl border border-line bg-canvas px-3 py-2 text-[12px] font-bold text-ink-900">
          <Pencil size={14} /> {preview ? t('tournament.admin.keep_editing') : t('tournament.admin.edit')}
        </button>
        <button type="button" onClick={() => {
          const url = new URL(window.location.href)
          url.searchParams.set('ver', 'publico')
          navigate(`${url.pathname}${url.search}`)
        }}
          className="inline-flex items-center gap-1.5 rounded-ctrl border border-line bg-canvas px-3 py-2 text-[12px] font-bold text-ink-900">
          <Eye size={14} /> {t('tournament.admin.view_public')}
        </button>
      </div>

      {/* Um botão que sai deixa a razão no lugar dele, nunca um vazio. */}
      {!next && status !== 'fechado' && (
        <p className="mt-2 text-[11.5px] text-ink-500">{t('tournament.admin.no_step')}</p>
      )}
      {deletable ? (
        <button type="button" disabled={busy} onClick={remove}
          className="mt-2 inline-flex items-center gap-1.5 rounded-ctrl border border-line bg-canvas px-3 py-2 text-[12px] font-bold text-danger disabled:opacity-50">
          <Trash2 size={14} /> {t('tournament.admin.delete')}
        </button>
      ) : (
        <p className="mt-1.5 text-[11.5px] text-ink-500">{t('tournament.admin.cannot_delete')}</p>
      )}
      {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
    </div>
  )
}
