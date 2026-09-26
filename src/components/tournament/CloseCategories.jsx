// Fechar as categorias, dentro da barra do organizador (Trello #485).
//
// Fechar uma categoria é o que dá os pontos de ranking e põe o pódio na
// página. Até aqui não havia botão nenhum para isso: a função existia na
// base de dados e ninguém a conseguia chamar.
//
// Regras, todas de propósito:
//   · uma linha por categoria, com o estado dela — o botão só aparece quando
//     o servidor o aceita; no lugar dele fica a RAZÃO («faltam 3 jogos»);
//   · antes de fechar mostra-se o pódio que vai ficar, e diz-se o que fechar
//     faz. Não se reabre — mas um resultado errado continua a corrigir-se, e
//     os pontos acertam-se sozinhos (migration_tournaments_recalc, #449);
//   · NÃO há botão de fechar o torneio: fecha sozinho quando fecha a última
//     categoria, e a barra di-lo.
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { finishCategory } from '../../lib/tournamentApi'
import {
  getCategoryBoard, listCategoriesAdmin, standingsOf,
  qualifiedFromGroups, qualifiersPerGroup, fillBracketFromGroups, clearBracketFromGroups,
} from '../../lib/tournamentDraw'
import { describeError } from '../../lib/errors'
import { ConfirmSheet, Select } from '../ui'
import { MonoLabel } from './TournamentBits'

const DRAWN = ['sorteada', 'a_decorrer']
const OPEN_MATCH = ['marcado', 'a_decorrer']

/** Em que ponto está uma categoria, com as MESMAS regras da
 *  `finish_category` — o ecrã não promete o que o servidor recusa:
 *    closed          já fechada
 *    not_drawn       ainda sem sorteio
 *    pending         há jogos com as duas duplas e sem resultado
 *    final_unplayed  a final existe mas ainda não tem vencedor
 *    ready           pode fechar; `podium` = [1.º, 2.º, 3.º] (ids ou null),
 *                    ou `choose` quando não há final e há vários grupos —
 *                    aí não há conta honesta, quem organiza diz quem ficou. */
export function closeStatus(category, board) {
  if (category?.status === 'terminada') return { kind: 'closed' }
  if (!DRAWN.includes(category?.status)) return { kind: 'not_drawn' }

  const { groups = [], matches = [] } = board || {}
  const pending = matches.filter((m) => m.entry_a_id && m.entry_b_id && OPEN_MATCH.includes(m.status)).length
  if (pending > 0) return { kind: 'pending', pending }

  const final = matches
    .filter((m) => m.stage === 'principal' && m.round === 'F')
    .sort((a, b) => (a.bracket_slot ?? 0) - (b.bracket_slot ?? 0))[0]
  if (final) {
    if (!final.winner_entry_id) return { kind: 'final_unplayed' }
    const second = final.entry_a_id === final.winner_entry_id ? final.entry_b_id : final.entry_a_id
    const third = matches.find((m) => m.stage === '3lugar')?.winner_entry_id || null
    return { kind: 'ready', fromBracket: true, podium: [final.winner_entry_id, second || null, third] }
  }

  // Só grupos, com um grupo: o pódio é a tabela — a mesma que a página
  // mostra no separador dos jogos, com o mesmo desempate.
  if (groups.length === 1) {
    const table = standingsOf(groups[0], matches)
    const ids = table.slice(0, 3).map((r) => r.id)
    return { kind: 'ready', fromBracket: false, podium: [ids[0] || null, ids[1] || null, ids[2] || null] }
  }
  return { kind: 'ready', fromBracket: false, choose: true, podium: [null, null, null] }
}

const FINISHED = ['terminado', 'falta', 'desistencia']

/** Grupos → quadro (Trello #484). Só quando o quadro sai dos grupos: os
 *  lugares da eliminatória dizem «1.º do Grupo A», e é por esse texto que a
 *  base de dados os encontra (`fill_bracket_from_groups`, Dev 3).
 *    null            esta categoria não tem quadro a sair dos grupos
 *    groups_running  ainda há jogos de grupo por acabar (`pending`)
 *    to_fill         grupos acabados, quadro vazio → `qualified` (a lista) e
 *                    `ties` (empates por resolver — com eles não se passa)
 *    filled          quadro já preenchido; `canUndo` até ao 1.º resultado */
export function bracketStatus(category, board) {
  const { groups = [], matches = [] } = board || {}
  if (!groups.length) return null
  const q = qualifiedFromGroups(groups, matches, qualifiersPerGroup(category))
  const labels = new Set(q.qualified.map((x) => x.label))
  const slots = []
  for (const m of matches.filter((x) => x.stage === 'principal')) {
    if (labels.has(m.source_a)) slots.push(m.entry_a_id)
    if (labels.has(m.source_b)) slots.push(m.entry_b_id)
  }
  if (!slots.length) return null
  const started = matches.some((m) => m.stage !== 'grupo' && (FINISHED.includes(m.status) || m.winner_entry_id))
  if (slots.every(Boolean)) return { kind: 'filled', canUndo: !started }
  if (!q.ready) return { kind: 'groups_running', pending: q.pending }
  // Empate que as regras não desfazem, e que mexe em quem passa: não se
  // passa ninguém ao acaso (`ties`, Dev 3 — sem o campo, não há empates).
  return { kind: 'to_fill', qualified: q.qualified, ties: q.ties || [] }
}

const PLACES = ['first', 'second', 'third']

function Podium({ podium, entries, t }) {
  return (
    <ol className="mt-1.5 space-y-0.5">
      {podium.map((id, i) => id && (
        <li key={PLACES[i]} className="text-xs text-ink-900">
          <span className="inline-block w-7 font-bold">{t(`tournament.close.place_${PLACES[i]}`)}</span>
          {entries[id]?.name || '?'}
        </li>
      ))}
    </ol>
  )
}

/** Quando não há conta que diga o pódio: três escolhas, a 3.ª opcional. */
function PodiumPicker({ value, onChange, entries, t }) {
  const options = Object.values(entries).filter((e) => !e.status || e.status === 'selecionada')
  return (
    <div className="mt-1.5 space-y-1.5">
      <p className="text-xs text-ink-700">{t('tournament.close.choose_hint')}</p>
      {PLACES.map((place, i) => (
        <label key={place} className="flex items-center gap-2 text-xs text-ink-900">
          <span className="w-7 font-bold">{t(`tournament.close.place_${place}`)}</span>
          {/* O Select da app (revisão da designer, 26 set). Uma dupla já
              escolhida noutro lugar não aparece — em vez de ficar cinzenta. */}
          <Select
            className="min-w-0 flex-1"
            value={value[i] || ''}
            onChange={(v) => onChange(value.map((x, j) => (j === i ? (v || null) : x)))}
            placeholder={t('tournament.close.pick')}
            options={[
              ...(i === 2 ? [{ value: '', label: t('tournament.close.nobody') }] : []),
              ...options.filter((e) => !value.some((v, j) => j !== i && v === e.id)).map((e) => ({ value: e.id, label: e.name })),
            ]}
          />
        </label>
      ))}
    </div>
  )
}

function CategoryRow({ category, board, onClosed }) {
  const { t } = useTranslation()
  const status = closeStatus(category, board)
  const bracket = bracketStatus(category, board)
  const [asking, setAsking] = useState(null) // null | 'fill' | 'undo'
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState([null, null, null])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const podium = status.choose ? picked : status.podium
  const canConfirm = !!podium?.[0] && (!status.choose || !!podium[1])

  const confirm = async () => {
    setBusy(true); setError(null)
    try {
      // Com final, o servidor tira o pódio dos resultados e ignora o que se
      // mande; só se manda quando é o ecrã a dizê-lo.
      await finishCategory(category.id, status.fromBracket ? {} : {
        champion: podium[0], runnerUp: podium[1], third: podium[2],
      })
      setOpen(false)
      onClosed?.()
    } catch (err) {
      console.error('Error closing category:', err)
      setError(describeError(t, err))
    } finally {
      setBusy(false)
    }
  }

  const fill = async () => {
    await fillBracketFromGroups(category.id, bracket.qualified)
    onClosed?.()
  }
  const undo = async () => {
    await clearBracketFromGroups(category.id)
    onClosed?.()
  }
  const toFill = bracket?.kind === 'to_fill'

  const right = toFill ? (
    <button type="button" onClick={() => setAsking('fill')}
      className="inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-ctrl bg-ink-900 px-5 text-base font-extrabold text-white">
      {t('tournament.bracket.fill')}
    </button>
  ) : {
    closed: <span className="text-xs font-bold text-ink-500">{t('tournament.close.closed')}</span>,
    not_drawn: <span className="text-xs text-ink-500">{t('tournament.close.not_drawn')}</span>,
    pending: <span className="text-xs text-ink-500">{t('tournament.close.pending', { count: status.pending })}</span>,
    final_unplayed: <span className="text-xs text-ink-500">{t('tournament.close.final_unplayed')}</span>,
    ready: !open && (
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-ctrl bg-ink-900 px-5 text-base font-extrabold text-white">
        {t('tournament.close.close')}
      </button>
    ),
  }[status.kind]

  return (
    <li className="py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-bold text-ink-900">
          {category.code && <span className="mr-1.5 text-ink-500">{category.code}</span>}{category.name}
        </span>
        {right}
      </div>

      {/* Quadro já preenchido: diz-se, e desfaz-se até ao 1.º resultado. */}
      {bracket?.kind === 'filled' && status.kind !== 'closed' && (
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-500">
          {t('tournament.bracket.filled')}
          {bracket.canUndo && (
            <button type="button" onClick={() => setAsking('undo')}
              className="min-h-[44px] font-bold text-ink-900 underline underline-offset-2">
              {t('tournament.bracket.undo')}
            </button>
          )}
        </p>
      )}

      <ConfirmSheet
        open={asking === 'fill'}
        title={t('tournament.bracket.fill_title', { code: category.code || category.name })}
        message={t('tournament.bracket.fill_message')}
        confirmLabel={t('tournament.bracket.fill')}
        cancelLabel={t('tournament.bracket.not_now')}
        confirmDisabled={toFill && bracket.ties.length > 0}
        onConfirm={fill}
        onClose={() => setAsking(null)}
        errorOf={(err) => describeError(t, err)}
      >
        {toFill && bracket.ties.map((tie) => (
          <p key={tie.group} role="alert" className="mt-3 rounded-ctrl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm font-bold text-danger">
            {t('tournament.bracket.tie', {
              group: tie.groupName || tie.group,
              names: (tie.entry_ids || []).map((id) => board?.entries?.[id]?.name || '?').join(t('tournament.bracket.and')),
            })}
          </p>
        ))}
        {toFill && (
          <ul className="mt-3 divide-y divide-line rounded-ctrl border border-line">
            {bracket.qualified.map((q) => (
              <li key={q.label} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="shrink-0 text-ink-500">{q.label}</span>
                <span className="min-w-0 truncate text-right font-bold text-ink-900">{board?.entries?.[q.entry_id]?.name || '?'}</span>
              </li>
            ))}
          </ul>
        )}
      </ConfirmSheet>
      <ConfirmSheet
        open={asking === 'undo'}
        title={t('tournament.bracket.undo_title', { code: category.code || category.name })}
        message={t('tournament.bracket.undo_message')}
        confirmLabel={t('tournament.bracket.undo')}
        cancelLabel={t('tournament.bracket.not_now')}
        onConfirm={undo}
        onClose={() => setAsking(null)}
        errorOf={(err) => describeError(t, err)}
      />

      {open && (
        <div className="mt-2 rounded-ctrl border border-line bg-canvas p-2.5">
          <p className="text-xs font-bold text-ink-900">{t('tournament.close.podium_title')}</p>
          {status.choose
            ? <PodiumPicker value={picked} onChange={setPicked} entries={board?.entries || {}} t={t} />
            : <Podium podium={podium} entries={board?.entries || {}} t={t} />}
          <p className="mt-2 text-xs text-ink-700">{t('tournament.close.what_it_does')}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button type="button" disabled={busy || !canConfirm} onClick={confirm}
              className="inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-ctrl bg-ink-900 px-5 text-base font-extrabold text-white disabled:opacity-50">
              {t('tournament.close.confirm', { name: category.name })}
            </button>
            <button type="button" disabled={busy} onClick={() => { setOpen(false); setError(null) }}
              className="inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-ctrl border border-line bg-surface px-5 text-base font-extrabold text-ink-900">
              {t('tournament.close.cancel')}
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        </div>
      )}
    </li>
  )
}

export default function CloseCategories({ tournament, onChanged }) {
  const { t } = useTranslation()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const { categories = [] } = await listCategoriesAdmin(tournament.id)
      const sorted = [...categories].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      // Só se lê o quadro das que podem fechar; as outras não precisam.
      const boards = await Promise.all(sorted.map((c) => (DRAWN.includes(c.status) ? getCategoryBoard(c.id) : null)))
      setRows(sorted.map((c, i) => ({ category: c, board: boards[i] })))
      setError(null)
    } catch (err) {
      console.error('Error loading categories to close:', err)
      setError(describeError(t, err))
    }
  }, [tournament.id, t])

  useEffect(() => { load() }, [load])

  if (error) return <p className="mt-2 text-xs text-danger">{error}</p>
  if (!rows || rows.length === 0) return null

  // Só prende o torneio uma categoria sem sorteio COM inscrições confirmadas
  // (validada ou selecionada) — a mesma regra da finish_category (#539, Dev
  // 3). `confirmed_count` vem da list_tournament_categories_admin; sem ele
  // (função antiga), conta-se como antes.
  const blocked = rows.filter((r) => closeStatus(r.category, r.board).kind === 'not_drawn'
    && (r.category.confirmed_count == null || Number(r.category.confirmed_count) > 0)).length

  return (
    <div className="mt-3 border-t border-line pt-2">
      <MonoLabel>{t('tournament.close.title')}</MonoLabel>
      <ul className="divide-y divide-line">
        {rows.map(({ category, board }) => (
          <CategoryRow key={category.id} category={category} board={board}
            onClosed={() => { load(); onChanged?.() }} />
        ))}
      </ul>
      {/* O torneio não tem botão de fechar: fecha com a última categoria. E
          uma categoria sem sorteio segura-o aberto — tem de se dizer, senão
          fica «a decorrer» para sempre sem ninguém perceber porquê. */}
      <p className="mt-1 text-xs text-ink-500">
        {blocked > 0 ? t('tournament.close.tournament_blocked', { count: blocked }) : t('tournament.close.tournament_closes_itself')}
      </p>
    </div>
  )
}
