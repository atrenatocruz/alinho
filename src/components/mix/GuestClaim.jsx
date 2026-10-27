// «Sou eu» na linha de um convidado (design-handoff/2026-10-21-sou-eu,
// aprovado pelo Francisco a 21 out). Três peças:
//  · GuestClaimButton: «Sou eu» (pastilha com contorno) ou, já pedido,
//    «Pedido enviado» (pastilha cinzenta com a ampulheta; UX, 22 out: a
//    tira preta por cima já diz a quem foi).
//  · GuestClaimConfirm: a folha «És o X?» com o convidado numa caixa.
//  · GuestClaimAdminBox: para quem organiza, a caixa lima por baixo do
//    convidado com «Aceitar» (preto) e «Recusar» (contorno), empilhados.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Hourglass } from 'lucide-react'
import { Avatar, ConfirmSheet } from '../ui'
import { describeError } from '../../lib/errors'
import { guestClaimErrorCode } from '../../lib/guestClaims'

export const guestClaimErrorText = (t, err) => {
  const code = guestClaimErrorCode(err)
  return code ? t(`guestclaim.error_${code}`) : describeError(t, err, 'guestclaim.error')
}

export function GuestClaimButton({ pending, onClaim, disabled }) {
  const { t } = useTranslation()
  if (pending) {
    return (
      <span className="mt-1.5 inline-flex min-h-[32px] items-center gap-1.5 whitespace-nowrap rounded-full bg-[#F4F5F1] px-3 text-xs font-bold text-ink-700">
        <Hourglass size={14} strokeWidth={2} className="shrink-0" />
        {t('guestclaim.sent')}
      </span>
    )
  }
  return (
    <button type="button" onClick={onClaim} disabled={disabled}
      className="press mt-1.5 inline-flex h-8 items-center rounded-full border border-line bg-white px-3 text-xs font-extrabold text-ink-900">
      {t('guestclaim.action')}
    </button>
  )
}

export function GuestClaimConfirm({ guest, mixTitle, pairNumber, onConfirm, onClose }) {
  const { t } = useTranslation()
  return (
    <ConfirmSheet
      open={!!guest}
      title={guest ? t('guestclaim.confirm_title', { guest: guest.name }) : ''}
      message={t('guestclaim.confirm_message', { mix: mixTitle })}
      confirmLabel={t('guestclaim.confirm')}
      cancelLabel={t('guestclaim.cancel')}
      onConfirm={onConfirm}
      onClose={onClose}
      errorOf={(err) => guestClaimErrorText(t, err)}
    >
      {guest && (
        <div className="flex items-center gap-3 rounded-ctrl bg-[#F4F5F1] px-3.5 py-3">
          <Avatar name={guest.name} url={null} size="w-9 h-9 text-xs" />
          <div className="min-w-0">
            <p className="truncate text-sm font-extrabold text-ink-900">{guest.name}</p>
            <p className="text-[13px] text-muted">
              {pairNumber ? t('guestclaim.guest_pair', { n: pairNumber }) : t('guestclaim.guest')}
            </p>
          </div>
        </div>
      )}
    </ConfirmSheet>
  )
}

export function GuestClaimAdminBox({ claim, onAnswer }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(null) // 'accept' | 'decline'
  const [error, setError] = useState('')
  const answer = async (accept) => {
    setBusy(accept ? 'accept' : 'decline'); setError('')
    try {
      await onAnswer(claim, accept)
    } catch (err) {
      console.error('Error answering a guest claim:', err)
      setError(guestClaimErrorText(t, err))
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="mt-2.5 rounded-ctrl bg-[#F4F8DC] p-3">
      <div className="flex items-start gap-2.5">
        <Avatar name={claim.user_name} url={claim.avatar_url} size="w-8 h-8 text-[11px]" />
        <div className="min-w-0">
          <p className="text-sm font-extrabold text-ink-900">{t('guestclaim.admin_title', { name: claim.user_name })}</p>
          <p className="mt-0.5 text-[13px] text-ink-700">{t('guestclaim.admin_text')}</p>
        </div>
      </div>
      {error && <p className="mt-2 text-[13px] font-bold text-danger">{error}</p>}
      <div className="mt-3 space-y-2">
        <button type="button" onClick={() => answer(true)} disabled={!!busy}
          className="w-full min-h-[48px] rounded-ctrl bg-ink-900 px-4 text-[15px] font-extrabold text-white disabled:opacity-40">
          {t('guestclaim.accept')}
        </button>
        <button type="button" onClick={() => answer(false)} disabled={!!busy}
          className="w-full min-h-[48px] rounded-ctrl border-[1.5px] border-line bg-white px-4 text-[15px] font-extrabold text-ink-900 disabled:opacity-40">
          {t('guestclaim.decline')}
        </button>
      </div>
    </div>
  )
}
