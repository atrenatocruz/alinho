import { useState } from 'react'
import { Navigate, Link, useNavigate } from 'react-router-dom'
import { Settings, Plus } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
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

  if (adminOrganizations.length === 1 && !isPlatformAdmin) {
    return <Navigate to={`/gerir/${adminOrganizations[0].slug}`} replace />
  }

  const handleCreate = async () => {
    setError('')
    setSaving(true)
    try {
      const newSlug = slug.trim()
      await createOrganization(name.trim(), newSlug, selectedAdmin.id)
      navigate(`/gerir/${newSlug}`)
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

          <PrimaryButton
            onClick={handleCreate}
            disabled={!name.trim() || !slug.trim() || !selectedAdmin || saving}
            className="w-full"
          >
            {saving ? 'A criar…' : 'Criar clube'}
          </PrimaryButton>
        </>
      )}
    </div>
  )

  if (adminOrganizations.length === 0) {
    return (
      <div className="space-y-5">
        <EmptyState
          icon={Settings}
          title="Não geres nenhum clube"
          subtitle="Esta secção é para quem administra um clube ou grupo."
        />
        {createClubPanel}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-3xl text-ink-900">Gerir</h2>
        <p className="text-muted text-sm mt-0.5">Escolhe o clube que queres gerir</p>
      </div>

      {createClubPanel}

      <div className="space-y-3">
        {adminOrganizations.map((org) => (
          <Link key={org.id} to={`/gerir/${org.slug}`} className="card press flex items-center gap-3.5 hover:shadow-lift">
            <Avatar name={org.name} url={org.group_logo_url} size="w-11 h-11 text-sm" />
            <h3 className="font-extrabold text-ink-900 truncate">{org.name}</h3>
          </Link>
        ))}
      </div>
    </div>
  )
}
