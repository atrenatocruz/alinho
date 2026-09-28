// O resultado por sets na folha «Resultado do jogo N» (editar e juntar sets,
// 27 set): uma linha por set, com as duas duplas por cima das colunas. Em
// «Melhor de 3» o set 3 só aparece com 1–1; em «Sets à vontade» junta-se mais
// um com «＋ Set». Antes de gravar diz quem ganha.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { setsState, best3NeedsThird } from './friendScoring'
import { shortName } from './friendShare'

const pair = (team) => (team || []).map((p) => shortName(p.name)).join(' / ')
const EMPTY = () => ({ a: '', b: '' })

export default function FriendSetsEntry({ mode, maxSets = null, teamA, teamB, onSave }) {
  const { t } = useTranslation()
  const [sets, setSets] = useState(() => [EMPTY(), EMPTY()].slice(0, mode === 'best3' ? 2 : 1))
  const update = (i, side, v) => setSets((list) => list.map((s, k) => (k === i ? { ...s, [side]: v.replace(/\D/g, '').slice(0, 2) } : s)))

  // Melhor de 3: o set 3 aparece e desaparece conforme os dois primeiros.
  const shown = mode === 'best3'
    ? (best3NeedsThird(sets) ? [...sets.slice(0, 2), sets[2] || EMPTY()] : sets.slice(0, 2))
    : sets
  if (mode === 'best3' && shown.length !== sets.length) setSets(shown)
  const st = setsState(shown, mode)
  // Sets por acabar valem (Francisco, 28 set): só se avisa de passar de 7-6.
  const ready = st.ready
  const canAdd = mode === 'free' && (!maxSets || shown.length < maxSets)
  const winner = st.winner === 'a' ? pair(teamA) : pair(teamB)

  const cell = 'input-field h-12 w-full text-center text-lg font-extrabold tabular-nums'
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-[52px_1fr_16px_1fr] items-end gap-2 text-center text-xs font-semibold text-muted">
        <span />
        <span className="truncate">{pair(teamA)}</span>
        <span />
        <span className="truncate">{pair(teamB)}</span>
      </div>
      {shown.map((s, i) => (
        <div key={i} className="grid grid-cols-[52px_1fr_16px_1fr] items-center gap-2">
          <span className="text-sm font-extrabold text-ink-900">{t('privatematches.set_label', { number: i + 1 })}</span>
          <input inputMode="numeric" value={s.a} onChange={(e) => update(i, 'a', e.target.value)} className={cell}
            aria-label={t('friends.set_score_aria', { n: i + 1, team: pair(teamA) })} />
          <span className="text-center font-extrabold text-muted">–</span>
          <input inputMode="numeric" value={s.b} onChange={(e) => update(i, 'b', e.target.value)} className={cell}
            aria-label={t('friends.set_score_aria', { n: i + 1, team: pair(teamB) })} />
        </div>
      ))}
      {canAdd && (
        <button type="button" onClick={() => setSets((list) => [...list, EMPTY()])}
          className="press flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-ctrl border border-dashed border-line text-sm font-extrabold text-ink-900">
          <Plus size={16} /> {t('friends.add_set')}
        </button>
      )}
      {st.problem && <p className="text-xs font-extrabold text-danger" role="status">{t(`friends.set_problem_${st.problem}`)}</p>}
      {ready && (
        <p className="rounded-ctrl bg-lime-100 px-3 py-2.5 text-sm text-ink-900">
          {!st.winner ? t('friends.result_draw')
            : st.bySets ? t('friends.winner_line', { team: winner, count: Math.max(st.winsA, st.winsB), a: Math.max(st.winsA, st.winsB), b: Math.min(st.winsA, st.winsB) })
              : t('friends.winner_games_line', { team: winner, a: Math.max(st.gamesA, st.gamesB), b: Math.min(st.gamesA, st.gamesB) })}
        </p>
      )}
      <button type="button" disabled={!ready}
        onClick={() => onSave({ score_a: st.winsA, score_b: st.winsB, sets: st.parsed.map((x) => ({ score_a: x.a, score_b: x.b })) })}
        className="press min-h-[52px] w-full rounded-ctrl bg-ink-900 px-4 text-[15px] font-extrabold text-white disabled:opacity-40">
        {t('friends.result_save')}
      </button>
    </div>
  )
}
