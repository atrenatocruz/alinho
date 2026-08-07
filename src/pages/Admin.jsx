import { useState, useEffect } from 'react'
import { Plus, Calendar, Users, Trash2, Edit2, Check, X, UserX, Repeat } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { DateField, DateTimeField, Avatar } from '../components/ui'
import { totalRounds, FORMAT_LABEL } from '../lib/mixLogic'

// datetime-local <-> stored timestamptz helpers (keeps Portugal wall-clock)
const toLocalInput = (d) => {
  const dt = new Date(d)
  return new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

const COURT_TIMES = [
  { value: 60, label: '1h' },
  { value: 90, label: '1h30' },
  { value: 120, label: '2h' },
  { value: 150, label: '2h30' },
  { value: 180, label: '3h' },
]
const GAME_TIMES = [
  { value: 10, label: '10min' },
  { value: 15, label: '15min' },
  { value: 20, label: '20min' },
  { value: 30, label: '30min' },
]
const FORMATS = [
  { value: 'sobe_desce', label: 'Sobe e desce' },
  { value: 'todos_contra_todos', label: 'Todos contra todos' },
]
const RECURRENCE_FREQUENCIES = [
  { value: 'daily', label: 'Diariamente' },
  { value: 'weekly', label: 'Semanalmente' },
  { value: 'monthly', label: 'Mensalmente' },
  { value: 'yearly', label: 'Anualmente' },
]
const RECURRENCE_ENDS = [
  { value: 'never', label: 'Nunca' },
  { value: 'on_date', label: 'Até uma data' },
  { value: 'after_occurrences', label: 'Após X ocorrências' },
]

const DONE_STATUSES = ['finished', 'completed', 'cancelled']
const GAME_FILTERS = [
  { value: 'upcoming', label: 'A decorrer / Futuros' },
  { value: 'finished', label: 'Terminados' },
]

const EMPTY_RECURRENCE = {
  enabled: false,
  frequency: 'weekly',
  endsType: 'never',
  endsOn: '',
  endsAfterOccurrences: '',
  nextRunAt: '',
}

const EMPTY_GAME_FORM = {
  title: '',
  date: '',
  location: '',
  price_per_player: '',
  prize: '',
  num_courts: 1,
  court_time_minutes: 90,
  game_time_minutes: 20,
  format: 'sobe_desce',
  recurrence: EMPTY_RECURRENCE,
}

/* Segmented tab selector for form options */
function Segmented({ options, value, onChange }) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-3.5 py-2 min-h-[44px] rounded-ctrl text-sm font-extrabold transition-all duration-fast ${
            value === opt.value
              ? 'bg-ink-900 text-white'
              : 'bg-surface text-muted border border-line hover:text-ink-900'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export default function Admin() {
  const { profile: currentUser, currentOrganizationId, isPrivateMatchesEnabled, refreshFeatureFlags } = useAuth()
  const [activeTab, setActiveTab] = useState('games') // 'games', 'members', 'settings'
  const [games, setGames] = useState([])
  const [members, setMembers] = useState([])
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showCreateGame, setShowCreateGame] = useState(false)
  const [editingGame, setEditingGame] = useState(null)
  const [gameFilter, setGameFilter] = useState('upcoming')
  const [savingFlag, setSavingFlag] = useState(false)

  // Form states
  const [gameForm, setGameForm] = useState(EMPTY_GAME_FORM)

  useEffect(() => {
    if (currentOrganizationId) loadData()
  }, [activeTab, currentOrganizationId])

  const loadData = async () => {
    setLoading(true)
    try {
      if (activeTab === 'games') {
        await loadGames()
      } else if (activeTab === 'members') {
        await loadMembers()
      } else if (activeTab === 'settings') {
        await loadSettings()
      }
    } finally {
      setLoading(false)
    }
  }

  const loadGames = async () => {
    try {
      const { data, error } = await supabase
        .from('games')
        .select(`
          *,
          participants (
            id,
            user_id,
            partner_id,
            status
          ),
          recurrence:game_recurrences (
            id,
            is_active,
            frequency,
            ends_type,
            ends_on,
            ends_after_occurrences,
            next_run_at
          )
        `)
        .eq('organization_id', currentOrganizationId)
        .order('date', { ascending: false })

      if (error) {
        console.error('Error loading games:', error)
        throw error
      }

      console.log('Admin games loaded:', data)
      setGames(data || [])
    } catch (error) {
      console.error('Error in loadGames:', error)
      alert('Erro ao carregar jogos: ' + error.message)
    }
  }

  // Members live on `memberships` now (is_admin/is_guest/level are per-org),
  // joined with `profiles` for the display name — player_stats isn't shown
  // here so it isn't fetched.
  const loadMembers = async () => {
    const { data, error } = await supabase
      .from('memberships')
      .select('id, is_admin, is_guest, level, user_id, profile:profiles(*)')
      .eq('organization_id', currentOrganizationId)
      .eq('is_guest', false)

    if (error) {
      console.error('Error loading members:', error)
      return
    }

    const merged = (data || [])
      .map((m) => ({
        id: m.user_id,
        name: m.profile?.name || 'Jogador',
        is_admin: m.is_admin,
        is_guest: m.is_guest,
        level: m.level,
        avatar_url: m.profile?.avatar_url,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    setMembers(merged)
  }

  const loadSettings = async () => {
    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', currentOrganizationId)
      .single()

    if (error) {
      console.error('Error loading settings:', error)
      return
    }
    setSettings(data)
  }

  // Fields shared between creating and updating a game_recurrences row —
  // the rule itself plus the snapshot of settings future Mixes will copy.
  // Deliberately excludes mix_offset_seconds/next_run_at: those are set
  // once at creation time (see createRecurrence) and must never be
  // recomputed on an edit of the origin Mix, or the schedule corrupts.
  const recurrenceSnapshotAndRule = (game, recurrence) => ({
    frequency: recurrence.frequency,
    ends_type: recurrence.endsType,
    ends_on: recurrence.endsType === 'on_date' ? new Date(`${recurrence.endsOn}T23:59:59`).toISOString() : null,
    ends_after_occurrences: recurrence.endsType === 'after_occurrences' ? parseInt(recurrence.endsAfterOccurrences, 10) : null,
    title: game.title,
    location: game.location,
    price_per_player: game.price_per_player,
    prize: game.prize,
    num_courts: game.num_courts,
    court_time_minutes: game.court_time_minutes,
    game_time_minutes: game.game_time_minutes,
    format: game.format,
  })

  // Mirrors the cron function's own step (see process_due_game_recurrences
  // in supabase/schema.sql) — by construction, offset = (mix date) -
  // (entered "criar automaticamente em"), so the first tick from the
  // entered value would always land exactly on the origin Mix's own date.
  // Seeding next_run_at one step ahead skips that guaranteed no-op tick.
  const advanceByFrequency = (date, frequency) => {
    const d = new Date(date)
    if (frequency === 'daily') d.setDate(d.getDate() + 1)
    else if (frequency === 'weekly') d.setDate(d.getDate() + 7)
    else if (frequency === 'monthly') d.setMonth(d.getMonth() + 1)
    else if (frequency === 'yearly') d.setFullYear(d.getFullYear() + 1)
    return d
  }

  const validateRecurrence = (recurrence, mixDateStr, checkNextRunAt = true) => {
    if (!recurrence.enabled) return null
    if (checkNextRunAt) {
      if (!recurrence.nextRunAt) return 'Escolhe a data e hora em que o próximo Mix deve ser criado automaticamente'
      if (new Date(recurrence.nextRunAt).getTime() >= new Date(mixDateStr).getTime()) {
        return 'A data de "criar automaticamente em" tem de ser antes da data e hora do Mix'
      }
    }
    if (recurrence.endsType === 'on_date' && !recurrence.endsOn) return 'Escolhe a data em que a recorrência termina'
    if (recurrence.endsType === 'after_occurrences' && (!recurrence.endsAfterOccurrences || parseInt(recurrence.endsAfterOccurrences, 10) < 1)) {
      return 'Indica um número de ocorrências válido'
    }
    return null
  }

  // Inserts the game_recurrences row for a newly-flagged origin Mix, then
  // links `game` back to it. Used both when recurrence is turned on at
  // creation time (handleCreateGame) and when it's turned on while editing
  // a Mix that wasn't recurring yet (handleUpdateGame, Task 3).
  const createRecurrence = async (game, recurrence, userId) => {
    const { data: newRecurrence, error: recurrenceError } = await supabase
      .from('game_recurrences')
      .insert([{
        ...recurrenceSnapshotAndRule(game, recurrence),
        mix_offset_seconds: Math.round(
          (new Date(game.date).getTime() - new Date(recurrence.nextRunAt).getTime()) / 1000
        ),
        next_run_at: advanceByFrequency(new Date(recurrence.nextRunAt), recurrence.frequency).toISOString(),
        organization_id: currentOrganizationId,
        created_by: userId,
      }])
      .select()
      .single()

    if (recurrenceError) {
      console.error('Error creating recurrence:', recurrenceError)
      alert('O Mix foi criado, mas não foi possível ativar a recorrência: ' + recurrenceError.message)
      return
    }

    const { error: linkError } = await supabase
      .from('games')
      .update({ recurrence_id: newRecurrence.id, is_recurrence_origin: true })
      .eq('id', game.id)

    if (linkError) {
      console.error('Error linking game to recurrence:', linkError)
      alert('O Mix foi criado, mas não foi possível ligá-lo à recorrência: ' + linkError.message)
    }
  }

  const handleCreateGame = async (e) => {
    e.preventDefault()

    // Date used to be enforced by DateTimeField's underlying native
    // input's `required` attribute — it's a fully custom component now.
    if (!gameForm.date) {
      alert('Escolhe uma data e hora para o jogo')
      return
    }

    const { recurrence, ...gameFields } = gameForm

    const recurrenceError = validateRecurrence(recurrence, gameForm.date)
    if (recurrenceError) {
      alert(recurrenceError)
      return
    }

    try {
      const { data: { user } } = await supabase.auth.getUser()
      // num_courts is kept as a raw string in gameForm while the admin is
      // typing (see the input's onChange) — clamp it to a valid 1-6 count
      // here, at submit time, rather than on every keystroke.
      const numCourts = Math.min(6, Math.max(1, parseInt(gameForm.num_courts, 10) || 1))

      console.log('Creating game with data:', {
        ...gameFields,
        created_by: user.id,
        status: 'open'
      })

      const { data, error } = await supabase
        .from('games')
        .insert([
          {
            ...gameFields,
            organization_id: currentOrganizationId,
            // datetime-local is Portugal wall-clock; store the real instant
            date: new Date(gameForm.date).toISOString(),
            num_courts: numCourts,
            max_players: numCourts * 4, // derived
            price_per_player: gameForm.price_per_player === '' ? null : parseFloat(gameForm.price_per_player),
            created_by: user.id,
            status: 'open'
          }
        ])
        .select()

      if (error) {
        console.error('Database error:', error)
        throw error
      }

      console.log('Game created successfully:', data)

      if (recurrence.enabled) {
        await createRecurrence(data[0], recurrence, user.id)
      }

      setShowCreateGame(false)
      setGameForm(EMPTY_GAME_FORM)
      loadGames()
    } catch (error) {
      console.error('Error creating game:', error)
      alert('Erro ao criar jogo: ' + error.message)
    }
  }

  // Updates the snapshot + rule on the origin Mix's recurrence. Only ever
  // called from handleUpdateGame when editing the origin of an active
  // recurrence — already-created Mixes are never touched by this.
  const updateRecurrence = async (recurrenceId, game, recurrence) => {
    const { error } = await supabase
      .from('game_recurrences')
      .update({
        ...recurrenceSnapshotAndRule(game, recurrence),
        updated_at: new Date().toISOString(),
      })
      .eq('id', recurrenceId)

    if (error) {
      console.error('Error updating recurrence:', error)
      alert('O Mix foi atualizado, mas não foi possível atualizar a recorrência: ' + error.message)
    }
  }

  const handleUpdateGame = async (e) => {
    e.preventDefault()

    if (!gameForm.date) {
      alert('Escolhe uma data e hora para o jogo')
      return
    }

    // Destructure recurrence so it's never spread into the games table update
    const { recurrence, ...gameFields } = gameForm
    const hadActiveRecurrence = editingGame.is_recurrence_origin && editingGame.recurrence?.is_active

    const recurrenceError = validateRecurrence(recurrence, gameForm.date, !hadActiveRecurrence)
    if (recurrenceError) {
      alert(recurrenceError)
      return
    }

    try {
      // See handleCreateGame — num_courts is a raw string while typing,
      // clamped to a valid 1-6 count here at submit time.
      const numCourts = Math.min(6, Math.max(1, parseInt(gameForm.num_courts, 10) || 1))

      const { data, error } = await supabase
        .from('games')
        .update({
          ...gameFields,
          date: new Date(gameForm.date).toISOString(),
          num_courts: numCourts,
          max_players: numCourts * 4,
          price_per_player: gameForm.price_per_player === '' ? null : parseFloat(gameForm.price_per_player),
        })
        .eq('id', editingGame.id)
        .select()
        .single()

      if (error) throw error

      if (hadActiveRecurrence && recurrence.enabled) {
        // Origin Mix, recurrence still on: keep the shared rule/snapshot in sync.
        await updateRecurrence(editingGame.recurrence.id, data, recurrence)
      } else if (hadActiveRecurrence && !recurrence.enabled) {
        // Origin Mix, toggled off: stop creating future Mixes. Never reactivated later.
        await supabase
          .from('game_recurrences')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('id', editingGame.recurrence.id)
      } else if (!hadActiveRecurrence && recurrence.enabled) {
        // Wasn't recurring (never was, or a previous recurrence was stopped): start a new one.
        const { data: { user } } = await supabase.auth.getUser()
        await createRecurrence(data, recurrence, user.id)
      }

      setEditingGame(null)
      setGameForm(EMPTY_GAME_FORM)
      loadGames()
    } catch (error) {
      console.error('Error updating game:', error)
      alert('Erro ao atualizar jogo')
    }
  }

  const handleDeleteGame = async (gameId) => {
    if (!confirm('Tens a certeza que queres eliminar este jogo?')) return

    try {
      const gameToDelete = games.find(g => g.id === gameId)

      const { error } = await supabase
        .from('games')
        .delete()
        .eq('id', gameId)

      if (error) throw error

      // The origin Mix is the only place the "Mix recorrente" toggle lives —
      // deleting it must also stop the recurrence, otherwise it would keep
      // creating Mixes automatically with no UI left to turn it off from.
      if (gameToDelete?.is_recurrence_origin && gameToDelete.recurrence?.is_active) {
        await supabase
          .from('game_recurrences')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('id', gameToDelete.recurrence_id)
      }

      alert('Jogo eliminado com sucesso!')
      loadGames()
    } catch (error) {
      console.error('Error deleting game:', error)
      alert('Erro ao eliminar jogo')
    }
  }

  const handleStopRecurrence = async (recurrenceId) => {
    if (!confirm('Parar esta recorrência? Os Mixes já criados mantêm-se; não serão criados mais Mixes automaticamente.')) return

    try {
      const { error } = await supabase
        .from('game_recurrences')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', recurrenceId)

      if (error) throw error

      loadGames()
    } catch (error) {
      console.error('Error stopping recurrence:', error)
      alert('Erro ao parar a recorrência: ' + error.message)
    }
  }

  const handleToggleAdmin = async (userId, currentStatus) => {
    try {
      const { error } = await supabase.rpc('admin_set_membership_admin', {
        p_organization_id: currentOrganizationId,
        p_user_id: userId,
        p_is_admin: !currentStatus,
      })

      if (error) throw error

      alert('Permissões atualizadas com sucesso!')
      loadMembers()
    } catch (error) {
      console.error('Error updating admin status:', error)
      alert('Erro ao atualizar permissões: ' + error.message)
    }
  }

  const handleDeleteUser = async (member) => {
    if (!confirm(
      `Remover ${member.name} deste clube?\n\n` +
      `A conta e as inscrições/estatísticas noutros clubes (se os houver) mantêm-se — isto só remove a ligação a este clube.`
    )) return

    try {
      const { error } = await supabase.rpc('admin_remove_member', {
        p_organization_id: currentOrganizationId,
        p_user_id: member.id,
      })
      if (error) throw error
      loadMembers()
    } catch (error) {
      console.error('Error removing member:', error)
      alert('Erro ao remover membro: ' + error.message)
    }
  }

  const handleUpdateSettings = async (e) => {
    e.preventDefault()

    try {
      const { error } = await supabase
        .from('organizations')
        .update({
          robot_contact: settings.robot_contact,
          name: settings.name,
          points_rules: settings.points_rules
        })
        .eq('id', settings.id)

      if (error) throw error

      alert('Definições atualizadas com sucesso!')
    } catch (error) {
      console.error('Error updating settings:', error)
      alert('Erro ao atualizar definições')
    }
  }

  const handleTogglePrivateMatches = async () => {
    setSavingFlag(true)
    try {
      const { error } = await supabase.rpc('admin_set_feature_flag', {
        p_key: 'private_matches',
        p_enabled: !isPrivateMatchesEnabled,
      })
      if (error) throw error
      await refreshFeatureFlags()
    } catch (error) {
      console.error('Error toggling private matches flag:', error)
      alert('Erro ao atualizar funcionalidade: ' + error.message)
    } finally {
      setSavingFlag(false)
    }
  }

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString('pt-PT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const startEditGame = (game) => {
    setEditingGame(game)
    const hasActiveRecurrence = game.is_recurrence_origin && game.recurrence?.is_active
    setGameForm({
      title: game.title,
      date: toLocalInput(game.date),
      location: game.location || '',
      price_per_player: game.price_per_player ?? '',
      prize: game.prize || '',
      num_courts: game.num_courts || 1,
      court_time_minutes: game.court_time_minutes || 90,
      game_time_minutes: game.game_time_minutes || 20,
      format: game.format || 'sobe_desce',
      recurrence: hasActiveRecurrence
        ? {
            enabled: true,
            frequency: game.recurrence.frequency,
            endsType: game.recurrence.ends_type,
            endsOn: game.recurrence.ends_on ? toLocalInput(game.recurrence.ends_on).slice(0, 10) : '',
            endsAfterOccurrences: game.recurrence.ends_after_occurrences ?? '',
            nextRunAt: toLocalInput(game.recurrence.next_run_at),
          }
        : EMPTY_RECURRENCE,
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-ink-900">Painel Admin</h2>
        <p className="text-gray-600 mt-1">Gerir jogos, membros e definições</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('games')}
          className={`px-6 py-3 rounded-xl font-semibold transition-all whitespace-nowrap ${
            activeTab === 'games'
              ? 'bg-ink-700 text-white'
              : 'bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          <Calendar className="inline mr-2" size={20} />
          Jogos
        </button>
        <button
          onClick={() => setActiveTab('members')}
          className={`px-6 py-3 rounded-xl font-semibold transition-all whitespace-nowrap ${
            activeTab === 'members'
              ? 'bg-ink-700 text-white'
              : 'bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          <Users className="inline mr-2" size={20} />
          Membros
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`px-6 py-3 rounded-xl font-semibold transition-all whitespace-nowrap ${
            activeTab === 'settings'
              ? 'bg-ink-700 text-white'
              : 'bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          Definições
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-ink-700"></div>
        </div>
      ) : (
        <>
          {/* Games Tab */}
          {activeTab === 'games' && (
            <div className="space-y-4">
              <button
                onClick={() => setShowCreateGame(true)}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                <Plus size={20} />
                Criar novo jogo
              </button>

              {/* Create/Edit Game Form */}
              {(showCreateGame || editingGame) && (
                <div className="card bg-blue-50 border-2 border-blue-200">
                  <h3 className="text-xl font-semibold text-ink-900 mb-4">
                    {editingGame ? 'Editar jogo' : 'Criar novo jogo'}
                  </h3>
                  <form onSubmit={editingGame ? handleUpdateGame : handleCreateGame} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Título
                      </label>
                      <input
                        type="text"
                        value={gameForm.title}
                        onChange={(e) => setGameForm({ ...gameForm, title: e.target.value })}
                        className="input-field"
                        placeholder="Mix de domingo"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Data e hora
                      </label>
                      <DateTimeField
                        value={gameForm.date}
                        onChange={(v) => setGameForm({ ...gameForm, date: v })}
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Local
                      </label>
                      <input
                        type="text"
                        value={gameForm.location}
                        onChange={(e) => setGameForm({ ...gameForm, location: e.target.value })}
                        className="input-field"
                        placeholder="Clube de Padel"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Preço por jogador (€)
                      </label>
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        value={gameForm.price_per_player}
                        onChange={(e) => setGameForm({ ...gameForm, price_per_player: e.target.value })}
                        className="input-field"
                        placeholder="ex: 5"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Prémio
                      </label>
                      <input
                        type="text"
                        value={gameForm.prize}
                        onChange={(e) => setGameForm({ ...gameForm, prize: e.target.value })}
                        className="input-field"
                        placeholder="ex: Vouchers para os vencedores"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Número de campos
                      </label>
                      <input
                        type="number"
                        value={gameForm.num_courts}
                        onChange={(e) => setGameForm({ ...gameForm, num_courts: e.target.value })}
                        className="input-field"
                        min="1"
                        max="6"
                        required
                      />
                      <p className="text-sm text-muted mt-1.5">
                        = <strong className="text-ink-900">{(gameForm.num_courts || 1) * 4} jogadores</strong> ({gameForm.num_courts || 1} {gameForm.num_courts === 1 ? 'campo' : 'campos'} × 4)
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Tempo do court
                      </label>
                      <Segmented
                        options={COURT_TIMES}
                        value={gameForm.court_time_minutes}
                        onChange={(v) => setGameForm({ ...gameForm, court_time_minutes: v })}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Tempo de jogo
                      </label>
                      <Segmented
                        options={GAME_TIMES}
                        value={gameForm.game_time_minutes}
                        onChange={(v) => setGameForm({ ...gameForm, game_time_minutes: v })}
                      />
                      <p className="text-sm text-muted mt-1.5">
                        = <strong className="text-ink-900">{totalRounds(gameForm)} rondas</strong> ({gameForm.court_time_minutes}min ÷ {gameForm.game_time_minutes}min)
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Formato
                      </label>
                      <Segmented
                        options={FORMATS}
                        value={gameForm.format}
                        onChange={(v) => setGameForm({ ...gameForm, format: v })}
                      />
                    </div>

                    {(!editingGame || editingGame.is_recurrence_origin || !editingGame.recurrence?.is_active) && (
                      <div className="border-t border-line pt-4 space-y-4">
                        <label className="flex items-center gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={gameForm.recurrence.enabled}
                            onChange={(e) => setGameForm({
                              ...gameForm,
                              recurrence: { ...gameForm.recurrence, enabled: e.target.checked }
                            })}
                            className="w-5 h-5"
                          />
                          <span className="text-sm font-medium text-gray-700">Mix recorrente</span>
                        </label>

                        {gameForm.recurrence.enabled && (
                          <>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Frequência
                              </label>
                              <Segmented
                                options={RECURRENCE_FREQUENCIES}
                                value={gameForm.recurrence.frequency}
                                onChange={(v) => setGameForm({
                                  ...gameForm,
                                  recurrence: { ...gameForm.recurrence, frequency: v }
                                })}
                              />
                            </div>

                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Termina
                              </label>
                              <Segmented
                                options={RECURRENCE_ENDS}
                                value={gameForm.recurrence.endsType}
                                onChange={(v) => setGameForm({
                                  ...gameForm,
                                  recurrence: { ...gameForm.recurrence, endsType: v }
                                })}
                              />
                              {gameForm.recurrence.endsType === 'on_date' && (
                                <div className="mt-2">
                                  <DateField
                                    value={gameForm.recurrence.endsOn}
                                    onChange={(v) => setGameForm({
                                      ...gameForm,
                                      recurrence: { ...gameForm.recurrence, endsOn: v }
                                    })}
                                    placeholder="Seleciona a data final"
                                  />
                                </div>
                              )}
                              {gameForm.recurrence.endsType === 'after_occurrences' && (
                                <input
                                  type="number"
                                  min="1"
                                  value={gameForm.recurrence.endsAfterOccurrences}
                                  onChange={(e) => setGameForm({
                                    ...gameForm,
                                    recurrence: { ...gameForm.recurrence, endsAfterOccurrences: e.target.value }
                                  })}
                                  className="input-field mt-2"
                                  placeholder="ex: 10"
                                  required
                                />
                              )}
                            </div>

                            {!(editingGame && editingGame.is_recurrence_origin && editingGame.recurrence?.is_active) && (
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                  Criar automaticamente em
                                </label>
                                <DateTimeField
                                  value={gameForm.recurrence.nextRunAt}
                                  onChange={(v) => setGameForm({
                                    ...gameForm,
                                    recurrence: { ...gameForm.recurrence, nextRunAt: v }
                                  })}
                                  required
                                />
                                <p className="text-sm text-muted mt-1.5">
                                  Tem de ser antes da data deste Mix — a mesma distância no tempo é usada para criar cada Mix futuro (ex.: 3 dias antes → cada novo Mix é criado 3 dias antes de acontecer).
                                </p>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}

                    <div className="flex gap-3">
                      <button type="submit" className="btn-primary flex-1">
                        {editingGame ? 'Atualizar' : 'Criar'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowCreateGame(false)
                          setEditingGame(null)
                          setGameForm(EMPTY_GAME_FORM)
                        }}
                        className="btn-secondary flex-1"
                      >
                        Cancelar
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Games List */}
              <Segmented options={GAME_FILTERS} value={gameFilter} onChange={setGameFilter} />

              <div className="space-y-3">
                {games
                  .filter(game => gameFilter === 'finished'
                    ? DONE_STATUSES.includes(game.status)
                    : !DONE_STATUSES.includes(game.status))
                  .map(game => {
                  const peopleCount = (game.participants || [])
                    .filter(p => p.status === 'confirmed')
                    .reduce((n, p) => n + 1 + (p.partner_id ? 1 : 0), 0)

                  return (
                    <div key={game.id} className="card">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex-1">
                          <h3 className="text-xl font-semibold text-ink-900 mb-2">
                            {game.title}
                          </h3>
                          <div className="space-y-1 text-gray-600">
                            <p>{formatDate(game.date)}</p>
                            {game.location && <p>📍 {game.location}</p>}
                            <p>
                              👥 {peopleCount}/{game.max_players || (game.num_courts || 1) * 4} jogadores
                            </p>
                            <p className="text-sm">
                              {FORMAT_LABEL[game.format] || 'Sobe e desce'} • {game.num_courts || 1} {(game.num_courts || 1) === 1 ? 'campo' : 'campos'} • {totalRounds(game)} rondas
                            </p>
                          </div>
                          {game.recurrence?.is_active && (
                            <div className="mt-2 flex items-center gap-2 flex-wrap">
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-lime-100 text-lime-800 text-xs font-bold">
                                <Repeat size={12} />
                                Recorrente
                              </span>
                              {!game.is_recurrence_origin && (
                                <button
                                  type="button"
                                  onClick={() => handleStopRecurrence(game.recurrence.id)}
                                  className="text-xs font-semibold text-red-600 hover:underline"
                                >
                                  Parar recorrência
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        
                        <div className="flex gap-2">
                          <button
                            onClick={() => startEditGame(game)}
                            className="p-2 text-ink-700 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Editar"
                          >
                            <Edit2 size={20} />
                          </button>
                          <button
                            onClick={() => handleDeleteGame(game.id)}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Eliminar"
                          >
                            <Trash2 size={20} />
                          </button>
                        </div>
                      </div>

                      <div className={`inline-block px-4 py-2 rounded-xl font-medium ${
                        game.status === 'open' ? 'bg-blue-100 text-blue-700' :
                        game.status === 'closed' ? 'bg-green-100 text-green-700' :
                        game.status === 'in_progress' ? 'bg-lime-400 text-ink-900' :
                        game.status === 'completed' || game.status === 'finished' ? 'bg-gray-100 text-gray-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {game.status === 'open' && 'Aberto'}
                        {game.status === 'closed' && 'Mix fechado — campo reservado'}
                        {game.status === 'in_progress' && 'A decorrer'}
                        {(game.status === 'completed' || game.status === 'finished') && 'Terminado'}
                        {game.status === 'cancelled' && 'Cancelado'}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Members Tab */}
          {activeTab === 'members' && (
            <div className="space-y-3">
              <div className="card bg-blue-50">
                <p className="text-gray-700">
                  <strong>Total de membros:</strong> {members.length}
                </p>
              </div>

              {members.map(member => (
                <div key={member.id} className="card">
                  <div className="flex items-center gap-3.5">
                    <Avatar name={member.name} url={member.avatar_url} size="w-11 h-11 text-sm" />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-extrabold text-ink-900 truncate flex items-center gap-1.5">
                        <span className="truncate">{member.name}</span>
                        {member.is_admin && (
                          <span className="w-2 h-2 rounded-full bg-lime-600 shrink-0" title="Admin" />
                        )}
                      </h3>
                      <p className="text-sm text-muted truncate">
                        Nível: {member.level}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => handleToggleAdmin(member.id, member.is_admin)}
                        className="whitespace-nowrap text-xs font-extrabold px-3 py-2 min-h-[44px] rounded-full bg-ink-50 text-ink-700 hover:bg-ink-200 transition-colors duration-fast"
                      >
                        {member.is_admin ? 'Retirar admin' : 'Tornar admin'}
                      </button>
                      {member.id !== currentUser?.id && (
                        <button
                          onClick={() => handleDeleteUser(member)}
                          title={`Eliminar ${member.name}`}
                          className="w-10 h-10 flex items-center justify-center rounded-full text-danger hover:bg-danger/10 transition-colors duration-fast"
                        >
                          <UserX size={20} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Settings Tab */}
          {activeTab === 'settings' && settings && (
            <div className="card">
              <h3 className="text-xl font-semibold text-ink-900 mb-6">
                Definições do Grupo
              </h3>
              
              <form onSubmit={handleUpdateSettings} className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Nome do grupo
                  </label>
                  <input
                    type="text"
                    value={settings.name}
                    onChange={(e) => setSettings({ ...settings, name: e.target.value })}
                    className="input-field"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Contacto do Robot (placeholder)
                  </label>
                  <input
                    type="text"
                    value={settings.robot_contact}
                    onChange={(e) => setSettings({ ...settings, robot_contact: e.target.value })}
                    className="input-field"
                    placeholder="+351 XXX XXX XXX"
                  />
                  <p className="text-sm text-gray-500 mt-2">
                    Número de contacto para notificações futuras (não ativo)
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Logo do grupo (em breve)
                  </label>
                  <div className="border-2 border-dashed border-gray-300 rounded-2xl p-8 text-center text-gray-500">
                    Funcionalidade de upload em desenvolvimento
                  </div>
                </div>

                <div className="pt-2 border-t border-gray-200">
                  <h4 className="text-base font-semibold text-ink-900 mt-6 mb-1">
                    Sistema de pontos
                  </h4>
                  <p className="text-sm text-gray-500 mb-4">
                    Pontos atribuídos a cada jogador quando um mix é finalizado. Alterar
                    estes valores só afeta mixes finalizados a partir de agora.
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Por jogo disputado
                      </label>
                      <input
                        type="number" min="0"
                        value={settings.points_rules?.point_per_match_played ?? 0}
                        onChange={(e) => setSettings({
                          ...settings,
                          points_rules: { ...settings.points_rules, point_per_match_played: parseInt(e.target.value, 10) || 0 }
                        })}
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Por jogo ganho
                      </label>
                      <input
                        type="number" min="0"
                        value={settings.points_rules?.point_per_match_win ?? 0}
                        onChange={(e) => setSettings({
                          ...settings,
                          points_rules: { ...settings.points_rules, point_per_match_win: parseInt(e.target.value, 10) || 0 }
                        })}
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Por participar num mix
                      </label>
                      <input
                        type="number" min="0"
                        value={settings.points_rules?.point_per_mix_participation ?? 0}
                        onChange={(e) => setSettings({
                          ...settings,
                          points_rules: { ...settings.points_rules, point_per_mix_participation: parseInt(e.target.value, 10) || 0 }
                        })}
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Por ganhar o mix
                      </label>
                      <input
                        type="number" min="0"
                        value={settings.points_rules?.point_per_mix_win ?? 0}
                        onChange={(e) => setSettings({
                          ...settings,
                          points_rules: { ...settings.points_rules, point_per_mix_win: parseInt(e.target.value, 10) || 0 }
                        })}
                        className="input-field"
                      />
                    </div>
                  </div>
                </div>

                <button type="submit" className="btn-primary w-full">
                  Guardar definições
                </button>
              </form>

              <div className="mt-6 pt-6 border-t border-gray-200">
                <h4 className="text-base font-semibold text-ink-900 mb-1">
                  Funcionalidades da app
                </h4>
                <p className="text-sm text-gray-500 mb-4">
                  Afeta todos os clubes — não é específico deste grupo.
                </p>
                <label className="flex items-center justify-between gap-4 p-3 rounded-ctrl border border-line">
                  <div>
                    <p className="font-extrabold text-ink-900 text-sm">Jogo entre amigos</p>
                    <p className="text-[11px] text-muted">Permite criar jogos 2x2 fora do clube</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={isPrivateMatchesEnabled}
                    disabled={savingFlag}
                    onChange={handleTogglePrivateMatches}
                    className="w-5 h-5 shrink-0"
                  />
                </label>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

