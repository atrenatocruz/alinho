import { useState, useEffect } from 'react'
import { Users, UserPlus, Clock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Avatar, EmptyState } from '../components/ui'
import PadelIcon from '../components/icons/PadelIcon'

export default function Clubes() {
  const { followOrganization, leaveOrganization } = useAuth()
  const [clubs, setClubs] = useState([])
  const [loading, setLoading] = useState(true)
  const [actingOn, setActingOn] = useState(null)

  const loadClubs = async () => {
    const { data, error } = await supabase.rpc('list_global_organizations')
    if (error) {
      console.error('Error loading clubs:', error)
      setLoading(false)
      return
    }
    setClubs(data || [])
    setLoading(false)
  }

  useEffect(() => {
    loadClubs()
  }, [])

  const handleFollow = async (club) => {
    setActingOn(club.id)
    try {
      const { error } = await followOrganization(club.id)
      if (error) throw error
      await loadClubs()
    } catch (error) {
      console.error('Error following club:', error)
      alert('Não foi possível seguir este clube. Tenta novamente.')
    } finally {
      setActingOn(null)
    }
  }

  const handleUnfollow = async (club) => {
    if (!confirm(`Deixar de seguir ${club.name}? Deixas de ver os mixs deste clube.`)) return
    setActingOn(club.id)
    try {
      const { error } = await leaveOrganization(club.id)
      if (error) throw error
      await loadClubs()
    } catch (error) {
      console.error('Error leaving club:', error)
      alert(error.message || 'Não foi possível deixar de seguir este clube.')
    } finally {
      setActingOn(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-3xl text-ink-900">Clubes & Grupos</h2>
        <p className="text-muted text-sm mt-0.5">Segue clubes públicos e vê os mixs deles no teu Home</p>
      </div>

      {clubs.length === 0 ? (
        <EmptyState
          icon={PadelIcon}
          title="Ainda não há clubes públicos"
          subtitle="Assim que um clube decidir ser público, aparece aqui."
        />
      ) : (
        <div className="space-y-3">
          {clubs.map((club) => (
            <div key={club.id} className="card flex items-center gap-3.5">
              <Avatar name={club.name} url={club.group_logo_url} size="w-11 h-11 text-sm" />
              <div className="flex-1 min-w-0">
                <h3 className="font-extrabold text-ink-900 truncate">{club.name}</h3>
                <p className="text-sm text-muted flex items-center gap-1.5">
                  <Users size={13} /> {club.member_count} {club.member_count === 1 ? 'membro' : 'membros'}
                </p>
              </div>

              {club.my_status === 'member' ? (
                <button
                  onClick={() => handleUnfollow(club)}
                  disabled={actingOn === club.id}
                  className="whitespace-nowrap text-xs font-extrabold px-3 py-2 min-h-[44px] rounded-full bg-ink-50 text-ink-700 hover:bg-ink-200 transition-colors duration-fast disabled:opacity-40"
                >
                  A seguir
                </button>
              ) : club.my_status === 'pending' ? (
                <span className="whitespace-nowrap inline-flex items-center gap-1.5 text-xs font-extrabold px-3 py-2 rounded-full bg-ink-50 text-muted">
                  <Clock size={14} /> Pedido enviado
                </span>
              ) : (
                <button
                  onClick={() => handleFollow(club)}
                  disabled={actingOn === club.id}
                  className="whitespace-nowrap inline-flex items-center gap-1.5 text-xs font-extrabold px-3.5 py-2 min-h-[44px] rounded-full bg-lime-400 text-ink-900 hover:bg-lime-600 transition-colors duration-fast disabled:opacity-40"
                >
                  <UserPlus size={14} />
                  {club.open_join ? 'Seguir' : 'Pedir para entrar'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
