// «Editar jogo entre amigos» (editar e juntar sets, aprovado pelo Francisco a
// 27 set): os mesmos 4 passos do criar, com o jogo como está. Só quem criou.
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import { getFriendMatch } from '../lib/privateMatches'
import { describeError } from '../lib/errors'
import { EmptyState } from '../components/ui'
import CreateFriendMatch from './CreateFriendMatch'

export default function EditFriendMatch() {
  const { id } = useParams()
  const { t } = useTranslation()
  const { profile } = useAuth()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    getFriendMatch(id)
      .then(setData)
      .catch((err) => { console.error('Error loading friend match to edit:', err); setError(describeError(t, err)) })
  }, [id, t])

  if (error) return <EmptyState title={error} />
  if (!data) {
    return <div className="flex justify-center py-10"><div className="h-8 w-8 animate-spin rounded-full border-[3px] border-ink-50 border-t-ink-700" /></div>
  }
  // Quem criou, ou quem disse «Vou» com o nome (SPEC 2026-10-07-amigos-convidado).
  const mine = (data.invitees || []).some((i) => i.user_id && i.user_id === profile?.id
    && (i.is_creator || (i.status === 'accepted' && !i.is_anonymous)))
  if (!mine) return <EmptyState title={t('friends.edit_error_not_allowed')} />
  // Jogo de grupo (#586): juntar pessoas procura só nos membros do grupo,
  // como no criar. O grupo vem na get_friend_match (Dev 3); sem ele, como antes.
  const m = data.match || {}
  const group = m.organization_id ? { id: m.organization_id, slug: m.organization_slug, name: m.organization_name, kind: m.organization_kind } : null
  return <CreateFriendMatch edit={data} group={group} />
}
