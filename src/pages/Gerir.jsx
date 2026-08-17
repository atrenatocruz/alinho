import { Navigate, Link } from 'react-router-dom'
import { Settings } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { Avatar, EmptyState } from '../components/ui'

export default function Gerir() {
  const { adminOrganizations } = useAuth()

  if (adminOrganizations.length === 1) {
    return <Navigate to={`/gerir/${adminOrganizations[0].slug}`} replace />
  }

  if (adminOrganizations.length === 0) {
    return (
      <EmptyState
        icon={Settings}
        title="Não geres nenhum clube"
        subtitle="Esta secção é para quem administra um clube ou grupo."
      />
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-3xl text-ink-900">Gerir</h2>
        <p className="text-muted text-sm mt-0.5">Escolhe o clube que queres gerir</p>
      </div>

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
