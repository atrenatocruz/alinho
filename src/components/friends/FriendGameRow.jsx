// Um jogo entre amigos na lista «Jogos entre amigos» (Francisco, 28 set):
// - o cartão (REGRAS.md ponto 1): só as duplas — ou «A rodar · N pessoas» —,
//   quantos jogos, quanto ficou cada um, e o dia, a hora e o sítio. Tocar
//   abre o jogo.
// - o «⋯», só para quem criou (2026-09-28-amigos-apagar-da-lista): por jogar,
//   a folha de dentro do jogo com «Cancelar o jogo»; já jogado sem ter contado,
//   «Apagar este jogo?»; já contou para o ranking, o único cadeado.
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { MoreHorizontal, Pencil, Share2, Lock } from 'lucide-react'
import { ConfirmSheet } from '../ui'
import { Sheet } from '../agenda/AgendaControls'
import { describeError } from '../../lib/errors'
import { deleteFriendMatch } from '../../lib/friendMatchDelete'
import { shareWithMissing, sessionLink } from './friendShare'
import { dayText } from './dayText'

/* `facts`: friendGameFacts (lib/friendGames), ou, num jogo ainda sem
   equipas, { date, time, location, isCreator, hasResults: false }.
   `line`: a frase de estado quando não há resultados («Faltam 2 pessoas
   por responder.»). `to`: onde abre (null num jogo solto antigo). */
export default function FriendGameRow({ id, facts, line = null, pending = 0, creatorName = '', to = null, onChanged }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [menu, setMenu] = useState(null) // 'actions' | 'cancel' | 'delete' | 'locked'
  const when = [facts.date ? dayText(facts.date, i18n.language) : null, facts.time].filter(Boolean).join(' · ')

  // As duplas quando são fixas, «A rodar · N pessoas» quando rodaram; antes
  // de haver equipas, quantas pessoas vão.
  const title = facts.pairs
    || (facts.rotatingPeople ? t('friends.card_rotating', { count: facts.rotatingPeople })
      : facts.people ? t('friends.people_count', { count: facts.people }) : when)
  // A decorrer: em que ronda vai. Acabado: se contou ou não.
  const status = !facts.hasResults ? line
    : !facts.finished && facts.gamesCount > facts.results.length ? t('agenda.session_round', { n: facts.results.length + 1, total: facts.gamesCount })
      : facts.counted ? t('friends.card_counted')
        : !facts.ranked ? t('friends.card_friendly')
          : facts.finished ? t('friends.card_not_counted') : t('friends.card_waiting')
  // Cada jogo pelos seus sets, separados por « | » (UX, 28 set): os 3
  // primeiros e «+N» se houver mais.
  const all = facts.results || []
  const resultsText = all.slice(0, 3).join(' | ') + (all.length > 3 ? ` | +${all.length - 3}` : '')
  const results = facts.hasResults
    ? [facts.gamesCount > 1 ? t('friends.card_games', { count: facts.gamesCount }) : null, resultsText].filter(Boolean).join(' · ')
    : null
  const place = [title === when ? null : when, facts.location].filter(Boolean).join(' · ')

  const openMenu = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu(facts.counted ? 'locked' : facts.hasResults ? 'delete' : 'actions')
  }
  const errorOf = (err) => (String(err?.message || '').includes('has_counted') ? t('friends.delete_locked') : describeError(t, err))
  const remove = async () => { await deleteFriendMatch(id); onChanged?.() }
  const sheetTitle = `${t('friends.actions_title')} · ${facts.hasResults ? resultsText : (facts.date ? dayText(facts.date, i18n.language).toLocaleLowerCase(i18n.language) : '')}`
  const row = 'press flex min-h-[52px] w-full items-center gap-2 bg-white px-4 text-left text-[15px] font-extrabold text-ink-900'

  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-extrabold leading-snug text-ink-900">{title}</span>
        {results && <span className="mt-0.5 block text-xs tabular-nums text-ink-700">{results}</span>}
        {status && <span className="mt-0.5 block text-xs text-muted">{status}</span>}
        {place && <span className="mt-0.5 block text-xs text-muted">{place}</span>}
      </span>
      {facts.isCreator && (
        <button type="button" onClick={openMenu} aria-label={t('friends.more')} aria-haspopup="dialog"
          className="press relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-white text-ink-900">
          <MoreHorizontal size={16} />
        </button>
      )}
    </>
  )

  return (
    <>
      {to
        ? <Link to={to} className="card press flex items-start gap-3">{body}</Link>
        : <div className="card flex items-start gap-3">{body}</div>}

      {menu === 'actions' && (
        <Sheet title={sheetTitle} onClose={() => setMenu(null)}>
          <div className="divide-y divide-line overflow-hidden rounded-card border border-line">
            <Link to={`/jogos-privados/sessao/${id}/editar`} className={row}><Pencil size={16} /> {t('friends.edit_game')}</Link>
            {pending > 0 && (
              <button type="button" className={row} onClick={() => { setMenu(null); shareWithMissing(t('friends.share_text', {
                name: creatorName, day: facts.date ? dayText(facts.date, i18n.language) : '', link: sessionLink(id) })) }}>
                <Share2 size={16} /> {t('friends.share_missing')}
              </button>
            )}
            <button type="button" onClick={() => setMenu('cancel')} className="press block min-h-[52px] w-full bg-white px-4 py-2.5 text-left">
              <span className="block text-[15px] font-extrabold text-danger">{t('friends.cancel_game')}</span>
              <span className="block text-xs text-muted">{t('friends.cancel_game_hint')}</span>
            </button>
          </div>
        </Sheet>
      )}
      {menu === 'locked' && (
        <Sheet title={sheetTitle} onClose={() => setMenu(null)}>
          <div className="space-y-3">
            <button type="button" className={`${row} rounded-card border border-line`} onClick={() => { setMenu(null); if (to) navigate(to) }}>
              {t('friends.see_game')}
            </button>
            <p className="flex gap-2 rounded-card bg-ink-50 p-3 text-xs text-ink-700">
              <Lock size={14} className="mt-0.5 shrink-0" /> {t('friends.delete_locked')}
            </p>
          </div>
        </Sheet>
      )}
      <ConfirmSheet
        open={menu === 'cancel'}
        danger
        title={t('friends.cancel_title')}
        message={t('friends.cancel_message')}
        confirmLabel={t('friends.cancel_confirm')}
        cancelLabel={t('friends.cancel_keep')}
        onConfirm={remove}
        onClose={() => setMenu(null)}
        errorOf={errorOf}
      />
      <ConfirmSheet
        open={menu === 'delete'}
        danger
        title={t('friends.delete_title')}
        message={[
          [title, resultsText].filter(Boolean).join(' · ') + '.',
          facts.ranked ? t('friends.delete_not_counted') : t('friends.delete_friendly'),
          t('friends.delete_leaves'),
        ].join(' ')}
        confirmLabel={t('friends.delete_confirm')}
        cancelLabel={t('friends.cancel_keep')}
        onConfirm={remove}
        onClose={() => setMenu(null)}
        errorOf={errorOf}
      />
    </>
  )
}
