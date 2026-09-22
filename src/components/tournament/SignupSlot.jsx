import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { PrimaryButton } from '../ui'
import { Sheet } from '../agenda/AgendaControls'
import { whatsappShare } from '../../lib/partnerInvite'
import TournamentSignupSheet from './TournamentSignupSheet'
import PublicInfo from './PublicInfo'
import {
  signUp, respondToInvite, listMyInvites, withdrawEntry,
  entriesOpen, categoriesLeft, tournamentInviteLink,
} from '../../lib/tournamentSignup'

/* O que fica por cima de tudo na página do torneio (Trello #362):
   inscrever a minha dupla, em que ponto está a minha inscrição, e o
   pedido do parceiro à minha espera.

   Mora no slot `top` de panels.js — é o sítio que o desenho dá ao
   "Inscrever a minha dupla" (logo debaixo do cartaz) e onde depois
   entram os avisos do organizador (Torneio 6/6, mesmo ficheiro). */

const STATE_KEY = {
  convite: 'tsignup.state_waiting_partner',
  sem_parceiro: 'tsignup.state_alone',
  por_validar: 'tsignup.state_to_validate',
  validada: 'tsignup.state_in',
  selecionada: 'tsignup.state_in',
  suplente: 'tsignup.state_waitlist',
}

export default function SignupSlot({ tournament, categories, category, my }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [invites, setInvites] = useState([])
  const [sheet, setSheet] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fresh, setFresh] = useState(null) // convite acabado de criar

  const reloadInvites = () => {
    if (!user) return
    listMyInvites()
      .then((rows) => setInvites(rows.filter((r) => r.tournament_id === tournament.id)))
      .catch((err) => console.error('Error loading tournament invites:', err))
  }
  useEffect(reloadInvites, [user, tournament.id])

  const open = entriesOpen(tournament, null)
  const left = categoriesLeft(tournament, my ? [my] : [])
  const say = (err) => {
    const key = `tsignup.error_${err?.message?.replace(/^.*?([a-z_]+)$/, '$1')}`
    setError(t(key) === key ? t('tsignup.error_generic') : t(key))
  }

  const doSignUp = async (choice) => {
    setBusy(true); setError('')
    try {
      const result = await signUp(choice)
      setSheet(false)
      if (result?.invite_token) setFresh({ name: choice.guestName, email: choice.guestEmail, token: result.invite_token })
      window.dispatchEvent(new CustomEvent('tournament:reload'))
    } catch (err) { console.error('Error signing up for tournament:', err); say(err) }
    finally { setBusy(false) }
  }

  const answer = async (entryId, accept) => {
    setBusy(true)
    try {
      await respondToInvite(entryId, accept)
      reloadInvites()
      window.dispatchEvent(new CustomEvent('tournament:reload'))
    } catch (err) { console.error('Error answering tournament invite:', err); say(err) }
    finally { setBusy(false) }
  }

  const leave = async () => {
    if (!window.confirm(t('tsignup.withdraw_confirm'))) return
    setBusy(true)
    try {
      await withdrawEntry(my.entry_id)
      window.dispatchEvent(new CustomEvent('tournament:reload'))
    } catch (err) { console.error('Error withdrawing from tournament:', err); say(err) }
    finally { setBusy(false) }
  }

  const link = fresh ? tournamentInviteLink(fresh.token, window.location.origin) : ''

  return (
    <div className="space-y-2.5">
      {/* Pedido do parceiro à minha espera — o mais urgente fica em cima. */}
      {invites.map((inv) => (
        <div key={inv.entry_id} className="card space-y-2">
          <p className="font-extrabold text-ink-900">{t('tsignup.invite_title', { name: inv.inviter_name })}</p>
          <p className="text-sm text-muted">
            {[inv.category_code, inv.respond_by ? t('tsignup.invite_deadline', { date: new Date(inv.respond_by).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' }) }) : null]
              .filter(Boolean).join(' · ')}
          </p>
          <div className="flex gap-2">
            <PrimaryButton onClick={() => answer(inv.entry_id, true)} disabled={busy} className="flex-1">
              {t('tsignup.invite_accept')}
            </PrimaryButton>
            <PrimaryButton variant="ghost" onClick={() => answer(inv.entry_id, false)} disabled={busy} className="flex-1 !bg-white !border-ink-900">
              {t('tsignup.invite_decline')}
            </PrimaryButton>
          </div>
        </div>
      ))}

      {/* A minha inscrição, ou o convite para me inscrever. */}
      {my ? (
        <div className="card flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-extrabold text-ink-900">{t(STATE_KEY[my.state] || 'tsignup.state_in')}</p>
            {my.state === 'suplente' && <p className="text-sm text-muted">{t('tsignup.state_waitlist_hint')}</p>}
          </div>
          {open && (
            <button onClick={leave} disabled={busy} className="press text-sm font-extrabold text-ink-900 underline shrink-0">
              {t('tsignup.withdraw')}
            </button>
          )}
        </div>
      ) : open && user ? (
        <PrimaryButton onClick={() => { setError(''); setSheet(true) }} disabled={left === 0} className="w-full">
          {left === 0 ? t('tsignup.max_categories') : t('tsignup.cta')}
        </PrimaryButton>
      ) : open && !user ? (
        // Sem conta vê-se tudo menos inscrever (SPEC §4.10).
        <PrimaryButton onClick={() => { window.location.href = '/login' }} className="w-full">
          {t('tsignup.cta_signed_out')}
        </PrimaryButton>
      ) : null}

      {error && !sheet && <p className="text-sm text-red-600 font-extrabold">{error}</p>}

      {/* O cartaz: categorias com dia, hora e vagas, pagamento, mapa e
          quem organiza. Enquanto houver inscrições é o que faz decidir;
          depois do sorteio quem manda são os separadores (Trello #363). */}
      {open && <PublicInfo tournament={tournament} categories={categories} />}

      {sheet && (
        <TournamentSignupSheet
          tournament={tournament}
          categories={categories}
          category={category}
          categoriesLeft={left}
          busy={busy}
          error={error}
          onConfirm={doSignUp}
          onClose={() => { setSheet(false); setError('') }}
        />
      )}

      {/* Inscreveu alguém sem conta: o link é como ele fica a saber. */}
      {fresh && (
        <Sheet title={t('tsignup.invite_ready_title')} onClose={() => setFresh(null)}>
          <div className="space-y-3">
            <p className="text-sm text-ink-900">{t('tsignup.invite_ready_body', { name: fresh.name })}</p>
            <p className="text-sm text-muted">
              {fresh.email ? t('partner.invite_ready_email', { email: fresh.email }) : t('partner.invite_ready_no_email')}
            </p>
            <div className="rounded-ctrl bg-ink-50 px-3 py-2 text-xs text-ink-900 break-all">{link}</div>
            <PrimaryButton
              onClick={() => window.open(whatsappShare(t('tsignup.invite_whatsapp_text', { name: fresh.name, title: tournament.name, link })), '_blank')}
              className="w-full"
            >
              {t('partner.invite_send_whatsapp')}
            </PrimaryButton>
            <PrimaryButton
              variant="ghost"
              onClick={() => navigator.clipboard?.writeText(link)}
              className="w-full !bg-white !border-ink-900"
            >
              <Copy size={18} /> {t('partner.invite_copy_link')}
            </PrimaryButton>
          </div>
        </Sheet>
      )}
    </div>
  )
}
