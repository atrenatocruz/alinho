// «Ronda N · com que duplas?» (SPEC 2026-10-07-amigos-a-jogar, ponto 6), do
// «⇆ Trocar duplas» da ronda a decorrer: «Até agora: <duplas> contra
// <duplas>.», as duplas que a app propõe e quem descansa. «Usar estas duplas»
// (preto), «⇆ Editar duplas» (a folha de sempre) e «Ainda não», empilhados.
// Muda as duplas desta ronda; as seguintes nascem com elas até nova troca.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeftRight } from 'lucide-react'
import { Sheet } from '../agenda/AgendaControls'
import { setFriendMatchRoundTeams } from '../../lib/privateMatches'
import { shortName } from './friendShare'
import { roundSaveError } from './FriendRoundSheet'

export default function SwapPairsSheet({ match, round, proposal, onEdit, onClose, onSaved }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const names = (team) => (team || []).map((p) => (p.is_anonymous ? t('friends.anon_name') : shortName(p.name))).join(' / ')
  const now = round.courts.map((g) => t('friends.swap_vs', { a: names(g.team_a), b: names(g.team_b) })).join('; ')
  // «Rui C.» já acaba em ponto: não fica «Rui C..».
  const untilNow = t('friends.swap_until_now', { pairs: now })

  const use = async () => {
    setBusy(true); setError('')
    try {
      const ids = (team) => team.map((p) => p.id)
      await setFriendMatchRoundTeams(match.id, round.number, round.courts.map((g, c) => ({
        game_id: g.id, team_a: ids(proposal.courts[c].teamA), team_b: ids(proposal.courts[c].teamB),
      })))
      onSaved()
    } catch (err) {
      console.error('Error swapping friend match pairs:', err)
      setError(roundSaveError(t, err))
    } finally { setBusy(false) }
  }

  const outline = 'press inline-flex min-h-[52px] w-full items-center justify-center gap-1.5 rounded-ctrl border-[1.5px] border-line bg-white px-4 text-[15px] font-extrabold text-ink-900 disabled:opacity-40'
  return (
    <Sheet title={t('friends.swap_title', { n: round.number })} onClose={onClose}>
      <div className="space-y-3">
        <p className="-mt-2 text-xs text-muted">{untilNow.endsWith('..') ? untilNow.slice(0, -1) : untilNow}</p>
        {proposal && proposal.courts.map((c, i) => (
          <div key={i} className="rounded-ctrl border border-line bg-white px-3 py-2.5">
            {proposal.courts.length > 1 && <p className="mb-1 font-mono text-[11px] font-extrabold uppercase tracking-wider text-ink-500">{t('friends.court_n', { n: i + 1 })}</p>}
            <p className="text-sm font-extrabold text-ink-900">{names(c.teamA)}</p>
            <p className="mt-1 text-sm font-extrabold text-ink-900">{names(c.teamB)}</p>
          </div>
        ))}
        {proposal?.resting?.length > 0 && (
          <p className="text-xs text-muted">{t('friends.resting_line_plural', { names: proposal.resting.map((p) => (p.is_anonymous ? t('friends.anon_name') : shortName(p.name))).join(', ') })}</p>
        )}
        {error && <p className="rounded-ctrl border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-extrabold text-danger">{error}</p>}
        <button type="button" disabled={busy || !proposal} onClick={use}
          className="press min-h-[52px] w-full rounded-ctrl bg-ink-900 px-4 text-[15px] font-extrabold text-white disabled:opacity-40">
          {t('friends.swap_use')}
        </button>
        <button type="button" disabled={busy} onClick={onEdit} className={outline}>
          <ArrowLeftRight size={15} /> {t('friends.edit_pairs')}
        </button>
        <button type="button" disabled={busy} onClick={onClose} className={outline}>{t('gamedetails.ask_not_yet')}</button>
      </div>
    </Sheet>
  )
}
