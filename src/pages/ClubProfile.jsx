import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Users, UserPlus, Clock, Heart, MapPin, Phone, Instagram, Globe, Calendar, Building2 } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { getClubProfile, listOrganizationMembers } from '../lib/clubProfile'
import { listClubGroups } from '../lib/organizations'
import { Avatar, EmptyState, PrimaryButton } from '../components/ui'
import PadelIcon from '../components/icons/PadelIcon'

const asWebsiteUrl = (value) => (/^https?:\/\//i.test(value) ? value : `https://${value}`)
const asInstagramUrl = (value) => {
  if (/^https?:\/\//i.test(value)) return value
  return `https://instagram.com/${value.trim().replace(/^@/, '')}`
}

export default function ClubProfile() {
  const { slug } = useParams()
  const { memberships, followOrganization, leaveOrganization, toggleFavoriteOrganization } = useAuth()
  const [club, setClub] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [acting, setActing] = useState(false)
  const [favoriting, setFavoriting] = useState(false)
  const [groups, setGroups] = useState([])
  const [groupActingOn, setGroupActingOn] = useState(null)
  const [members, setMembers] = useState([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [showMembers, setShowMembers] = useState(false)
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
      if (!data) {
        setNotFound(true)
      } else {
        setClub(data)
      }
    } catch (error) {
      if (requestId !== requestIdRef.current) return
      console.error('Error loading club profile:', error)
      setNotFound(true)
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    setNotFound(false)
    setShowMembers(false)
    setMembers([])
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  // Loaded on demand (mirrors the "Confrontos diretos" expand pattern) —
  // previously there was no way to see who the club's members were from
  // this public page at all, only from the admin "Gerir" panel.
  const handleToggleMembers = async () => {
    if (showMembers) {
      setShowMembers(false)
      return
    }
    setShowMembers(true)
    if (members.length > 0) return
    setMembersLoading(true)
    try {
      const data = await listOrganizationMembers(club.id)
      setMembers(data)
    } catch (error) {
      console.error('Error loading club members:', error)
    } finally {
      setMembersLoading(false)
    }
  }

  // Only a club member can see its groups (list_club_groups' own gate is
  // club membership) — no point calling it otherwise, it would just return
  // zero rows. This is the reachable, member-facing counterpart to the
  // admin-only groups panel in GerirClube.jsx.
  useEffect(() => {
    if (club?.kind === 'club' && club.my_status === 'member') {
      listClubGroups(club.id)
        .then(setGroups)
        .catch((error) => console.error('Error loading club groups:', error))
    } else {
      setGroups([])
    }
  }, [club?.id, club?.kind, club?.my_status])

  const handleRequestJoinGroup = async (group) => {
    setGroupActingOn(group.id)
    try {
      const { error } = await followOrganization(group.id)
      if (error) throw error
      const data = await listClubGroups(club.id)
      setGroups(data)
    } catch (error) {
      console.error('Error requesting to join group:', error)
      alert(error.message || 'Não foi possível pedir para entrar. Tenta novamente.')
    } finally {
      setGroupActingOn(null)
    }
  }

  const handleFollow = async () => {
    setActing(true)
    try {
      const { error } = await followOrganization(club.id)
      if (error) throw error
      await load()
    } catch (error) {
      console.error('Error following club:', error)
      alert('Não foi possível seguir este clube. Tenta novamente.')
    } finally {
      setActing(false)
    }
  }

  const handleUnfollow = async () => {
    if (!confirm(`Deixar de seguir ${club.name}? Deixas de ver os mixs deste clube.`)) return
    setActing(true)
    try {
      const { error } = await leaveOrganization(club.id)
      if (error) throw error
      await load()
    } catch (error) {
      console.error('Error leaving club:', error)
      alert(error.message || 'Não foi possível deixar de seguir este clube.')
    } finally {
      setActing(false)
    }
  }

  const isFavorite = club ? memberships.find((m) => m.organization_id === club.id)?.is_favorite === true : false

  const handleToggleFavorite = async () => {
    setFavoriting(true)
    try {
      const { error } = await toggleFavoriteOrganization(club.id, !isFavorite)
      if (error) throw error
    } catch (error) {
      console.error('Error toggling favorite club:', error)
      alert('Não foi possível atualizar o favorito. Tenta novamente.')
    } finally {
      setFavoriting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
      </div>
    )
  }

  if (notFound || !club) {
    return (
      <div className="space-y-5">
        <Link to="/comunidade" className="inline-flex items-center gap-1.5 text-ink-700 font-extrabold text-sm hover:underline">
          <ArrowLeft size={16} /> Voltar à Comunidade
        </Link>
        <EmptyState
          icon={PadelIcon}
          title="Clube não encontrado"
          subtitle="Este clube não existe ou não é público."
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <Link to="/comunidade" className="inline-flex items-center gap-1.5 text-ink-700 font-extrabold text-sm hover:underline">
        <ArrowLeft size={16} /> Voltar à Comunidade
      </Link>

      {club.kind === 'group' && club.parent_slug && (
        <Link
          to={`/clube/${club.parent_slug}`}
          className="inline-flex items-center gap-1.5 text-sm font-extrabold text-lime-700 hover:underline"
        >
          <Building2 size={14} /> Grupo dentro de {club.parent_name}
        </Link>
      )}

      <div className="card flex items-center gap-3.5">
        <Avatar name={club.name} url={club.group_logo_url} size="w-16 h-16 text-xl" />
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl text-ink-900 truncate">{club.name}</h2>
          {club.member_count > 0 ? (
            <button
              type="button"
              onClick={handleToggleMembers}
              className="text-sm text-muted flex items-center gap-1.5 hover:underline"
            >
              <Users size={13} /> {club.member_count} {club.member_count === 1 ? 'membro' : 'membros'}
            </button>
          ) : (
            <p className="text-sm text-muted flex items-center gap-1.5">
              <Users size={13} /> {club.member_count} membros
            </p>
          )}
        </div>

        {club.my_status === 'member' ? (
          <button
            onClick={handleToggleFavorite}
            disabled={favoriting}
            aria-label={isFavorite ? 'Remover dos favoritos' : 'Marcar como favorito'}
            title={isFavorite ? 'Remover dos favoritos' : 'Marcar como favorito — os mixs deste clube aparecem primeiro em Próximos jogos'}
            className="shrink-0 w-11 h-11 min-h-[44px] rounded-full flex items-center justify-center transition-colors duration-fast disabled:opacity-40 hover:bg-ink-50"
          >
            <Heart size={20} className={isFavorite ? 'fill-lime-400 text-lime-400' : 'text-ink-200'} />
          </button>
        ) : club.my_status === 'pending' ? (
          <span className="whitespace-nowrap inline-flex items-center gap-1.5 text-xs font-extrabold px-3 py-2 rounded-full bg-ink-50 text-muted">
            <Clock size={14} /> Pedido enviado
          </span>
        ) : (
          <PrimaryButton onClick={handleFollow} disabled={acting} className="shrink-0">
            <UserPlus size={16} />
            {club.open_join ? 'Seguir' : 'Pedir para entrar'}
          </PrimaryButton>
        )}
      </div>

      {showMembers && (
        <div className="card p-0 overflow-hidden animate-fade-up">
          {membersLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-[3px] border-ink-50 border-t-ink-700"></div>
            </div>
          ) : members.length === 0 ? (
            <p className="text-muted text-sm text-center py-6">Sem membros visíveis.</p>
          ) : (
            <div className="divide-y divide-line">
              {members.map((m) => (
                <Link
                  key={m.id}
                  to={`/jogador/${m.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors duration-fast hover:bg-ink-50"
                >
                  <Avatar name={m.name} url={m.avatar_url} size="w-9 h-9 text-sm" />
                  <p className="flex-1 min-w-0 font-extrabold text-ink-900 text-sm truncate">{m.name}</p>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {club.my_status === 'member' && (
        <button
          onClick={handleUnfollow}
          disabled={acting}
          className="text-danger text-sm font-extrabold hover:underline disabled:opacity-40"
        >
          Deixar de seguir
        </button>
      )}

      {club.description && (
        <div className="card">
          <h3 className="text-sm font-extrabold text-ink-900 uppercase tracking-wide mb-2">Sobre</h3>
          <p className="text-ink-900 whitespace-pre-line">{club.description}</p>
        </div>
      )}

      {club.kind === 'club' && club.location && (
        <div className="card">
          <h3 className="text-sm font-extrabold text-ink-900 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <MapPin size={15} /> Localização
          </h3>
          <p className="text-ink-900">{club.location}</p>
        </div>
      )}

      {club.kind === 'club' && (club.phone || club.instagram || club.website) && (
        <div className="card space-y-2">
          <h3 className="text-sm font-extrabold text-ink-900 uppercase tracking-wide mb-2">Contactos</h3>
          {club.phone && (
            <a href={`tel:${club.phone}`} className="flex items-center gap-2 text-ink-900 hover:underline">
              <Phone size={15} className="shrink-0" /> {club.phone}
            </a>
          )}
          {club.instagram && (
            <a href={asInstagramUrl(club.instagram)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-ink-900 hover:underline">
              <Instagram size={15} className="shrink-0" /> {club.instagram}
            </a>
          )}
          {club.website && (
            <a href={asWebsiteUrl(club.website)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-ink-900 hover:underline">
              <Globe size={15} className="shrink-0" /> {club.website}
            </a>
          )}
        </div>
      )}

      {groups.length > 0 && (
        <div>
          <h3 className="text-lg text-ink-900 mb-3">Grupos</h3>
          <div className="space-y-3">
            {groups.map((group) => {
              const isMemberish = group.can_manage || group.my_status === 'member' || group.my_status === 'admin'
              return (
                <div key={group.id} className="card flex items-center gap-3.5">
                  <Avatar name={group.name} url={group.group_logo_url} size="w-11 h-11 text-sm" />
                  <div className="flex-1 min-w-0">
                    <h4 className="font-extrabold text-ink-900 truncate">{group.name}</h4>
                    {isMemberish ? (
                      <p className="text-sm text-muted">
                        {group.member_count} {group.member_count === 1 ? 'membro' : 'membros'}
                      </p>
                    ) : (
                      <p className="text-sm text-muted">
                        {group.my_status === 'pending' ? 'Pedido enviado' : 'Grupo dentro deste clube'}
                      </p>
                    )}
                  </div>
                  {isMemberish ? (
                    <Link
                      to={`/clube/${group.slug}`}
                      className="shrink-0 whitespace-nowrap text-xs font-extrabold px-3.5 py-2 min-h-[44px] rounded-full bg-ink-50 text-ink-700 hover:bg-ink-200 transition-colors duration-fast inline-flex items-center"
                    >
                      Ver grupo
                    </Link>
                  ) : group.my_status === 'pending' ? (
                    <span className="shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 text-xs font-extrabold px-3 py-2 rounded-full bg-ink-50 text-muted">
                      <Clock size={14} /> Pedido enviado
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleRequestJoinGroup(group)}
                      disabled={groupActingOn === group.id}
                      className="shrink-0 whitespace-nowrap text-xs font-extrabold px-3.5 py-2 min-h-[44px] rounded-full bg-lime-400 text-ink-900 hover:bg-lime-600 transition-colors duration-fast disabled:opacity-40"
                    >
                      Pedir para entrar
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-lg text-ink-900 mb-3">Mixs em aberto</h3>
        {club.open_games.length === 0 ? (
          <EmptyState
            icon={Calendar}
            title="Sem mixs em aberto"
            subtitle="Este clube não tem mixs agendados neste momento."
          />
        ) : (
          <div className="space-y-3">
            {club.open_games.map((game) => (
              <div key={game.id} className="card">
                <h4 className="font-extrabold text-ink-900">{game.title}</h4>
                <p className="text-sm text-muted">
                  {new Date(game.date).toLocaleString('pt-PT', { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' })}
                </p>
                {game.location && (
                  <p className="flex items-center gap-1.5 text-sm text-muted mt-1">
                    <MapPin size={13} className="shrink-0" /> {game.location}
                  </p>
                )}
                <p className="flex items-center gap-1.5 text-sm text-muted mt-1">
                  <Users size={13} /> {game.confirmed_count}/{game.max_players} jogadores
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
