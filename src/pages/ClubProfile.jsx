import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Users, UserPlus, Clock, Heart, MapPin, Phone, Instagram, Globe, Calendar } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { getClubProfile } from '../lib/clubProfile'
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
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

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

      <div className="card flex items-center gap-3.5">
        <Avatar name={club.name} url={club.group_logo_url} size="w-16 h-16 text-xl" />
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl text-ink-900 truncate">{club.name}</h2>
          <p className="text-sm text-muted flex items-center gap-1.5">
            <Users size={13} /> {club.member_count} {club.member_count === 1 ? 'membro' : 'membros'}
          </p>
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

      {club.location && (
        <div className="card">
          <h3 className="text-sm font-extrabold text-ink-900 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <MapPin size={15} /> Localização
          </h3>
          <p className="text-ink-900">{club.location}</p>
        </div>
      )}

      {(club.phone || club.instagram || club.website) && (
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
