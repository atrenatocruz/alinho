import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Trophy, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { listClubTournaments } from '../lib/tournamentApi'
import { formatDate } from '../lib/formatDate'
import { errorKind } from '../lib/errors'

/* Os torneios de um clube ou grupo, na página dele (Trello #456). Antes a
   página só ia buscar os `games` — os torneios vivem noutra tabela e nunca
   apareciam, nem o Smash Cup na página do Smash Padel Almada.

   Membros leem a vista pública (só publicados, nunca rascunhos). Quem gere
   os torneios do clube vê também os rascunhos, marcados como tal — vêm do
   mesmo RPC que o Gerir usa, que já tem a sua própria guarda. */

const ORDER = { a_decorrer: 0, inscricoes: 1, fechado: 2, sorteado: 3, rascunho: 4, terminado: 5 }

export default function ClubTournamentsList({ organizationId, canManage }) {
  const { t, i18n } = useTranslation()
  const [tournaments, setTournaments] = useState([])

  useEffect(() => {
    let alive = true
    const load = canManage
      ? listClubTournaments(organizationId)
      : supabase.from('tournament_public')
        .select('id, slug, name, starts_on, ends_on, status')
        .eq('organization_id', organizationId)
        .then(({ data, error }) => { if (error) throw error; return data || [] })
    load
      .then((rows) => { if (alive) setTournaments(rows) })
      .catch((error) => {
        if (errorKind(error) !== 'not_ready') console.error('Error loading club tournaments:', error)
        if (alive) setTournaments([])
      })
    return () => { alive = false }
  }, [organizationId, canManage])

  if (tournaments.length === 0) return null

  const day = (iso) => formatDate(new Date(`${iso}T12:00:00`), i18n.language, { day: 'numeric', month: 'short' })
  const when = (tt) => (!tt.starts_on ? ''
    : tt.ends_on && tt.ends_on !== tt.starts_on ? `${day(tt.starts_on)} – ${day(tt.ends_on)}` : day(tt.starts_on))
  const sorted = [...tournaments].sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9)
    || String(a.starts_on).localeCompare(String(b.starts_on)))

  return (
    <div>
      <h3 className="text-lg text-ink-900 mb-3">{t('clubprofile.tournaments_heading')}</h3>
      <div className="space-y-3">
        {sorted.map((tt) => (
          <Link key={tt.id} to={`/torneio/${tt.slug || tt.id}`} className="card press flex items-center gap-3">
            <Trophy size={20} className="text-ink-700 shrink-0" />
            <div className="flex-1 min-w-0">
              <h4 className="font-extrabold text-ink-900 truncate">{tt.name}</h4>
              <p className="text-sm text-muted">
                {[when(tt), t(`tournament.status_${tt.status}`)].filter(Boolean).join(' · ')}
                {tt.status === 'rascunho' && <> · {t('clubprofile.tournament_draft_admin_only')}</>}
              </p>
            </div>
            <ChevronRight size={18} className="text-muted shrink-0" />
          </Link>
        ))}
      </div>
    </div>
  )
}
