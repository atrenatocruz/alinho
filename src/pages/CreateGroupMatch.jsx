// Criar um jogo de grupo (#342). Com o interruptor 'friend_invites' ligado,
// é o desenho do jogo entre amigos novo — convidar primeiro, equipas depois —
// com a pesquisa só entre os membros do grupo (versão final de 26 set:
// «o jogo de grupo é este desenho»). Desligado, os 3 lugares de hoje.
import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useFeatureFlag } from '../lib/useFeatureFlag'
import { getClubProfile } from '../lib/clubProfile'
import CreateFriendMatch from './CreateFriendMatch'
import StepSkeleton from '../components/steps/StepSkeleton'
import CreateGroupMatchSlots from './CreateGroupMatchSlots'

export default function CreateGroupMatch() {
  const { slug } = useParams()
  const { on, loading } = useFeatureFlag('friend_invites')
  const [org, setOrg] = useState(null)
  // Só quem organiza cria jogos (Francisco, 29 out): quem não é admin, vindo
  // por um link antigo, volta à lista de jogos. Como no GroupMatches.
  const { profile, memberships } = useAuth()
  const isOrgAdmin = !!(memberships || []).find((m) => m.organization?.slug === slug)?.is_admin || !!profile?.is_platform_admin
  useEffect(() => {
    if (!on) return
    getClubProfile(slug).then(setOrg).catch((err) => console.error('Error loading club profile:', err))
  }, [on, slug])
  if (!isOrgAdmin) return <Navigate to={`/clube/${slug}/jogos`} replace />
  if (loading || (on && !org)) {
    return <StepSkeleton fallback="/gerir" />
  }
  return on ? <CreateFriendMatch group={{ id: org.id, slug, name: org.name, kind: org.kind }} /> : <CreateGroupMatchSlots />
}
