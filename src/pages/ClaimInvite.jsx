import { useEffect, useState } from 'react'
import { useNavigate, useParams, useLocation, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import { PrimaryButton, EmptyState } from '../components/ui'
import Alino from '../components/Alino'
import { claimPartnerInvite, getPartnerInvite, getInviteLinkStatus } from '../lib/partnerInvite'
import { claimEntry } from '../lib/tournamentSignup'
import { claimFriendMatchInvite } from '../lib/privateMatches'
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
  const { pathname } = useLocation()
  const isTournament = pathname.startsWith('/convite-torneio')
  // E o do jogo entre amigos, que chega por email (#342, 2.ª entrega).
  const isFriends = pathname.startsWith('/convite-amigos')
  // Para onde a pessoa tem de voltar depois de criar a conta. Ia por
  // `state: { next }` do react-router, que o Login.jsx nunca leu — e que
  // nem sobreviveria à ida ao email para confirmar a conta. Mesmo buraco
  // do botao da pagina do torneio (Trello #454, ponto 3).
  const claimPath = isTournament ? `/convite-torneio/${token}` : isFriends ? `/convite-amigos/${token}` : `/convite/${token}`
  const { user } = useAuth()
  const { t } = useTranslation()
  const navigate = useNavigate()
  // Sem sessão, primeiro vê-se se o link ainda vale ('peeking'): um código
  // que não existe dizia «Guardaram-te um lugar» e «Criar conta» (PO, 13 out).
  const [state, setState] = useState(user ? 'claiming' : 'peeking')
  const [error, setError] = useState('')
  const [invalid, setInvalid] = useState(null) // 'not_found' | 'claimed' | 'expired'
  useEffect(() => {
    if (user || !token) return undefined
    let cancelled = false
    getInviteLinkStatus(isTournament ? 'tournament' : isFriends ? 'friends' : 'mix', token).then((status) => {
      if (cancelled) return
      if (status && status !== 'pending') { setInvalid(['claimed', 'expired'].includes(status) ? status : 'not_found'); setState('invalid') }
      else setState('signed_out')
    })
    return () => { cancelled = true }
  }, [user, token, isTournament, isFriends])
  // Convite de parceiro num mix: antes de aceitar, «É para X. És tu?»
  // (Francisco, 26 set). Aconteceu duas vezes: quem criou o convite aceitou-o
  // ele próprio, e um convite para o José foi aceite pelo João.
  const isMix = !isTournament && !isFriends
  const [invite, setInvite] = useState(null)
  const [confirmed, setConfirmed] = useState(false)

  useEffect(() => {
    if (!user || !token || !isMix) return
    let cancelled = false
    setState('checking')
    getPartnerInvite(token)
      .then((inv) => {
        if (cancelled) return
        if (!inv) { setConfirmed(true); return } // função ainda por correr: como antes
        if (inv.status && inv.status !== 'pending') {
          setError(t(`partner.claim_error_invite_${inv.status === 'claimed' ? 'claimed' : inv.status === 'expired' ? 'expired' : 'not_found'}`))
          setState('error')
          return
        }
        setInvite(inv)
        setState('confirm')
      })
      .catch((err) => {
        if (cancelled) return
        console.error('Error reading partner invite:', err)
        setConfirmed(true)
      })
    return () => { cancelled = true }
  }, [user, token, isMix, t])

  useEffect(() => {
    if (!user || !token) return
    if (isMix && !confirmed) return
    let cancelled = false
    setState('claiming')
    ;(isTournament ? claimEntry(token) : isFriends ? claimFriendMatchInvite(token) : claimPartnerInvite(token))
      .then((id) => {
        if (cancelled) return
        // Torneio: a página diz «Ficaste em dupla com …» — antes juntava a
        // dupla sem dizer nada (ensaio do QA, 2 out).
        navigate(isTournament ? `/torneio/${id}` : isFriends ? `/jogos-privados/sessao/${id}` : `/jogo/${id}`,
          { replace: true, state: isTournament ? { claimed: true } : undefined })
      })
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
        // As funções do jogo entre amigos recusam com a frase já escrita.
        if (isFriends && err?.code === 'P0001' && err?.message) setError(err.message)
        else setError(found ? t(found) : t('partner.claim_error_generic'))
        setState('error')
      })
    return () => { cancelled = true }
  }, [user, token, navigate, t, isTournament, isFriends, isMix, confirmed])

  if (state === 'peeking') return null
  // Link que já não vale, sem sessão: como o /m/ com um código errado —
  // o Alino, «Este link já não é válido», «Ir para o início» e «Entrar».
  // Já aceite (UX, 13 out): o link não está estragado e quem aceitou tem
  // conta — «Este convite já foi aceite», com «Entrar» à frente.
  if (state === 'invalid') {
    const claimed = invalid === 'claimed'
    const home = <Link to="/" className={`${claimed ? 'btn-secondary' : 'btn-primary'} w-full inline-flex items-center justify-center`}>{t('notfound.go_home')}</Link>
    const login = <Link to="/login" className={`${claimed ? 'btn-primary' : 'btn-secondary'} w-full inline-flex items-center justify-center`}>{t('landing.login_link')}</Link>
    return (
      <div className="p-4 max-w-md mx-auto">
        <EmptyState
          title={t(claimed ? 'partner.claim_claimed_title' : 'shortlink.invalid_title')}
          subtitle={t(claimed ? 'partner.claim_claimed_sub' : `partner.claim_error_invite_${invalid}`)}
          action={<div className="flex flex-col gap-2 max-w-xs mx-auto">{claimed ? <>{login}{home}</> : <>{home}{login}</>}</div>}
        />
      </div>
    )
  }

  return (
    <div className="p-4 max-w-md mx-auto space-y-4">
      <div className="card space-y-3 text-center">
        {/* A bola da alinho, não um emoji (o 🎾 aparecia como raqueta de
            badminton nalguns telemóveis — revisão do site, 13 out). */}
        <div className="flex justify-center"><Alino pose="ola" size={88} /></div>
        <h1 className="text-xl text-ink-900">{t(isTournament ? 'tsignup.claim_title' : isFriends ? 'friends.claim_title' : 'partner.claim_title')}</h1>

        {state === 'signed_out' && (
          <>
            <p className="text-sm text-muted">{t('partner.claim_signed_out')}</p>
            <PrimaryButton onClick={() => navigate(signUpBackLink({ pathname: claimPath }))} className="w-full">
              {t('partner.claim_create_account')}
            </PrimaryButton>
          </>
        )}

        {state === 'confirm' && invite && (
          <>
            <p className="text-sm text-ink-900">{t('partner.claim_is_it_you', { name: invite.guest_name })}</p>
            {invite.game_title && <p className="text-xs text-muted">{invite.game_title}</p>}
            <PrimaryButton onClick={() => setConfirmed(true)} className="w-full">{t('partner.claim_yes')}</PrimaryButton>
            <button type="button" onClick={() => navigate(invite.game_id ? `/jogo/${invite.game_id}` : '/', { replace: true })}
              className="btn-secondary w-full">
              {t('partner.claim_no')}
            </button>
          </>
        )}

        {(state === 'claiming' || state === 'checking') && <p className="text-sm text-muted">{t('partner.claim_working')}</p>}

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
