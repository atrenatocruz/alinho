// A página do clube e do grupo (Trello #419; desenho aprovado pelo
// Francisco a 24 set, assunto a assunto — design-handoff/2026-09-23-
// pagina-do-grupo/SPEC.md). Uma página que se desce, a mesma para clube e
// grupo, sem separadores:
//   cabeçalho · o que vem aí · pessoas · (grupos do clube) ·
//   jogos entre membros · sobre
// As secções vivem em components/club/ClubSections.jsx.
import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useGoBack } from '../lib/useGoBack'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Building2, ChevronRight } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { getClubProfile, listOrganizationMembers } from '../lib/clubProfile'
import { listClubGroups } from '../lib/organizations'
import { listClubTournaments } from '../lib/tournamentApi'
import { followPlayer, removeFollow } from '../lib/follows'
import { Avatar, EmptyState } from '../components/ui'
import PadelIcon from '../components/icons/PadelIcon'
import { describeError, errorKind } from '../lib/errors'
import { listClubTeachers } from '../lib/lessonsApi'
import { ClubHeader, ClubEvents, ClubPeople, ClubAbout, buildClubEvents } from '../components/club/ClubSections'

export default function ClubProfile() {
  const { t } = useTranslation()
  const { slug } = useParams()
  const goBack = useGoBack('/comunidade')
  const { user, memberships, followOrganization, leaveOrganization, toggleFavoriteOrganization } = useAuth()
  const [club, setClub] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [acting, setActing] = useState(false)
  const [favoriting, setFavoriting] = useState(false)
  const [error, setError] = useState('')
  const [groups, setGroups] = useState([])
  const [members, setMembers] = useState([])
  const [teachers, setTeachers] = useState([])
  const [tournaments, setTournaments] = useState([])
  const [follows, setFollows] = useState({})
  const [followActing, setFollowActing] = useState(null)
  // Guards against an in-flight request for a stale slug (or a stale
  // handleFollow/handleUnfollow reload) resolving after a newer one and
  // clobbering state — each load() call captures its own generation and
  // only applies its result if it's still the latest.
  const requestIdRef = useRef(0)

  const load = async () => {
    const requestId = ++requestIdRef.current
    try {
      const data = await getClubProfile(slug)
      if (requestId !== requestIdRef.current) return
      if (!data) setNotFound(true)
      else setClub(data)
    } catch (err) {
      if (requestId !== requestIdRef.current) return
      console.error('Error loading club profile:', err)
      setNotFound(true)
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    setNotFound(false)
    setMembers([])
    setError('')
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  const isAdmin = !!club && memberships.some((m) => m.organization_id === club.id && m.is_admin)
  const isFavorite = club ? memberships.find((m) => m.organization_id === club.id)?.is_favorite === true : false

  // Pessoas: a lista de membros vem logo (antes só abria ao tocar no
  // número). `is_admin` dá «Quem organiza»; sem a migração do Dev 3 não vem
  // e a secção simplesmente não aparece.
  useEffect(() => {
    if (!club?.id || !club.member_count) { setMembers([]); return }
    listOrganizationMembers(club.id)
      .then(setMembers)
      .catch((err) => { console.error('Error loading club members:', err); setMembers([]) })
  }, [club?.id, club?.member_count, club?.my_status])

  // Only a club member can see its groups (list_club_groups' own gate is
  // club membership) — no point calling it otherwise.
  useEffect(() => {
    if (club?.kind === 'club' && club.my_status === 'member') {
      listClubGroups(club.id).then(setGroups).catch((err) => console.error('Error loading club groups:', err))
    } else {
      setGroups([])
    }
  }, [club?.id, club?.kind, club?.my_status])

  // Professores só como pessoas (seguir), sem aulas: as aulas estão
  // escondidas até 11 out, mas quem ensina no clube vê-se.
  useEffect(() => {
    if (club?.kind !== 'club') { setTeachers([]); return }
    listClubTeachers(club.id)
      .then(setTeachers)
      .catch((err) => {
        if (errorKind(err) !== 'not_ready') console.error('Error loading club teachers:', err)
        setTeachers([])
      })
  }, [club?.id, club?.kind])

  // Os meus «seguir», para cada professor dizer o estado certo.
  useEffect(() => {
    if (!user?.id || teachers.length === 0) return
    supabase.from('follows').select('id, followed_id, status').eq('follower_id', user.id)
      .then(({ data, error: err }) => {
        if (err) { console.error('Error loading follows:', err); return }
        setFollows(Object.fromEntries((data || []).map((f) => [f.followed_id, f])))
      })
  }, [user?.id, teachers.length])

  // Torneios do clube (Trello #456): a vista pública (só publicados); quem
  // gere vê também os rascunhos, pelo mesmo RPC do Gerir.
  useEffect(() => {
    if (!club?.id) { setTournaments([]); return undefined }
    let alive = true
    const q = isAdmin
      ? listClubTournaments(club.id)
      : supabase.from('tournament_public').select('id, slug, name, starts_on, ends_on, status')
        .eq('organization_id', club.id)
        .then(({ data, error: err }) => { if (err) throw err; return data || [] })
    q.then((rows) => { if (alive) setTournaments(rows) })
      .catch((err) => {
        if (errorKind(err) !== 'not_ready') console.error('Error loading club tournaments:', err)
        if (alive) setTournaments([])
      })
    return () => { alive = false }
  }, [club?.id, isAdmin])

  const kk = (key) => (club?.kind === 'group' ? `${key}_group` : key)

  const handleFollow = async () => {
    setActing(true); setError('')
    try {
      const { error: err } = await followOrganization(club.id)
      if (err) throw err
      await load()
    } catch (err) {
      console.error('Error following club:', err)
      setError(describeError(t, err, kk('clubprofile.error_follow')))
    } finally {
      setActing(false)
    }
  }

  // Chamado pela pergunta (ConfirmSheet): se falhar, o erro fica lá.
  const handleUnfollow = async () => {
    const { error: err } = await leaveOrganization(club.id)
    if (err) throw err
    await load()
  }

  const handleToggleFavorite = async () => {
    setFavoriting(true); setError('')
    try {
      const { error: err } = await toggleFavoriteOrganization(club.id, !isFavorite)
      if (err) throw err
    } catch (err) {
      console.error('Error toggling favorite club:', err)
      setError(describeError(t, err, 'clubprofile.error_toggle_favorite'))
    } finally {
      setFavoriting(false)
    }
  }

  const refreshFollow = async (userId) => {
    const { data } = await supabase.from('follows').select('id, followed_id, status')
      .eq('follower_id', user.id).eq('followed_id', userId)
    setFollows((m) => ({ ...m, [userId]: data?.[0] || null }))
  }
  const handleFollowTeacher = async (teacher) => {
    setFollowActing(teacher.user_id); setError('')
    try {
      await followPlayer(teacher.user_id)
      await refreshFollow(teacher.user_id)
    } catch (err) {
      console.error('Error following teacher:', err)
      setError(describeError(t, err))
    } finally {
      setFollowActing(null)
    }
  }
  const handleUnfollowTeacher = async (teacher) => {
    const follow = follows[teacher.user_id]
    if (!follow?.id) return
    setFollowActing(teacher.user_id); setError('')
    try {
      await removeFollow(follow.id)
      await refreshFollow(teacher.user_id)
    } catch (err) {
      console.error('Error unfollowing teacher:', err)
      setError(describeError(t, err))
    } finally {
      setFollowActing(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
      </div>
    )
  }

  const back = (
    <button type="button" onClick={goBack} className="inline-flex min-h-[44px] items-center gap-1.5 text-ink-700 font-extrabold text-sm hover:underline">
      <ArrowLeft size={16} /> {t('common.back')}
    </button>
  )

  if (notFound || !club) {
    return (
      <div className="space-y-5">
        {back}
        <EmptyState icon={PadelIcon} title={t('clubprofile.not_found_title')} subtitle={t('clubprofile.not_found_subtitle')} />
      </div>
    )
  }

  const gerirHref = `/gerir/${club.slug}`
  const events = buildClubEvents(club, tournaments)

  return (
    <div className="space-y-5">
      <div>
        {back}
        {club.kind === 'group' && club.parent_slug && (
          <Link to={`/clube/${club.parent_slug}`}
            className="flex min-h-[44px] items-center gap-1.5 text-sm font-extrabold text-ink-900 hover:underline">
            <Building2 size={14} /> {t('clubprofile.group_within', { name: club.parent_name })} <ChevronRight size={14} />
          </Link>
        )}
      </div>

      <ClubHeader
        club={club}
        isFavorite={isFavorite}
        acting={acting}
        favoriting={favoriting}
        onFollow={handleFollow}
        onUnfollow={handleUnfollow}
        onToggleFavorite={handleToggleFavorite}
      />
      {error && <p role="alert" className="rounded-ctrl bg-danger/10 px-4 py-3 text-sm font-extrabold text-danger">{error}</p>}

      <ClubEvents club={club} events={events} isAdmin={isAdmin} gerirHref={gerirHref} />

      <ClubPeople
        club={club}
        members={members}
        teachers={teachers}
        follows={follows}
        followActing={followActing}
        onFollowTeacher={handleFollowTeacher}
        onUnfollowTeacher={handleUnfollowTeacher}
      />

      {groups.length > 0 && (
        <section>
          <h3 className="mb-2 text-[11px] font-extrabold uppercase tracking-widest text-muted">{t('clubprofile.club_groups')}</h3>
          <div className="space-y-2.5">
            {groups.map((group) => {
              const isMemberish = group.can_manage || group.my_status === 'member' || group.my_status === 'admin'
              return (
                <div key={group.id} className="card flex items-center gap-3.5">
                  <Avatar name={group.name} url={group.group_logo_url} size="w-11 h-11 text-sm" />
                  <div className="min-w-0 flex-1">
                    <h4 className="truncate font-extrabold text-ink-900">{group.name}</h4>
                    <p className="text-sm text-muted">
                      {isMemberish
                        ? t('clubprofile.member_count', { count: group.member_count })
                        : group.my_status === 'pending' ? t('clubprofile.request_sent') : t('clubprofile.group_within_club')}
                    </p>
                  </div>
                  {/* «Ver ›» em todas (SPEC de 24 set, §4): pedir para entrar
                      faz-se na página do grupo, onde o botão lima é o único
                      do ecrã — não um lima por cada linha aqui. */}
                  <Link to={`/clube/${group.slug}`}
                    className="inline-flex min-h-[44px] shrink-0 items-center gap-0.5 whitespace-nowrap text-sm font-extrabold text-ink-900">
                    {t('clubprofile.view')} <ChevronRight size={15} />
                  </Link>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Jogo dentro do grupo/clube (Trello #239) — qualquer membro pode
          criar/ver. O nome da secção espera o Renato: usa-se o que existe. */}
      {club.my_status === 'member' && (
        <section>
          <h3 className="mb-2 text-[11px] font-extrabold uppercase tracking-widest text-muted">
            {t(club.kind === 'group' ? 'clubprofile.of_group' : 'clubprofile.of_club')}
          </h3>
          <Link to={`/clube/${slug}/jogos`} className="card press flex min-h-[52px] items-center justify-between gap-3">
            <span className="font-extrabold text-ink-900">{t(club.kind === 'group' ? 'clubprofile.jogos_heading_group' : 'clubprofile.jogos_heading')}</span>
            <ChevronRight size={17} className="shrink-0 text-ink-700" />
          </Link>
        </section>
      )}

      <ClubAbout club={club} isAdmin={isAdmin} gerirHref={gerirHref} />
    </div>
  )
}
