// Criar um jogo de grupo (#342). Com o interruptor 'friend_invites' ligado,
// é o desenho do jogo entre amigos novo — convidar primeiro, equipas depois —
// com a pesquisa só entre os membros do grupo (versão final de 26 set:
// «o jogo de grupo é este desenho»). Desligado, os 3 lugares de hoje.
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useFeatureFlag } from '../lib/useFeatureFlag'
import { getClubProfile } from '../lib/clubProfile'
import CreateFriendMatch from './CreateFriendMatch'
import CreateGroupMatchSlots from './CreateGroupMatchSlots'

export default function CreateGroupMatch() {
  const { slug } = useParams()
  const { on, loading } = useFeatureFlag('friend_invites')
  const [org, setOrg] = useState(null)
  useEffect(() => {
    if (!on) return
    getClubProfile(slug).then(setOrg).catch((err) => console.error('Error loading club profile:', err))
  }, [on, slug])
  if (loading || (on && !org)) {
    return <div className="flex justify-center py-10"><div className="h-8 w-8 animate-spin rounded-full border-[3px] border-ink-50 border-t-ink-700" /></div>
  }
  return on ? <CreateFriendMatch group={{ id: org.id, slug, name: org.name }} /> : <CreateGroupMatchSlots />
}
