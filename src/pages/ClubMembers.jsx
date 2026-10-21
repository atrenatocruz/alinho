// «Ver todos os membros» da página do clube/grupo (Trello #419, assunto 3
// do desenho aprovado a 24 set). Quem organiza primeiro, com «Organiza»;
// depois os outros; cada um com o nível — a banda de sempre (ratingBand),
// que só vem quando a pessoa mostra os resultados a quem está a ver.
// Tocar abre o perfil.
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BackBar } from '../components/ui'
import { ArrowLeft } from 'lucide-react'
import { useGoBack } from '../lib/useGoBack'
import { getClubProfile, listOrganizationMembers } from '../lib/clubProfile'
import { Avatar, EmptyState, RatingBadge } from '../components/ui'
import PadelIcon from '../components/icons/PadelIcon'
import { SkeletonGate, SkCircle, SkLine, SkPill } from '../components/Skeleton'

export default function ClubMembers() {
  const { t } = useTranslation()
  const { slug } = useParams()
  const goBack = useGoBack(`/clube/${slug}`)
  const [club, setClub] = useState(null)
  const [members, setMembers] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setMembers(null); setFailed(false)
    getClubProfile(slug)
      .then(async (data) => {
        if (!alive) return
        if (!data) { setFailed(true); return }
        setClub(data)
        const list = await listOrganizationMembers(data.id)
        if (alive) setMembers(list)
      })
      .catch((err) => { console.error('Error loading club members:', err); if (alive) setFailed(true) })
    return () => { alive = false }
  }, [slug])

  const sorted = (members || []).slice().sort((a, b) => (b.is_admin === true) - (a.is_admin === true))

  return (
    <div className="space-y-4">
      <BackBar onBack={goBack} label={club?.name || t('common.back')} title={t('clubprofile.members_title')} />
      <div>
        <h2 className="text-2xl text-ink-900">{t('clubprofile.members_title')}</h2>
        {club?.member_count != null && <p className="text-sm text-muted">{t('clubprofile.member_count', { count: club.member_count })}</p>}
      </div>

      {failed ? (
        <EmptyState icon={PadelIcon} title={t('clubprofile.not_found_title')} subtitle={t('clubprofile.not_found_subtitle')} />
      ) : !members ? (
        // As linhas a cinzento em vez da roda (esqueletos, 12 out).
        <SkeletonGate>
          <div className="card divide-y divide-line overflow-hidden p-0">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex min-h-[56px] items-center gap-3 px-4 py-2.5">
                <SkCircle size={40} />
                <span className="min-w-0 flex-1"><SkLine size="text" w={`${[58, 46, 64, 40, 52, 48][i]}%`} /></span>
                <SkPill w={34} h={20} />
              </div>
            ))}
          </div>
        </SkeletonGate>
      ) : members.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">{t('clubprofile.no_members_visible')}</p>
      ) : (
        <div className="card divide-y divide-line overflow-hidden p-0">
          {sorted.map((m) => (
            <Link key={m.id} to={`/jogador/${m.id}`} className="flex min-h-[56px] items-center gap-3 px-4 py-2.5 hover:bg-ink-50">
              <Avatar name={m.name} url={m.avatar_url} size="w-10 h-10 text-sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-extrabold text-ink-900">{m.name}</span>
                {m.is_admin && <span className="block text-[12px] font-bold text-muted">{t('clubprofile.organizes')}</span>}
              </span>
              <RatingBadge rating={m.rating} gender={m.gender} />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
