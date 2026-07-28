import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { User, Award, Trophy, Target, Flame, LogOut, Camera } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { hashPhone } from '../lib/hashPhone'
import { uploadAvatar, removeAvatar } from '../lib/avatarStorage'
import { PrimaryButton, LevelBadge, GuestBadge, DateField, Avatar, Select, EmptyState } from '../components/ui'

export default function Profile() {
  const { profile, updateProfile, updateMembership, currentMembership, currentOrganizationId, isGuest, signOut } = useAuth()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(profile?.name || '')
  const [level, setLevel] = useState(currentMembership?.level || 'iniciante')
  const [preferredSide, setPreferredSide] = useState(profile?.preferred_side || 'both')
  const [birthday, setBirthday] = useState(profile?.birthday || '')
  const [gender, setGender] = useState(profile?.gender || '')
  const [phone, setPhone] = useState('')
  const [phoneError, setPhoneError] = useState('')
  const [stats, setStats] = useState(null)
  const [mixHistory, setMixHistory] = useState([])
  const [mixHistoryLoading, setMixHistoryLoading] = useState(true)
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (profile) {
      setName(profile.name)
      setLevel(currentMembership?.level || 'iniciante')
      setPreferredSide(profile.preferred_side || 'both')
      setBirthday(profile.birthday || '')
      setGender(profile.gender || '')
      if (!isGuest && currentOrganizationId) {
        loadStats()
        loadMixHistory()
      }
    }
  }, [profile, currentMembership, currentOrganizationId])

  const loadStats = async () => {
    try {
      const { data, error } = await supabase
        .from('player_stats')
        .select('*')
        .eq('user_id', profile.id)
        .eq('organization_id', currentOrganizationId)
        .single()

      if (error && error.code !== 'PGRST116') throw error
      setStats(data)
    } catch (error) {
      console.error('Error loading stats:', error)
    }
  }

  // Placement per mix isn't stored anywhere — mix_player_stats only has
  // points_earned/mix_won — so it's derived the same way GameDetails.jsx's
  // results share card does: group teams by combined points_earned and
  // rank descending, then find where this player's dupla landed.
  const loadMixHistory = async () => {
    setMixHistoryLoading(true)
    try {
      const { data: statsRows, error: statsError } = await supabase
        .from('mix_player_stats')
        .select('game_id, game:games (id, title, date, location)')
        .eq('user_id', profile.id)
        .eq('organization_id', currentOrganizationId)
      if (statsError) throw statsError

      const gameIds = (statsRows || []).map((r) => r.game_id)
      if (gameIds.length === 0) {
        setMixHistory([])
        return
      }

      const [{ data: teamsData, error: teamsError }, { data: allStatsData, error: allStatsError }] = await Promise.all([
        supabase.from('teams').select('id, game_id, player1_id, player2_id').in('game_id', gameIds),
        supabase.from('mix_player_stats').select('game_id, user_id, points_earned').in('game_id', gameIds),
      ])
      if (teamsError) throw teamsError
      if (allStatsError) throw allStatsError

      const pointsByGameUser = new Map(
        (allStatsData || []).map((s) => [`${s.game_id}:${s.user_id}`, s.points_earned || 0])
      )
      const teamsByGame = new Map()
      ;(teamsData || []).forEach((t) => {
        if (!teamsByGame.has(t.game_id)) teamsByGame.set(t.game_id, [])
        teamsByGame.get(t.game_id).push(t)
      })

      const history = (statsRows || [])
        .filter((row) => row.game)
        .map((row) => {
          const teams = teamsByGame.get(row.game_id) || []
          const ranked = teams
            .map((t) => ({
              isMine: t.player1_id === profile.id || t.player2_id === profile.id,
              points: (pointsByGameUser.get(`${row.game_id}:${t.player1_id}`) || 0) +
                      (pointsByGameUser.get(`${row.game_id}:${t.player2_id}`) || 0),
            }))
            .sort((a, b) => b.points - a.points)
          const position = ranked.findIndex((t) => t.isMine) + 1
          return {
            gameId: row.game_id,
            title: row.game.title,
            date: row.game.date,
            location: row.game.location,
            position: position || null,
            totalDuplas: teams.length,
          }
        })
        .sort((a, b) => new Date(b.date) - new Date(a.date))

      setMixHistory(history)
    } catch (error) {
      console.error('Error loading mix history:', error)
    } finally {
      setMixHistoryLoading(false)
    }
  }

  const handlePhotoSelect = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file) return
    setPhotoError('')
    setUploadingPhoto(true)
    try {
      const avatar_url = await uploadAvatar(profile.id, file)
      const { error } = await updateProfile({ avatar_url })
      if (error) throw error
    } catch (error) {
      console.error('Error uploading photo:', error)
      setPhotoError('Não foi possível carregar a foto. Tenta novamente.')
    } finally {
      setUploadingPhoto(false)
    }
  }

  const handleRemovePhoto = async () => {
    setPhotoError('')
    setUploadingPhoto(true)
    try {
      await removeAvatar(profile.id)
      const { error } = await updateProfile({ avatar_url: null })
      if (error) throw error
    } catch (error) {
      console.error('Error removing photo:', error)
      setPhotoError('Não foi possível remover a foto. Tenta novamente.')
    } finally {
      setUploadingPhoto(false)
    }
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setPhoneError('')

    // Phone is optional — only validate/hash it if the person typed one in.
    if (phone && phone.replace(/\D/g, '').length < 9) {
      setPhoneError('Introduz um número de telemóvel válido, ou deixa em branco')
      return
    }

    setLoading(true)

    try {
      const updates = { name, preferred_side: preferredSide, birthday: birthday || null, gender }
      if (phone) {
        updates.phone_hash = await hashPhone(phone)
      }
      const { error: profileError } = await updateProfile(updates)
      if (profileError) throw profileError
      const { error: membershipError } = await updateMembership({ level })
      if (membershipError) throw membershipError
      setPhone('')
      setEditing(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (error) {
      console.error('Error updating profile:', error)
      alert('Erro ao atualizar perfil')
    } finally {
      setLoading(false)
    }
  }

  const formatMixDate = (dateString) =>
    new Date(dateString).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' })

  const gamesPlayed = (stats?.game_wins || 0) + (stats?.game_losses || 0)
  const winRate = gamesPlayed > 0
    ? ((stats.game_wins / gamesPlayed) * 100).toFixed(0)
    : 0

  const inputLabel = 'block text-sm font-extrabold text-ink-900 mb-2'
  const fieldLabel = 'text-[11px] font-extrabold uppercase tracking-widest text-muted'
  const fieldValue = 'text-base text-ink-900 mt-0.5'

  // Guest view: header only — name + (Convidado) + Sair. No stats, no settings.
  if (isGuest) {
    return (
      <div className="space-y-4">
        <div className="card bg-ink-900 text-center relative overflow-hidden">
          <svg
            viewBox="0 0 400 160"
            className="absolute inset-0 w-full h-full text-white/[0.05]"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden="true"
          >
            <rect x="60" y="-60" width="280" height="260" rx="16" stroke="currentColor" strokeWidth="3" fill="none" />
            <line x1="200" y1="-60" x2="200" y2="200" stroke="currentColor" strokeWidth="3" />
          </svg>
          <div className="relative py-2">
            <div className="w-20 h-20 mx-auto mb-3">
              <Avatar name={profile?.name} url={profile?.avatar_url} size="w-20 h-20 text-3xl" colorClass="bg-lime-400 text-ink-900" />
            </div>
            <h2 className="text-2xl text-white">
              {profile?.name} <span className="text-ink-200 font-normal">(Convidado)</span>
            </h2>
            <div className="mt-2.5">
              <GuestBadge size="md" />
            </div>
          </div>
        </div>

        <PrimaryButton
          variant="ghost"
          onClick={async () => {
            await signOut()
            navigate('/login')
          }}
          className="w-full"
        >
          <LogOut size={20} />
          Sair
        </PrimaryButton>
      </div>
    )
  }

  const statTiles = stats && (gamesPlayed > 0 || (stats.mix_wins || 0) > 0) ? [
    { icon: Trophy, value: stats.mix_wins || 0, label: 'Mixes ganhos', cls: 'text-lime-600' },
    { icon: Target, value: gamesPlayed, label: 'Jogos', cls: 'text-ink-700' },
    { icon: Flame, value: stats.game_wins || 0, label: 'Jogos ganhos', cls: 'text-ok' },
    { icon: Award, value: `${winRate}%`, label: 'Taxa de vitória', cls: 'text-ink-700' },
  ] : null

  return (
    <div className="space-y-4">
      {/* Hero */}
      <div className="card bg-ink-900 text-center relative overflow-hidden">
        <svg
          viewBox="0 0 400 160"
          className="absolute inset-0 w-full h-full text-white/[0.05]"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
        >
          <rect x="60" y="-60" width="280" height="260" rx="16" stroke="currentColor" strokeWidth="3" fill="none" />
          <line x1="200" y1="-60" x2="200" y2="200" stroke="currentColor" strokeWidth="3" />
        </svg>
        <div className="relative py-2">
          <div className="relative w-20 h-20 mx-auto mb-3">
            <Avatar name={profile?.name} url={profile?.avatar_url} size="w-20 h-20 text-3xl" colorClass="bg-lime-400 text-ink-900" />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingPhoto}
              aria-label="Alterar foto de perfil"
              className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-ink-900 text-white flex items-center justify-center
                         ring-2 ring-ink-900 hover:bg-ink-700 transition-colors duration-fast disabled:opacity-50"
            >
              {uploadingPhoto ? (
                <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : (
                <Camera size={14} />
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handlePhotoSelect}
              className="hidden"
            />
          </div>
          <h2 className="text-2xl text-white">{profile?.name}</h2>
          <div className="mt-2.5">
            <LevelBadge level={currentMembership?.level} me size="md" />
          </div>
          {profile?.avatar_url && (
            <button
              type="button"
              onClick={handleRemovePhoto}
              disabled={uploadingPhoto}
              className="mt-2 text-ink-200 text-xs font-extrabold hover:text-white transition-colors duration-fast disabled:opacity-50"
            >
              Remover foto
            </button>
          )}
        </div>
      </div>

      {photoError && (
        <div className="bg-danger/10 text-danger px-4 py-3 rounded-ctrl text-sm font-extrabold animate-fade-up">
          {photoError}
        </div>
      )}

      {saved && (
        <div className="bg-ok/10 text-ok px-4 py-3 rounded-ctrl text-sm font-extrabold animate-fade-up">
          ✓ Perfil atualizado
        </div>
      )}

      {/* Stats */}
      {statTiles && (
        <div className="grid grid-cols-2 gap-3">
          {statTiles.map(({ icon: Icon, value, label, cls }) => (
            <div key={label} className="card text-center py-5">
              <Icon size={20} className={`mx-auto mb-1.5 ${cls}`} />
              <p className="text-2xl font-extrabold text-ink-900 tabular-nums">{value}</p>
              <p className="text-xs text-muted">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Mix history */}
      {!mixHistoryLoading && (
        <div>
          <h3 className="text-lg text-ink-900 mb-3">Histórico de mixes</h3>

          {mixHistory.length === 0 ? (
            <EmptyState
              icon={Trophy}
              title="Ainda não tens mixes terminados"
              subtitle="Quando terminares o teu primeiro mix, o histórico aparece aqui."
            />
          ) : (
            <div className="space-y-2.5">
              {mixHistory.map((m) => (
                <Link
                  key={m.gameId}
                  to={`/jogo/${m.gameId}`}
                  className="card press flex items-center gap-3 hover:shadow-lift"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-extrabold text-ink-900 text-sm truncate">{m.title}</p>
                    <p className="text-[11px] text-muted mt-0.5 truncate">
                      {formatMixDate(m.date)}{m.location ? ` · ${m.location}` : ''}
                    </p>
                  </div>
                  {m.position && (
                    <span className={`text-xs font-extrabold px-2.5 py-1.5 rounded-full shrink-0 tabular-nums ${
                      m.position === 1 ? 'bg-lime-400 text-ink-900' : 'bg-ink-50 text-ink-700'
                    }`}>
                      {m.position}º de {m.totalDuplas}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Personal info */}
      <div className="card">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg text-ink-900 flex items-center gap-2">
            <User size={20} className="text-ink-700" />
            Informação pessoal
          </h3>
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="text-ink-700 font-extrabold text-sm min-h-[44px] px-2"
            >
              Editar
            </button>
          )}
        </div>

        {editing ? (
          <form onSubmit={handleSave} className="space-y-4 animate-fade-up">
            <div>
              <label className={inputLabel}>Nome</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input-field"
                required
              />
            </div>

            <div>
              <label className={inputLabel}>Data de nascimento</label>
              <DateField
                value={birthday}
                onChange={setBirthday}
                max={new Date().toISOString().slice(0, 10)}
              />
            </div>

            <div>
              <label className={inputLabel}>Género</label>
              <Select
                value={gender}
                onChange={setGender}
                placeholder="Não especificado"
                options={[
                  { value: 'masculino', label: 'Masculino' },
                  { value: 'feminino', label: 'Feminino' },
                ]}
              />
            </div>

            <div>
              <label className={inputLabel}>Nível de jogo</label>
              <Select
                value={level}
                onChange={setLevel}
                options={[
                  { value: 'iniciante', label: 'Iniciante' },
                  { value: 'intermédio', label: 'Intermédio' },
                  { value: 'avançado', label: 'Avançado' },
                  { value: 'N2', label: 'N2' },
                  { value: 'N3', label: 'N3' },
                  { value: 'N4', label: 'N4' },
                  { value: 'N5', label: 'N5' },
                  { value: 'N6', label: 'N6' },
                ]}
              />
            </div>

            <div>
              <label className={inputLabel}>Nº de telemóvel</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="input-field"
                placeholder={profile?.phone_hash ? 'Já associado — escreve para substituir' : '912 345 678'}
              />
              {phoneError && <p className="text-xs text-danger mt-1.5">{phoneError}</p>}
              <p className="text-xs text-muted mt-1.5">
                {profile?.phone_hash
                  ? 'Deixa em branco para manter o número atual.'
                  : 'Opcional — só é preciso se quiseres usar o bot do WhatsApp.'}
              </p>
            </div>

            <div>
              <label className={inputLabel}>Lado preferido</label>
              <Select
                value={preferredSide}
                onChange={setPreferredSide}
                options={[
                  { value: 'left', label: 'Esquerda' },
                  { value: 'right', label: 'Direita' },
                  { value: 'both', label: 'Ambos' },
                ]}
              />
              <p className="text-xs text-muted mt-1.5">Usado na formação de duplas dos mixes</p>
            </div>

            <div className="flex gap-3 pt-2">
              <PrimaryButton type="submit" disabled={loading} className="flex-1">
                {loading ? 'A guardar…' : 'Guardar'}
              </PrimaryButton>
              <PrimaryButton
                type="button"
                variant="ghost"
                onClick={() => {
                  setEditing(false)
                  setName(profile.name)
                  setLevel(currentMembership?.level || 'iniciante')
                  setBirthday(profile.birthday || '')
                  setGender(profile.gender || '')
                  setPhone('')
                  setPhoneError('')
                }}
                className="flex-1"
              >
                Cancelar
              </PrimaryButton>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div>
              <p className={fieldLabel}>Nome</p>
              <p className={fieldValue}>{profile?.name}</p>
            </div>

            <div>
              <p className={fieldLabel}>Email</p>
              <p className={fieldValue}>{profile?.email}</p>
            </div>

            <div>
              <p className={fieldLabel}>Data de nascimento</p>
              <p className={fieldValue}>
                {profile?.birthday ? new Date(profile.birthday).toLocaleDateString('pt-PT') : 'Não definido'}
              </p>
            </div>

            <div>
              <p className={fieldLabel}>Género</p>
              <p className={fieldValue}>
                {profile?.gender ? profile.gender.charAt(0).toUpperCase() + profile.gender.slice(1) : 'Não definido'}
              </p>
            </div>

            <div>
              <p className={fieldLabel}>Nº de telemóvel</p>
              <p className={fieldValue}>{profile?.phone_hash ? 'Associado ✓' : 'Não associado'}</p>
            </div>

            <div>
              <p className={fieldLabel}>Nível de jogo</p>
              <p className={fieldValue}>{currentMembership?.level}</p>
            </div>

            <div>
              <p className={fieldLabel}>Lado preferido</p>
              <p className={fieldValue}>
                {{ left: 'Esquerda', right: 'Direita', both: 'Ambos' }[profile?.preferred_side] || 'Ambos'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
