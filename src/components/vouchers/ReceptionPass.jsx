import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Avatar } from '../ui'
import { localeOf } from '../../lib/formatDate'

/* «Mostrar na receção» (design-handoff/2026-10-18-parceiros-primeiro, SPEC-UX
   ponto 4, aprovado pelo Francisco a 18 out). Abre a partir do voucher de um
   parceiro em «Os meus vouchers». Um cartão branco com uma faixa lima e preta
   que se MEXE (para a receção ver que não é uma captura de ecrã), a foto com
   o anel lima, o nome, «✓ Joga no alinho.pt», o desconto em grande, o código
   e a hora a correr. Quem marca como usado é a pessoa, no telemóvel dela, à
   frente da receção (Dev 3: mark_voucher_used, a receção não tem conta). */
export default function ReceptionPass({ voucher, person, onClose, onMarkUsed }) {
  const { t, i18n } = useTranslation()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  const loc = localeOf(i18n.language)
  const month = voucher.prize_month ? new Date(`${String(voucher.prize_month).slice(0, 10)}T12:00:00`) : null
  const validUntil = voucher.valid_until ? new Date(`${String(voucher.valid_until).slice(0, 10)}T12:00:00`) : null
  const day = now.toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'long' })
  const time = now.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={t('reception.title')}
      className="fixed inset-0 z-[60] overflow-y-auto bg-[#F1F2EE] animate-fade-in">
      <style>{'@keyframes alinho-stripe{from{background-position:0 0}to{background-position:40px 0}}'}</style>
      <div className="mx-auto max-w-md px-4 pb-10" style={{ paddingTop: 'calc(var(--safe-top, env(safe-area-inset-top)) + 12px)' }}>
        <div className="flex items-center">
          <button type="button" onClick={onClose} aria-label={t('ui.close')}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-ink-900 shadow-card">
            <X size={20} />
          </button>
          <p className="flex-1 pr-11 text-center font-display text-[16px] font-extrabold text-ink-900">{t('reception.title')}</p>
        </div>

        <div className="mt-5 overflow-hidden rounded-[22px] bg-white shadow-card">
          {/* A faixa que se mexe: prova que não é uma captura de ecrã. */}
          <div aria-hidden="true" className="h-3"
            style={{ backgroundImage: 'repeating-linear-gradient(90deg,#C5DD01 0 20px,#0A0A0A 20px 40px)', animation: 'alinho-stripe 0.8s linear infinite' }} />
          <div className="px-5 pb-5 pt-5 text-center">
            <span className="mx-auto inline-block rounded-full p-[3px] shadow-[0_0_0_3px_#C5DD01]">
              <Avatar name={person?.name} url={person?.avatar_url} size="w-24 h-24 text-3xl" colorClass="bg-lime-400 text-ink-900" />
            </span>
            <p className="mt-3 font-display text-[24px] font-black leading-tight text-ink-900">{person?.name}</p>
            <span className="mt-1.5 inline-flex rounded-full bg-[#F4F8DC] px-3 py-1 text-[13px] font-extrabold text-[#3F6212]">✓ {t('reception.plays')}</span>

            <p className="mt-5 font-display text-[64px] font-black leading-none tracking-[-0.03em] text-ink-900">{voucher.discount_pct}%</p>
            <p className="mt-1.5 font-display text-[16px] font-extrabold text-ink-900">{t('reception.discount_at', { partner: voucher.partner?.name })}</p>
            {voucher.prize_place && month && (
              <p className="mt-1 text-[13px] text-muted">
                {[t('reception.place_in', { place: voucher.prize_place, month: month.toLocaleDateString(loc, { month: 'long' }) }), voucher.prize_district].filter(Boolean).join(' · ')}
              </p>
            )}

            <p className="mt-5 rounded-[14px] bg-[#F4F5F1] px-4 py-4 font-mono text-[28px] font-bold tracking-[0.18em] text-ink-900">{voucher.code}</p>
            <p className="mt-4 text-[13px] text-muted tabular-nums">{t('reception.today', { day, time })}</p>
            {validUntil && <p className="text-[13px] text-muted">{t('reception.valid_until', { date: validUntil.toLocaleDateString(loc, { day: 'numeric', month: 'long' }) })}</p>}
          </div>
        </div>

        <p className="mt-4 px-2 text-center text-[12.5px] leading-snug text-muted">{t('reception.hint')}</p>
        {voucher.status === 'por_usar' && onMarkUsed && (
          <>
          {/* Quem marca é a pessoa: só depois de a receção aplicar (UX, 18 out). */}
          <p className="mt-5 text-center text-[12.5px] text-muted">{t('reception.only_after')}</p>
          <button type="button" onClick={onMarkUsed}
            className="mt-2 flex min-h-[48px] w-full items-center justify-center rounded-ctrl border-[1.5px] border-ink-200 bg-white font-extrabold text-ink-900">
            {t('reception.mark_used')}
          </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
