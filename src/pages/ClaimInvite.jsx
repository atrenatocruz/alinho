import { useEffect, useState } from 'react'
import { useNavigate, useParams, useLocation, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import { PrimaryButton } from '../components/ui'
import { claimPartnerInvite } from '../lib/partnerInvite'
import { claimEntry } from '../lib/tournamentSignup'
import { signUpBackLink } from '../lib/loginLinks'
import { errorCode } from '../lib/tournamentError'

/* Ficar com o lugar que alguém guardou para mim num mix (Trello #339).

   Chego aqui por um link que me mandaram pelo WhatsApp (ou, quando o envio
   de emails existir, por email). Sem conta, vejo o convite e o caminho para
   me registar; com sessão iniciada, o lugar passa para a minha conta e vou
   direto ao mix. O link é o mesmo nos dois casos. */

export default function ClaimInvite() {
  const { token } = useParams()
  // O mesmo ecrã serve os dois convites: o do mix (/convite) e o do
  // torneio (/convite-torneio). Muda só a função e para onde se vai.
  const isTournament = useLocation().pathname.startsWith('/convite-torneio')
  // Para onde a pessoa tem de voltar depois de criar a conta. Ia por
  // `state: { next }` do react-router, que o Login.jsx nunca leu — e que
  // nem sobreviveria à ida ao email para confirmar a conta. Mesmo buraco
  // do botao da pagina do torneio (Trello #454, ponto 3).
  const claimPath = isTournament ? `/convite-torneio/${token}` : `/convite/${token}`
  const { user } = useAuth()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [state, setState] = useState(user ? 'claiming' : 'signed_out')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user || !token) return
    let cancelled = false
    setState('claiming')
    ;(isTournament ? claimEntry(token) : claimPartnerInvite(token))
      .then((id) => { if (!cancelled) navigate(isTournament ? `/torneio/${id}` : `/jogo/${id}`, { replace: true }) })
      .catch((err) => {
        if (cancelled) return
        console.error('Error claiming partner invite:', err)
        // Torneio: primeiro o texto próprio do convite, depois o da inscrição
        // (tsignup.error_*: «esse convite é teu», máximo de categorias, …),
        // e só no fim o genérico — antes quase tudo caía no «tenta outra vez».
        // O código vem no fim da mensagem, mesmo quando o servidor lhe junta
        // texto à frente (os avisos das regras novas, b417e61) — #497.
        const code = errorCode(err)
        const ns = isTournament ? 'tsignup' : 'partner'
        const keys = [`${ns}.claim_error_${code}`]
        if (isTournament) keys.push(`tsignup.error_${code}`)
        const found = keys.find((k) => t(k) !== k)
        setError(found ? t(found) : t('partner.claim_error_generic'))
        setState('error')
      })
    return () => { cancelled = true }
  }, [user, token, navigate, t, isTournament])

  return (
    <div className="p-4 max-w-md mx-auto space-y-4">
      <div className="card space-y-3 text-center">
        <p className="text-2xl">🎾</p>
        <h1 className="text-xl text-ink-900">{t(isTournament ? 'tsignup.claim_title' : 'partner.claim_title')}</h1>

        {state === 'signed_out' && (
          <>
            <p className="text-sm text-muted">{t('partner.claim_signed_out')}</p>
            <PrimaryButton onClick={() => navigate(signUpBackLink({ pathname: claimPath }))} className="w-full">
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
