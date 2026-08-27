import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Search, Users, UserPlus, Clock, Heart, Plus, GraduationCap, X } from 'lucide-react'
import { searchPlayers, listPlayers } from '../lib/privateMatches'
import { searchOrganizations, listGlobalOrganizations } from '../lib/organizations'
import { createSelfServeGroup } from '../lib/platformAdmin'
import { DAYS, DAY_LABEL, listTeacherProfiles, requestTeacherProfile, withdrawTeacherProfile } from '../lib/teachers'
import { useAuth } from '../contexts/AuthContext'
import { Avatar, EmptyState } from '../components/ui'

// High enough that for these pilot clubs the browse list is, in practice,
// the whole community — not just a truncated preview.
const BROWSE_LIMIT = 100

const TABS = [
  { key: 'players', label: 'Jogadores' },
  { key: 'orgs', label: 'Clubes' },
  { key: 'teachers', label: 'Professores' },
]

const EMPTY_SLOT = { day: 'segunda', start: '18:00', end: '20:00' }

const sanitizeSlug = (value) => value.toLowerCase().replace(/[^a-z0-9-]/g, '')

export default function Comunidade() {
  const { user, memberships, followOrganization, leaveOrganization, toggleFavoriteOrganization, adminOrganizations, refreshMemberships } = useAuth()
  const navigate = useNavigate()
  const [teachers, setTeachers] = useState([])
  const [teachersLoading, setTeachersLoading] = useState(true)
  const [showTeacherForm, setShowTeacherForm] = useState(false)
  const [teacherOrgId, setTeacherOrgId] = useState('')
  const [teacherContact, setTeacherContact] = useState('')
  const [teacherSlots, setTeacherSlots] = useState([{ ...EMPTY_SLOT }])
  const [submittingTeacher, setSubmittingTeacher] = useState(false)
  const [teacherError, setTeacherError] = useState('')
  const [withdrawingTeacherId, setWithdrawingTeacherId] = useState(null)
  const [showCreateGroupForm, setShowCreateGroupForm] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [groupSlug, setGroupSlug] = useState('')
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [createGroupError, setCreateGroupError] = useState('')
  const [tab, setTab] = useState('players')
  const [query, setQuery] = useState('')
  const [players, setPlayers] = useState([])
  const [organizations, setOrganizations] = useState([])
  const [loading, setLoading] = useState(true)
  const [actingOn, setActingOn] = useState(null)
  const [favoritingOn, setFavoritingOn] = useState(null)
  const timeoutRef = useRef(null)

  // Re-fetches just the organizations half of the list — used after
  // follow/unfollow/favorite actions so my_status/member_count refresh
  // without re-running the (debounced) player search too.
  const reloadOrganizations = async (trimmedQuery) => {
    try {
      const data = trimmedQuery ? await searchOrganizations(trimmedQuery) : await listGlobalOrganizations()
      setOrganizations(data)
    } catch (error) {
      console.error('Error reloading organizations:', error)
    }
  }

  useEffect(() => {
    const trimmed = query.trim()

    // 1 character: neither a real search nor empty — leave the current
    // list on screen instead of flashing a spinner for a query we won't run.
    if (trimmed.length === 1) return

    setLoading(true)

    if (trimmed.length === 0) {
      Promise.all([listPlayers(BROWSE_LIMIT), listGlobalOrganizations()])
        .then(([playersData, orgsData]) => {
          setPlayers(playersData)
          setOrganizations(orgsData)
        })
        .catch((error) => console.error('Error loading comunidade:', error))
        .finally(() => setLoading(false))
      return
    }

    timeoutRef.current = setTimeout(async () => {
      try {
        const [playersData, orgsData] = await Promise.all([
          searchPlayers(query),
          searchOrganizations(query),
        ])
        setPlayers(playersData)
        setOrganizations(orgsData)
      } catch (error) {
        console.error('Error searching comunidade:', error)
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timeoutRef.current)
  }, [query])

  const loadTeachers = async () => {
    setTeachersLoading(true)
    try {
      setTeachers(await listTeacherProfiles())
    } catch (error) {
      console.error('Error loading teacher profiles:', error)
    } finally {
      setTeachersLoading(false)
    }
  }

  useEffect(() => {
    loadTeachers()
  }, [])

  const myTeacherProfile = teachers.find((t) => t.user_id === user.id)
  const otherTeachers = teachers.filter((t) => t.user_id !== user.id && t.status === 'approved')
  // Only clubs the caller isn't already listed as a teacher in — one
  // profile per (user, org), enforced server-side by a UNIQUE constraint.
  const teachableOrgs = memberships
    .map((m) => m.organization)
    .filter((o) => !teachers.some((t) => t.organization_id === o.id && t.user_id === user.id))

  const handleAddSlot = () => setTeacherSlots((slots) => [...slots, { ...EMPTY_SLOT }])
  const handleRemoveSlot = (index) => setTeacherSlots((slots) => slots.filter((_, i) => i !== index))
  const handleSlotChange = (index, field, value) =>
    setTeacherSlots((slots) => slots.map((s, i) => (i === index ? { ...s, [field]: value } : s)))

  const handleRequestTeacher = async () => {
    setTeacherError('')
    if (!teacherOrgId) {
      setTeacherError('Escolhe um clube')
      return
    }
    if (!teacherContact.trim()) {
      setTeacherError('Indica uma forma de contacto')
      return
    }
    if (teacherSlots.some((s) => s.start >= s.end)) {
      setTeacherError('Cada horário precisa de uma hora de fim depois da hora de início')
      return
    }
    setSubmittingTeacher(true)
    try {
      await requestTeacherProfile(teacherOrgId, user.id, teacherContact.trim(), teacherSlots)
      setShowTeacherForm(false)
      setTeacherOrgId('')
      setTeacherContact('')
      setTeacherSlots([{ ...EMPTY_SLOT }])
      await loadTeachers()
    } catch (error) {
      console.error('Error requesting teacher profile:', error)
      setTeacherError('Não foi possível enviar o pedido. Tenta novamente.')
    } finally {
      setSubmittingTeacher(false)
    }
  }

  const handleWithdrawTeacher = async (id) => {
    if (!confirm('Retirar o teu perfil de professor deste clube?')) return
    setWithdrawingTeacherId(id)
    try {
      await withdrawTeacherProfile(id)
      await loadTeachers()
    } catch (error) {
      console.error('Error withdrawing teacher profile:', error)
      alert('Não foi possível retirar o pedido. Tenta novamente.')
    } finally {
      setWithdrawingTeacherId(null)
    }
  }

  const handleFollow = async (org) => {
    setActingOn(org.id)
    try {
      const { error } = await followOrganization(org.id)
      if (error) throw error
      await reloadOrganizations(query.trim())
    } catch (error) {
      console.error('Error following organization:', error)
      alert('Não foi possível seguir. Tenta novamente.')
    } finally {
      setActingOn(null)
    }
  }

  const handleUnfollow = async (org) => {
    if (!confirm(`Deixar de seguir ${org.name}? Deixas de ver os mixs deste clube.`)) return
    setActingOn(org.id)
    try {
      const { error } = await leaveOrganization(org.id)
      if (error) throw error
      await reloadOrganizations(query.trim())
    } catch (error) {
      console.error('Error leaving organization:', error)
      alert(error.message || 'Não foi possível deixar de seguir.')
    } finally {
      setActingOn(null)
    }
  }

  const handleToggleFavorite = async (org, currentlyFavorite) => {
    setFavoritingOn(org.id)
    try {
      const { error } = await toggleFavoriteOrganization(org.id, !currentlyFavorite)
      if (error) throw error
    } catch (error) {
      console.error('Error toggling favorite:', error)
      alert('Não foi possível atualizar o favorito. Tenta novamente.')
    } finally {
      setFavoritingOn(null)
    }
  }

  const mySelfServeGroup = adminOrganizations.find((o) => o.self_serve)

  const handleCreateGroup = async () => {
    setCreateGroupError('')
    setCreatingGroup(true)
    try {
      await createSelfServeGroup(groupName.trim(), groupSlug.trim())
      // create_self_serve_group inserts the caller's admin membership
      // server-side — pull it into the client before navigating, otherwise
      // GerirClube's org resolver reads a stale memberships array and
      // bounces the brand-new creator to "Sem acesso" until a manual
      // reload. Same reason handleCreateGroup in GerirClube.jsx does this.
      await refreshMemberships()
      navigate(`/gerir/${groupSlug.trim()}`)
    } catch (err) {
      console.error('Error creating self-serve group:', err)
      const message = err?.message || ''
      if (message.includes('Já és admin de um grupo self-serve')) {
        setCreateGroupError('Já és admin de um grupo. Só podes criar um.')
      } else if (message.toLowerCase().includes('duplicate key value violates unique constraint') || message.toLowerCase().includes('slug')) {
        // organizations.slug is globally unique across clubs and groups, so
        // the collision can be with either — same wording GerirClube.jsx uses.
        setCreateGroupError('Já existe um clube ou grupo com este identificador — escolhe outro')
      } else {
        setCreateGroupError('Não foi possível criar o grupo. Tenta novamente.')
      }
    } finally {
      setCreatingGroup(false)
    }
  }

  const clubs = organizations.filter((o) => o.kind === 'club')

  const renderOrgRow = (org) => {
    const membership = memberships.find((m) => m.organization_id === org.id)
    const isFavorite = membership?.is_favorite === true
    return (
      <Link key={org.id} to={`/clube/${org.slug}`} className="card press flex items-center gap-3.5 hover:shadow-lift">
        <Avatar name={org.name} url={org.group_logo_url} size="w-11 h-11 text-sm" />
        <div className="flex-1 min-w-0">
          <h3 className="font-extrabold text-ink-900 truncate">{org.name}</h3>
          <p className="text-sm text-muted flex items-center gap-1.5">
            <Users size={13} /> {org.member_count} {org.member_count === 1 ? 'membro' : 'membros'}
          </p>
        </div>

        {org.my_status === 'member' ? (
          <>
            <button
              onClick={(e) => { e.preventDefault(); handleToggleFavorite(org, isFavorite) }}
              disabled={favoritingOn === org.id}
              aria-label={isFavorite ? 'Remover dos favoritos' : 'Marcar como favorito'}
              title={isFavorite ? 'Remover dos favoritos' : 'Marcar como favorito — os mixs deste clube aparecem primeiro em Próximos jogos'}
              className="shrink-0 w-11 h-11 min-h-[44px] rounded-full flex items-center justify-center transition-colors duration-fast disabled:opacity-40 hover:bg-ink-50"
            >
              <Heart size={20} className={isFavorite ? 'fill-lime-400 text-lime-400' : 'text-ink-200'} />
            </button>
            <button
              onClick={(e) => { e.preventDefault(); handleUnfollow(org) }}
              disabled={actingOn === org.id}
              className="whitespace-nowrap text-xs font-extrabold px-3 py-2 min-h-[44px] rounded-full bg-ink-50 text-ink-700 hover:bg-ink-200 transition-colors duration-fast disabled:opacity-40"
            >
              A seguir
            </button>
          </>
        ) : org.my_status === 'pending' ? (
          <span className="whitespace-nowrap inline-flex items-center gap-1.5 text-xs font-extrabold px-3 py-2 rounded-full bg-ink-50 text-muted">
            <Clock size={14} /> Pedido enviado
          </span>
        ) : (
          <button
            onClick={(e) => { e.preventDefault(); handleFollow(org) }}
            disabled={actingOn === org.id}
            className="whitespace-nowrap inline-flex items-center gap-1.5 text-xs font-extrabold px-3.5 py-2 min-h-[44px] rounded-full bg-lime-400 text-ink-900 hover:bg-lime-600 transition-colors duration-fast disabled:opacity-40"
          >
            <UserPlus size={14} />
            {org.open_join ? 'Seguir' : 'Pedir para entrar'}
          </button>
        )}
      </Link>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-3xl text-ink-900">Comunidade</h2>
        <p className="text-muted text-sm mt-0.5">
          {tab === 'teachers'
            ? teachersLoading
              ? 'A carregar…'
              : `${otherTeachers.length} professor${otherTeachers.length === 1 ? '' : 'es'} na comunidade`
            : loading
            ? 'A carregar…'
            : tab === 'players'
            ? `${players.length} jogador${players.length === 1 ? '' : 'es'} na comunidade`
            : `${organizations.length} clube${organizations.length === 1 ? '' : 's'} na comunidade`}
        </p>
      </div>

      {mySelfServeGroup ? (
        <Link to={`/gerir/${mySelfServeGroup.slug}`} className="card press flex items-center gap-3.5 hover:shadow-lift">
          <Avatar name={mySelfServeGroup.name} url={mySelfServeGroup.group_logo_url} size="w-11 h-11 text-sm" />
          <div className="flex-1 min-w-0">
            <h3 className="font-extrabold text-ink-900 truncate">{mySelfServeGroup.name}</h3>
            <p className="text-sm text-muted">O meu grupo</p>
          </div>
        </Link>
      ) : (
        <div className="card space-y-4">
          {!showCreateGroupForm ? (
            <button
              type="button"
              onClick={() => setShowCreateGroupForm(true)}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              <Plus size={18} />
              Criar o meu grupo
            </button>
          ) : (
            <>
              <h3 className="font-extrabold text-ink-900">Criar o meu grupo</h3>
              <p className="text-sm text-gray-500">
                Até 30 membros, 3 mixes ativos em simultâneo, 4 campos por mix. Sem pagamentos.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Nome</label>
                <input
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  className="input-field"
                  placeholder="ex: Os Sextas-Feiras"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Slug</label>
                <input
                  type="text"
                  value={groupSlug}
                  onChange={(e) => setGroupSlug(sanitizeSlug(e.target.value))}
                  className="input-field"
                  placeholder="ex: os-sextas-feiras"
                />
              </div>

              {createGroupError && (
                <div className="bg-danger/10 text-danger px-4 py-3 rounded-ctrl text-sm font-extrabold">{createGroupError}</div>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleCreateGroup}
                  disabled={!groupName.trim() || !groupSlug.trim() || creatingGroup}
                  className="btn-primary flex-1 disabled:opacity-40"
                >
                  {creatingGroup ? 'A criar…' : 'Criar grupo'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowCreateGroupForm(false); setGroupName(''); setGroupSlug(''); setCreateGroupError('') }}
                  disabled={creatingGroup}
                  className="flex-1 text-sm font-extrabold px-3 py-2 min-h-[44px] rounded-full bg-ink-50 text-ink-700 hover:bg-ink-200 transition-colors duration-fast disabled:opacity-40"
                >
                  Cancelar
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {tab !== 'teachers' && (
        <div className="flex items-center gap-2 input-field">
          <Search size={16} className="text-muted shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Procurar jogador ou clube..."
            className="flex-1 bg-transparent outline-none text-sm"
          />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-ink-50 rounded-ctrl">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-2.5 rounded-ctrl text-sm font-extrabold transition-all duration-fast ${
              tab === t.key ? 'bg-canvas text-ink-900 shadow-lift border border-line' : 'text-muted hover:text-ink-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'teachers' ? (
        teachersLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
          </div>
        ) : (
          <div className="space-y-3">
            {myTeacherProfile ? (
              <div className="card space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-extrabold text-ink-900">{myTeacherProfile.organization?.name}</h3>
                    <p className="text-sm text-muted">
                      {myTeacherProfile.status === 'pending' ? 'Pedido pendente' : 'Aprovado'}
                    </p>
                  </div>
                  <button
                    onClick={() => handleWithdrawTeacher(myTeacherProfile.id)}
                    disabled={withdrawingTeacherId === myTeacherProfile.id}
                    className="text-sm font-extrabold px-3 py-2 min-h-[44px] rounded-full bg-ink-50 text-ink-700 hover:bg-ink-200 transition-colors duration-fast disabled:opacity-40"
                  >
                    Retirar
                  </button>
                </div>
              </div>
            ) : !showTeacherForm ? (
              <button
                type="button"
                onClick={() => setShowTeacherForm(true)}
                disabled={teachableOrgs.length === 0}
                className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-40"
              >
                <GraduationCap size={18} />
                Tornar-me professor
              </button>
            ) : (
              <div className="card space-y-4">
                <h3 className="font-extrabold text-ink-900">Tornar-me professor</h3>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Clube</label>
                  <select
                    value={teacherOrgId}
                    onChange={(e) => setTeacherOrgId(e.target.value)}
                    className="input-field"
                  >
                    <option value="">Seleciona um clube</option>
                    {teachableOrgs.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Contacto</label>
                  <input
                    type="text"
                    value={teacherContact}
                    onChange={(e) => setTeacherContact(e.target.value)}
                    className="input-field"
                    placeholder="ex: WhatsApp 9XX XXX XXX, @instagram..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Disponibilidade</label>
                  <div className="space-y-2">
                    {teacherSlots.map((slot, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <select
                          value={slot.day}
                          onChange={(e) => handleSlotChange(i, 'day', e.target.value)}
                          className="input-field flex-1"
                        >
                          {DAYS.map((d) => (
                            <option key={d.value} value={d.value}>{d.label}</option>
                          ))}
                        </select>
                        <input
                          type="time"
                          value={slot.start}
                          onChange={(e) => handleSlotChange(i, 'start', e.target.value)}
                          className="input-field w-28"
                        />
                        <input
                          type="time"
                          value={slot.end}
                          onChange={(e) => handleSlotChange(i, 'end', e.target.value)}
                          className="input-field w-28"
                        />
                        {teacherSlots.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveSlot(i)}
                            aria-label="Remover horário"
                            className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full text-muted hover:bg-ink-50"
                          >
                            <X size={16} />
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={handleAddSlot}
                      className="text-sm font-extrabold text-ink-700 hover:text-ink-900"
                    >
                      + Adicionar horário
                    </button>
                  </div>
                </div>

                {teacherError && (
                  <div className="bg-danger/10 text-danger px-4 py-3 rounded-ctrl text-sm font-extrabold">{teacherError}</div>
                )}

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={handleRequestTeacher}
                    disabled={submittingTeacher}
                    className="btn-primary flex-1 disabled:opacity-40"
                  >
                    {submittingTeacher ? 'A enviar…' : 'Enviar pedido'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowTeacherForm(false); setTeacherError('') }}
                    disabled={submittingTeacher}
                    className="flex-1 text-sm font-extrabold px-3 py-2 min-h-[44px] rounded-full bg-ink-50 text-ink-700 hover:bg-ink-200 transition-colors duration-fast disabled:opacity-40"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {otherTeachers.length === 0 ? (
              <EmptyState
                icon={GraduationCap}
                title="Ainda não há professores"
                subtitle="Os professores aprovados nos teus clubes aparecem aqui."
              />
            ) : (
              otherTeachers.map((t) => (
                <div key={t.id} className="card space-y-2">
                  <div className="flex items-center gap-3">
                    <Avatar name={t.user?.name} url={t.user?.avatar_url} size="w-11 h-11 text-sm" />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-extrabold text-ink-900 truncate">{t.user?.name}</h3>
                      <p className="text-[11px] font-extrabold uppercase tracking-widest text-lime-700 truncate">
                        {t.organization?.name}
                      </p>
                    </div>
                  </div>
                  <p className="text-sm text-ink-900">{t.contact}</p>
                  {t.availability?.length > 0 && (
                    <p className="text-sm text-muted">
                      {t.availability
                        .map((a) => `${DAY_LABEL[a.day_of_week]} ${a.start_time.slice(0, 5)}-${a.end_time.slice(0, 5)}`)
                        .join(' • ')}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        )
      ) : loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
        </div>
      ) : tab === 'players' ? (
        players.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Nenhum jogador encontrado"
            subtitle={query.trim() ? 'Tenta outro nome.' : 'Ainda não há jogadores na comunidade.'}
          />
        ) : (
          <div className="card p-0 overflow-hidden divide-y divide-line">
            {players.map((player) => (
              <Link
                key={player.id}
                to={`/jogador/${player.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors duration-fast hover:bg-ink-50"
              >
                <Avatar name={player.name} url={player.avatar_url} size="w-10 h-10 text-sm" />
                <div className="flex-1 min-w-0">
                  <p className="font-extrabold text-ink-900 text-sm truncate">{player.name}</p>
                  {player.club_names && (
                    <p className="text-[11px] font-extrabold uppercase tracking-widest text-lime-700 truncate mt-0.5">
                      {player.club_names}
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )
      ) : clubs.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nada encontrado"
          subtitle={query.trim() ? 'Tenta outro nome.' : 'Ainda não há clubes na comunidade.'}
        />
      ) : (
        <div className="space-y-3">{clubs.map(renderOrgRow)}</div>
      )}
    </div>
  )
}
