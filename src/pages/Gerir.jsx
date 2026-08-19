import { useEffect, useState } from 'react'
import { Navigate, Link, useNavigate } from 'react-router-dom'
import { Settings, Plus } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { Avatar, EmptyState, PrimaryButton } from '../components/ui'
import PlayerSearch from '../components/PlayerSearch'
import { searchAnyPlayer, createOrganization } from '../lib/platformAdmin'

const sanitizeSlug = (value) => value.toLowerCase().replace(/[^a-z0-9-]/g, '')

export default function Gerir() {
  const { profile, adminOrganizations } = useAuth()
  const navigate = useNavigate()
  const isPlatformAdmin = !!profile?.is_platform_admin

  const [showCreateForm, setShowCreateForm] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [selectedAdmin, setSelectedAdmin] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [createdClub, setCreatedClub] = useState(null)
  // Platform admins pick from every club, not just ones they already
  // belong to — RLS lets them read the whole organizations table (see
  // migration_platform_admin_full_access.sql); membership itself is only
  // granted on-demand, when they actually open a specific club's Gerir page.
  const [allOrganizations, setAllOrganizations] = useState([])

  useEffect(() => {
    if (!isPlatformAdmin) return
    supabase
      .from('organizations')
      .select('*')
      .order('name')
      .then(({ data, error }) => {
        if (error) {
          console.error('Error loading all organizations:', error)
          return
        }
        setAllOrganizations(data || [])
      })
  }, [isPlatformAdmin])

  const clubsToShow = isPlatformAdmin ? allOrganizations : adminOrganizations

  if (adminOrganizations.length === 1 && !isPlatformAdmin) {
    return <Navigate to={`/gerir/${adminOrganizations[0].slug}`} replace />
  }

  const resetCreateForm = () => {
    setShowCreateForm(false)
    setName('')
    setSlug('')
    setSelectedAdmin(null)
    setError('')
  }

  const handleCreate = async () => {
    setError('')
    setSaving(true)
    try {
      const newSlug = slug.trim()
      await createOrganization(name.trim(), newSlug, selectedAdmin.id)
      // The appointed admin gets the only membership create_organization
      // creates (see migration_platform_admin_create_organization.sql) — if
      // that's someone else, the platform admin has no membership to land
      // on and GerirClube would show "Sem acesso". Only navigate in when
      // they appointed themselves; otherwise confirm success right here.
      if (selectedAdmin.id === profile?.id) {
        navigate(`/gerir/${newSlug}`)
      } else {
        setCreatedClub({ name: name.trim(), adminName: selectedAdmin.name })
        resetCreateForm()
        if (isPlatformAdmin) {
          const { data } = await supabase.from('organizations').select('*').order('name')
          setAllOrganizations(data || [])
        }
      }
    } catch (err) {
      console.error('Error creating organization:', err)
      const message = err?.message || ''
      if (message.toLowerCase().includes('duplicate key value violates unique constraint') || message.toLowerCase().includes('slug')) {
        setError('Já existe um clube com este identificador — escolhe outro')
      } else {
        setError('Não foi possível criar o clube. Tenta novamente.')
      }
    } finally {
      setSaving(false)
    }
  }

  const createClubPanel = isPlatformAdmin && (
    <div className="card space-y-4">
      {!showCreateForm ? (
        <PrimaryButton onClick={() => setShowCreateForm(true)} className="w-full">
          <Plus size={18} />
          Criar novo clube
        </PrimaryButton>
      ) : (
        <>
          <h3 className="font-extrabold text-ink-900">Criar novo clube</h3>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Nome</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input-field"
              placeholder="ex: Padel Clube Lisboa"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Slug</label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(sanitizeSlug(e.target.value))}
              className="input-field"
              placeholder="ex: padel-clube-lisboa"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Admin</label>
            <PlayerSearch
              label="Procurar jogador para ser admin..."
              searchFn={searchAnyPlayer}
              selected={selectedAdmin}
              onSelect={setSelectedAdmin}
              onClear={() => setSelectedAdmin(null)}
            />
          </div>

          {error && (
            <div className="bg-danger/10 text-danger px-4 py-3 rounded-ctrl text-sm font-extrabold">{error}</div>
          )}

          <div className="flex gap-3">
            <PrimaryButton
              onClick={handleCreate}
              disabled={!name.trim() || !slug.trim() || !selectedAdmin || saving}
              className="flex-1"
            >
              {saving ? 'A criar…' : 'Criar clube'}
            </PrimaryButton>
            <PrimaryButton variant="ghost" onClick={resetCreateForm} disabled={saving} className="flex-1">
              Cancelar
            </PrimaryButton>
          </div>
        </>
      )}
    </div>
  )

  const createdClubBanner = createdClub && (
    <div className="card bg-lime-50 border border-lime-200 space-y-1">
      <p className="font-extrabold text-ink-900">Clube "{createdClub.name}" criado com sucesso!</p>
      <p className="text-sm text-muted">{createdClub.adminName} é agora admin deste clube.</p>
    </div>
  )

  if (clubsToShow.length === 0) {
    return (
      <div className="space-y-5">
        <EmptyState
          icon={Settings}
          title="Não geres nenhum clube"
          subtitle="Esta secção é para quem administra um clube ou grupo."
        />
        {createdClubBanner}
        {createClubPanel}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-3xl text-ink-900">Gerir</h2>
        <p className="text-muted text-sm mt-0.5">
          {isPlatformAdmin ? 'Escolhe o clube que queres gerir (és super admin — vês todos)' : 'Escolhe o clube que queres gerir'}
        </p>
      </div>

      {createdClubBanner}

      {createClubPanel}

      <div className="space-y-3">
        {clubsToShow.map((org) => (
          <Link key={org.id} to={`/gerir/${org.slug}`} className="card press flex items-center gap-3.5 hover:shadow-lift">
            <Avatar name={org.name} url={org.group_logo_url} size="w-11 h-11 text-sm" />
            <h3 className="font-extrabold text-ink-900 truncate">{org.name}</h3>
          </Link>
        ))}
      </div>
    </div>
  )
}
