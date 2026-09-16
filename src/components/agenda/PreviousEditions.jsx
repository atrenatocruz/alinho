import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, History } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/formatDate'

/* Edições anteriores de um mix recorrente (Homepage unificada, Trello #258).

   Um dos três caminhos para o histórico que substituem a aba "Terminados" da
   Home: dentro do mix, a lista das edições já jogadas; tocar numa abre a
   página do mix terminado, que já existe. Qualquer membro do clube/grupo vê
   a lista — é o que a RLS de games já permite, não se abre nada a mais.

   Carrega só quando se abre: é consulta ocasional, não vale uma query em
   cada visita à página do mix. */
export default function PreviousEditions({ gameId, recurrenceId, userId }) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const [editions, setEditions] = useState(null)
  const [error, setError] = useState(false)

  const load = async () => {
    setError(false)
    try {
      const { data: games, error: gamesError } = await supabase
        .from('games')
        .select('id, date, winner_team_id, participants (user_id, partner_id, status)')
        .eq('recurrence_id', recurrenceId)
        .neq('id', gameId)
        .in('status', ['finished', 'completed'])
        .order('date', { ascending: false })
      if (gamesError) throw gamesError

      const winnerIds = (games || []).map((g) => g.winner_team_id).filter(Boolean)
      let winners = new Map()
      if (winnerIds.length) {
        const { data: teams, error: teamsError } = await supabase
          .from('teams')
          .select('id, player1:profiles!teams_player1_id_fkey (name), player2:profiles!teams_player2_id_fkey (name)')
          .in('id', winnerIds)
        if (teamsError) throw teamsError
        winners = new Map((teams || []).map((tm) => [tm.id, [tm.player1?.name, tm.player2?.name].filter(Boolean).join(` ${t('agenda.and')} `)]))
      }

      setEditions((games || []).map((g) => {
        const confirmed = (g.participants || []).filter((p) => p.status === 'confirmed')
        return {
          id: g.id,
          date: g.date,
          players: confirmed.reduce((n, p) => n + 1 + (p.partner_id ? 1 : 0), 0),
          winners: winners.get(g.winner_team_id) || null,
          played: confirmed.some((p) => p.user_id === userId || p.partner_id === userId),
        }
      }))
    } catch (err) {
      console.error('Error loading previous editions:', err)
      setError(true)
    }
  }

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && editions == null) load()
  }

  return (
    <div className="card">
      <button onClick={toggle} className="w-full flex items-center justify-between gap-3 text-left">
        <h3 className="text-lg text-ink-900 flex items-center gap-2">
          <History size={18} className="text-muted shrink-0" />
          {t('agenda.previous_editions_title')}
        </h3>
        <ChevronDown size={20} className={`text-muted shrink-0 transition-transform duration-base ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-3">
          {error ? (
            <p className="text-sm text-danger">{t('agenda.previous_editions_error')}</p>
          ) : editions == null ? (
            <p className="text-sm text-muted">{t('common.loading')}</p>
          ) : editions.length === 0 ? (
            <p className="text-sm text-muted">{t('agenda.previous_editions_empty')}</p>
          ) : (
            <div className="divide-y divide-line">
              {editions.map((e) => (
                <Link key={e.id} to={`/jogo/${e.id}`} className="flex items-center gap-3 py-3 min-h-[56px]">
                  <div className="flex-1 min-w-0">
                    <p className="font-extrabold text-ink-900 text-sm">
                      {formatDate(e.date, i18n.language, { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                    <p className="text-[12px] text-muted mt-0.5 truncate">
                      {t('agenda.previous_editions_players', { count: e.players })}
                      {e.winners && <> · {t('agenda.previous_editions_winners', { names: e.winners })}</>}
                    </p>
                  </div>
                  {e.played && (
                    <span className="text-[11px] font-extrabold px-2 py-1 rounded-full bg-ok/10 text-ok shrink-0">
                      {t('agenda.previous_editions_played')}
                    </span>
                  )}
                  <ChevronRight size={16} className="text-muted shrink-0" />
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
