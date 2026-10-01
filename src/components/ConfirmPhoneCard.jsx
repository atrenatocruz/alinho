import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageCircle, CheckCircle2, RefreshCw, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

/* Associar e confirmar o número por SMS, num cartão só (OTP clássico —
   decisão Ruben, 1 out 2026; substitui o fluxo invertido do #537 de mandar
   o código ao robô, que fica como alternativa só no lado do bot).

   Porquê: só números CONFIRMADOS contam para o match do «In» no bot
   (migration_mix_guest_sem_conta.sql). Quem associou antes da migração
   ficou confirmado de raiz; uma conta nova associa e confirma aqui.

   Dois passos:
   1. Número → edge function send-otp: grava só o hash (o número cru nunca
      é guardado), gera o código (start_phone_verification, 15 min, 5/h) e
      envia-o por SMS — o código nunca passa pelo browser.
   2. Código de 6 dígitos → RPC confirm_phone_with_code (máx. 5 tentativas
      por pedido) → confirmado, e as inscrições-convidado em mixes abertos
      feitas com este número passam para a conta.

   `dismissible`: na Home o cartão é um lembrete — dá para fechar até à
   próxima sessão. Na Informação Pessoal fica sempre. */
const DISMISS_KEY = 'confirmPhoneCard.dismissed'

export default function ConfirmPhoneCard({ compact = false, dismissible = false }) {
  const { t } = useTranslation()
  const { profile, retryProfile } = useAuth()
  const [step, setStep] = useState('phone') // 'phone' | 'code'
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === 'true' } catch { return false }
  })

  // Confirmado (ou mock de dev), o cartão desaparece sozinho.
  if (!profile || profile.phone_verified_at || profile.phone_hash === 'dev-bypass') return null
  if (dismissible && dismissed) return null

  const dismiss = () => {
    setDismissed(true)
    try { sessionStorage.setItem(DISMISS_KEY, 'true') } catch { /* modo privado */ }
  }

  const sendCode = async () => {
    if (phone.replace(/\D/g, '').length < 9) {
      setError(t('login.error_invalid_phone'))
      return
    }
    setBusy(true)
    setError('')
    try {
      const { error: fnError } = await supabase.functions.invoke('send-otp', { body: { phone } })
      if (fnError) {
        // O corpo da resposta diz porquê (invalid_phone, sms_failed, a
        // mensagem do limite 5/h do RPC…) — o FunctionsHttpError esconde-o
        // em context.
        let reason = null
        try { reason = (await fnError.context?.json())?.error ?? null } catch { /* sem corpo */ }
        console.error('send-otp failed:', reason || fnError)
        if (reason === 'invalid_phone') setError(t('login.error_invalid_phone'))
        else if (reason && /código|codigo|espera/i.test(reason)) setError(reason)
        else setError(t('phoneconfirm.error_send') + (reason ? ` (${reason})` : ''))
        return
      }
      setCode('')
      setStep('code')
    } catch (err) {
      console.error('send-otp failed:', err)
      setError(t('phoneconfirm.error_send'))
    } finally {
      setBusy(false)
    }
  }

  const confirmCode = async () => {
    if (code.trim().length !== 6) {
      setError(t('phoneconfirm.error_wrong_code'))
      return
    }
    setBusy(true)
    setError('')
    try {
      const { data, error: rpcError } = await supabase.rpc('confirm_phone_with_code', { p_code: code.trim() })
      if (rpcError) throw rpcError
      if (data?.ok) {
        retryProfile()
        return
      }
      if (data?.reason === 'too_many') {
        setError(t('phoneconfirm.error_too_many'))
        setStep('phone')
      } else if (data?.reason === 'phone_changed') {
        setError(t('phoneconfirm.error_phone_changed'))
        setStep('phone')
      } else {
        setError(t('phoneconfirm.error_wrong_code'))
      }
    } catch (err) {
      console.error('confirm_phone_with_code failed:', err)
      setError(t('phoneconfirm.error_generic'))
    } finally {
      setBusy(false)
    }
  }

  const pillButton = 'inline-flex items-center gap-1.5 text-xs font-extrabold px-3.5 py-2 min-h-[36px] rounded-full transition-colors duration-fast disabled:opacity-40'

  return (
    <div className={`relative rounded-ctrl border border-line ${compact ? 'bg-ink-50 p-3' : 'card'}`}>
      {dismissible && (
        <button
          type="button"
          onClick={dismiss}
          aria-label={t('phoneconfirm.dismiss_aria')}
          className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-full text-muted hover:text-ink-900"
        >
          <X size={14} />
        </button>
      )}
      <p className="flex items-center gap-2 text-sm font-extrabold text-ink-900 pr-7">
        <MessageCircle size={16} className="text-lime-600" /> {t('phoneconfirm.title_sms')}
      </p>
      <p className="mt-1 text-xs text-muted">
        {step === 'phone' ? t('phoneconfirm.body_sms') : t('phoneconfirm.body_code')}
      </p>

      {step === 'phone' ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <input
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t('login.phone_placeholder')}
            className="input-field flex-1 min-w-[12rem]"
          />
          <button onClick={sendCode} disabled={busy} className={`${pillButton} bg-lime-400 text-ink-900 hover:bg-lime-600`}>
            {busy ? <RefreshCw size={14} className="animate-spin" /> : <MessageCircle size={14} />} {t('phoneconfirm.send_code')}
          </button>
        </div>
      ) : (
        <div className="mt-2.5 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder={t('phoneconfirm.code_placeholder')}
              className="input-field w-32 font-mono tracking-[0.3em] text-center tabular-nums"
              autoFocus
            />
            <button onClick={confirmCode} disabled={busy || code.length !== 6} className={`${pillButton} bg-lime-400 text-ink-900 hover:bg-lime-600`}>
              {busy ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} {t('phoneconfirm.confirm_code')}
            </button>
          </div>
          <button type="button" onClick={sendCode} disabled={busy} className="text-xs font-extrabold text-muted hover:text-ink-900">
            {t('phoneconfirm.resend')}
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-danger font-extrabold">{error}</p>}
    </div>
  )
}
