// Criar um torneio numa página só do formulário (ponto 0 da revisão de 26 set,
// pedido do Francisco: «Eu queria abrir numa nova página só com o evento. Não
// queria por baixo. Isso é muito ruído.»). Endereço próprio —
// /gerir/:slug/criar/torneio —, sem o cabeçalho do Gerir, sem separadores e
// sem a lista de eventos. O «voltar» do telemóvel regressa ao Gerir.
//
// Editar um torneio já abre numa página só do formulário, na página do próprio
// torneio (?admin=editar): não precisa de outra.
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { createTournament, setTournamentStatus } from '../lib/tournamentApi'
import { describeError } from '../lib/errors'
import CreateTournamentForm from '../components/tournament/CreateTournamentForm'
import { EmptyState } from '../components/ui'

export default function CreateTournamentPage() {
  const { slug } = useParams()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { memberships, profile: currentUser } = useAuth()
  const [org, setOrg] = useState(undefined) // undefined = a carregar; null = sem acesso
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const mine = memberships?.find((m) => m.organization?.slug === slug && m.is_admin)
    if (mine) { setOrg(mine.organization); return undefined }
    if (!currentUser?.is_platform_admin) { setOrg(null); return undefined }
    // O admin da plataforma pode não ser membro: lê-se o clube pelo endereço,
    // como no Gerir.
    supabase.from('organizations').select('*').eq('slug', slug).maybeSingle()
      .then(({ data }) => { if (!cancelled) setOrg(data || null) })
    return () => { cancelled = true }
  }, [memberships, currentUser, slug])

  const back = () => navigate(`/gerir/${slug}?tab=events`)

  const create = async (draft) => {
    setSaving(true)
    setError('')
    try {
      const id = await createTournament(org.id, draft)
      // O create_tournament grava sempre em rascunho: «Abrir inscrições» é um
      // segundo passo (como no Gerir). Se só este falhar, o torneio já existe
      // — abre-se a página dele na mesma, onde a barra diz que está em
      // rascunho, em vez de ficar aqui e criar um segundo ao carregar outra vez.
      if (draft.status === 'inscricoes' && id) {
        try { await setTournamentStatus(id, 'inscricoes') } catch (err) { console.error('Error opening entries:', err) }
      }
      // Guardar abre a página do torneio criado (revisão de 26 set, ponto 0).
      navigate(id ? `/torneio/${id}` : `/gerir/${slug}?tab=events`, { replace: true })
    } catch (err) {
      setError(describeError(t, err))
    } finally {
      setSaving(false)
    }
  }

  if (org === undefined) {
    return <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-8 w-8 border-[3px] border-ink-50 border-t-ink-700" /></div>
  }
  if (!org) {
    return <EmptyState title={t('gerirclube.no_access_title')} />
  }
  return (
    <CreateTournamentForm
      club={{ id: org.id, name: org.name, location: org.location }}
      saving={saving}
      error={error}
      onCancel={back}
      onCreate={create}
    />
  )
}
