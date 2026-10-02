import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageCircle, CheckCircle2, RefreshCw, X, Smartphone, Users } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

/* Confirmar o número, com prova de posse e sem estado «associado» (Ruben,
   1 out 2026 — migration_numero_numa_conta_so.sql): o número só entra na
   conta quando a posse fica provada, por um de dois canais:

   · SMS (send-otp → Vonage/Twilio): recebes o código e escreve-lo aqui.
   · Grupo do WhatsApp (grátis): a app mostra-te o código e escreves
     «Confirmar 482917» no grupo do teu clube — o robô (um contacto que o
     grupo já conhece, nada de DMs a números estranhos) valida e reage ✅.
     A prova é a mensagem SAIR do teu número; o código liga a sessão da
     app ao telemóvel (sem ele, qualquer pedido pendente de um atacante
     para o TEU número era abençoado por uma mensagem inocente tua).

   Um número vive numa conta só: pedir código para um número confirmado
   noutra conta real é recusado (phone_taken).

   `dismissible`: na Home o cartão é um lembrete — dá para fechar até à
   próxima sessão. Na Informação Pessoal fica sempre. */
const DISMISS_KEY = 'confirmPhoneCard.dismissed'

// `bare`: dentro do modal de primeira entrada (Layout), que já tem título
// e explicação próprios — o cartão larga o cabeçalho e a moldura para não
// duplicar texto; as instruções dos passos código/grupo mantêm-se.
export default function ConfirmPhoneCard({ compact = false, dismissible = false, bare = false }) {
  const { t } = useTranslation()
  const { profile, retryProfile } = useAuth()
  const [step, setStep] = useState('phone') // 'phone' | 'code' | 'group'
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [groupCode, setGroupCode] = useState(null)
  const [devCode, setDevCode] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notYet, setNotYet] = useState(false)
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

  const sendCode = async (channel) => {
    if (phone.replace(/\D/g, '').length < 9) {
      setError(t('login.error_invalid_phone'))
      return
    }
    setBusy(true)
    setError('')
    setNotYet(false)
    setDevCode(null)
    try {
      const { data, error: fnError } = await supabase.functions.invoke('send-otp', { body: { phone, channel } })
      if (fnError) {
        // O corpo da resposta diz porquê — o FunctionsHttpError esconde-o
        // em context.
        let reason = null
        try { reason = (await fnError.context?.json())?.error ?? null } catch { /* sem corpo */ }
        console.error('send-otp failed:', reason || fnError)
        if (reason === 'invalid_phone') setError(t('login.error_invalid_phone'))
        else if (reason === 'phone_taken') setError(t('phoneconfirm.error_phone_taken'))
        else if (reason && /código|codigo|espera/i.test(reason)) setError(reason)
        else setError(t('phoneconfirm.error_send') + (reason ? ` (${reason})` : ''))
        return
      }
      if (channel === 'whatsapp') {
        // Sem código não há instrução que valha — acontece quando a
        // send-otp no ar ainda é uma versão sem o canal 'whatsapp'.
        if (!data?.code) {
          console.error('send-otp sem code no canal whatsapp — redeploy da função?', data)
          setError(t('phoneconfirm.error_send') + ' (send-otp desatualizada)')
          return
        }
        setGroupCode(data.code)
        setStep('group')
        return
      }
      // OTP_DEV_MODE (só em ambientes de teste): a função devolve o código
      // em vez de enviar SMS — preenche-se sozinho, falta só o Confirmar.
      setCode(data?.dev_code || '')
      setDevCode(data?.dev_code || null)
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

  // Canal do grupo: a confirmação acontece do lado do robô — aqui só se vê
  // se o perfil já ficou confirmado.
  const checkGroupConfirmed = async () => {
    setBusy(true)
    setNotYet(false)
    try {
      const { data } = await supabase.from('profiles').select('phone_verified_at').eq('id', profile.id).single()
      if (data?.phone_verified_at) retryProfile()
      else setNotYet(true)
    } finally {
      setBusy(false)
    }
  }

  const pillButton = 'inline-flex items-center gap-1.5 text-xs font-extrabold px-3.5 py-2 min-h-[36px] rounded-full transition-colors duration-fast disabled:opacity-40'

  return (
    <div className={bare ? 'relative' : `relative rounded-ctrl border border-line ${compact ? 'bg-ink-50 p-3' : 'card'}`}>
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
      {!bare && (
        <p className="flex items-center gap-2 text-sm font-extrabold text-ink-900 pr-7">
          <MessageCircle size={16} className="text-lime-600" /> {t('phoneconfirm.title_sms')}
        </p>
      )}
      {(!bare || step !== 'phone') && (
        <p className="mt-1 text-xs text-muted">
          {step === 'phone' ? t('phoneconfirm.body_sms')
            : step === 'code' ? t('phoneconfirm.body_code')
            : t('phoneconfirm.body_group')}
        </p>
      )}

      {step === 'phone' && (
        <div className="mt-2.5 space-y-2">
          <input
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t('login.phone_placeholder')}
            className="input-field w-full"
          />
          <div className="flex flex-wrap gap-2">
            <button onClick={() => sendCode('sms')} disabled={busy} className={`${pillButton} bg-lime-400 text-ink-900 hover:bg-lime-600`}>
              {busy ? <RefreshCw size={14} className="animate-spin" /> : <Smartphone size={14} />} {t('phoneconfirm.channel_sms')}
            </button>
            <button onClick={() => sendCode('whatsapp')} disabled={busy} className={`${pillButton} bg-white border border-line text-ink-900 hover:bg-ink-200/40`}>
              <Users size={14} /> {t('phoneconfirm.channel_group')}
            </button>
          </div>
        </div>
      )}

      {step === 'code' && (
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
          <button type="button" onClick={() => sendCode('sms')} disabled={busy} className="text-xs font-extrabold text-muted hover:text-ink-900">
            {t('phoneconfirm.resend')}
          </button>
          {devCode && <p className="text-[11px] text-muted">{t('phoneconfirm.dev_code_notice')}</p>}
        </div>
      )}

      {step === 'group' && (
        <div className="mt-2.5 space-y-2">
          <p className="rounded-ctrl bg-white border border-line px-3 py-2 text-sm text-ink-900">
            {t('phoneconfirm.group_write')}{' '}
            <span className="font-mono font-extrabold tabular-nums">Confirmar {groupCode}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <button onClick={checkGroupConfirmed} disabled={busy} className={`${pillButton} bg-lime-400 text-ink-900 hover:bg-lime-600`}>
              {busy ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} {t('phoneconfirm.group_sent')}
            </button>
            <button onClick={() => { setStep('phone'); setGroupCode(null); setNotYet(false) }} disabled={busy} className="text-xs font-extrabold text-muted hover:text-ink-900">
              {t('phoneconfirm.group_back')}
            </button>
          </div>
          {notYet && <p className="text-xs text-muted">{t('phoneconfirm.group_not_yet')}</p>}
        </div>
      )}
      {error && <p className="mt-2 text-xs text-danger font-extrabold">{error}</p>}
    </div>
  )
}
