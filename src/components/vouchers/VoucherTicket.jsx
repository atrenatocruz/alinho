import { useTranslation } from 'react-i18next'

/* O voucher na carteira do Perfil, no desenho novo (R7, design-handoff/
   2026-10-13-redesign, aprovado pelo Francisco a 13 out): uma faixa preta com
   a letra lima («VOUCHER · <CLUBE>»), o prémio em grande, de onde veio e
   «Ver o QR» a lima. O que o VoucherCard já fazia continua: o convite a
   partilhar o contacto (#556) e «Usar». Os usados ficam por baixo, apagados. */
export default function VoucherTicket({ prizeText, gameTitle, gameDate, organizationName, status, usedAtLabel,
  onMarkUsed, onShowQR, needsConsent = false, shared = false, onAccept, onUnshare }) {
  const { t } = useTranslation()
  const used = status === 'usado'
  return (
    <div className={`overflow-hidden rounded-card border border-line bg-white ${used ? 'opacity-60' : 'shadow-card'}`}>
      <div className="flex items-center justify-between gap-2 bg-ink-900 px-3.5 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-lime-400">
        <span className="truncate">{t('vouchers.r7_strip', { club: organizationName })}</span>
        <span className="shrink-0">{t(`profile.voucher_status_${status}`)}</span>
      </div>
      <div className="p-3.5">
        <p className="font-display text-2xl font-extrabold leading-tight text-ink-900">{prizeText || gameTitle}</p>
        <p className="mt-1 text-sm text-muted">
          {t('vouchers.r7_from', { game: gameTitle, date: gameDate })}{!used ? ` ${t('vouchers.r7_show_qr')}` : ''}
        </p>
        {!used ? (
          <>
            {needsConsent && (
              <div className="mt-3 flex items-start justify-between gap-3 text-xs">
                <span className="text-muted">{t('vouchers.consent_invite', { club: organizationName })}</span>
                <button type="button" onClick={onAccept} className="shrink-0 font-extrabold text-ink-900 underline underline-offset-2">
                  {t('vouchers.see_accept')}
                </button>
              </div>
            )}
            {shared && (
              <div className="mt-3 flex items-start justify-between gap-3 text-xs">
                <span className="text-ok-700">✓ {t('vouchers.shared_with', { club: organizationName })}</span>
                <button type="button" onClick={onUnshare} className="shrink-0 font-extrabold text-ink-900 underline underline-offset-2">
                  {t('vouchers.unshare')}
                </button>
              </div>
            )}
            <button type="button" onClick={onShowQR}
              className="mt-3 flex min-h-[48px] w-full items-center justify-center rounded-ctrl bg-lime-400 px-4 font-extrabold text-ink-900">
              {t('vouchers.r7_see_qr')}
            </button>
            <button type="button" onClick={onMarkUsed}
              className="mt-2 flex min-h-[44px] w-full items-center justify-center text-sm font-extrabold text-ink-700 underline underline-offset-2">
              {t('vouchers.r7_mark_used')}
            </button>
          </>
        ) : (
          <p className="mt-2 text-xs text-muted">{t('profile.voucher_used_at', { date: usedAtLabel })}</p>
        )}
      </div>
    </div>
  )
}
