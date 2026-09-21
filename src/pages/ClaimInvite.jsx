import { useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import { PrimaryButton } from '../components/ui'
import { claimPartnerInvite } from '../lib/partnerInvite'

/* Ficar com o lugar que alguém guardou para mim num mix (Trello #339).

   Chego aqui por um link que me mandaram pelo WhatsApp (ou, quando o envio
   de emails existir, por email). Sem conta, vejo o convite e o caminho para
   me registar; com sessão iniciada, o lugar passa para a minha conta e vou
   direto ao mix. O link é o mesmo nos dois casos. */

export default function ClaimInvite() {
  const { token } = useParams()
  const { user } = useAuth()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [state, setState] = useState(user ? 'claiming' : 'signed_out')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user || !token) return
    let cancelled = false
    setState('claiming')
    claimPartnerInvite(token)
      .then((gameId) => { if (!cancelled) navigate(`/jogo/${gameId}`, { replace: true }) })
      .catch((err) => {
        if (cancelled) return
        console.error('Error claiming partner invite:', err)
        const key = `partner.claim_error_${err.message}`
        setError(t(key) === key ? t('partner.claim_error_generic') : t(key))
        setState('error')
      })
    return () => { cancelled = true }
  }, [user, token, navigate, t])

  return (
    <div className="p-4 max-w-md mx-auto space-y-4">
      <div className="card space-y-3 text-center">
        <p className="text-2xl">🎾</p>
        <h1 className="text-xl text-ink-900">{t('partner.claim_title')}</h1>

        {state === 'signed_out' && (
          <>
            <p className="text-sm text-muted">{t('partner.claim_signed_out')}</p>
            <PrimaryButton onClick={() => navigate('/login', { state: { next: `/convite/${token}` } })} className="w-full">
              {t('partner.claim_create_account')}
            </PrimaryButton>
          </>
        )}

        {state === 'claiming' && <p className="text-sm text-muted">{t('partner.claim_working')}</p>}

        {state === 'error' && (
          <>
            <p className="text-sm text-red-600 font-extrabold">{error}</p>
            <Link to="/" className="text-sm font-extrabold text-ink-900 underline">{t('partner.claim_go_home')}</Link>
          </>
        )}
      </div>
    </div>
  )
}
