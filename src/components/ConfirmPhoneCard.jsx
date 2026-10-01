import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageCircle, CheckCircle2, RefreshCw, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { hashPhone } from '../lib/hashPhone'
import { WHATSAPP_NUMBER } from '../lib/contacts'

/* Associar e confirmar o número pelo WhatsApp, num cartão só (#537 na base
   de dados; workflow completo desde migration_mix_guest_sem_conta.sql).

   Porquê: só números CONFIRMADOS contam para o match do «In» no bot. Quem
   associou o número antes da migração ficou confirmado de raiz
   (grandfathering); uma conta nova tem de associar E confirmar — senão o
   «In» dela entra como convidado sem conta (e só é adotado ao confirmar).

   Dois passos no mesmo cartão:
   1. Sem número: escreve-o aqui (só o hash é guardado — hash-phone edge fn).
   2. Por confirmar: pede um código (start_phone_verification, 15 min, 5/h),
      manda-o numa mensagem PRIVADA ao robô a partir do próprio telemóvel
      (deep-link wa.me já com o código escrito) e carrega em «Já enviei».

   `dismissible`: na Home o cartão é um lembrete — dá para fechar até à
   próxima sessão. Na Informação Pessoal fica sempre. */
const DISMISS_KEY = 'confirmPhoneCard.dismissed'

export default function ConfirmPhoneCard({ compact = false, dismissible = false }) {
  const { t } = useTranslation()
  const { profile, updateProfile, retryProfile } = useAuth()
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notYet, setNotYet] = useState(false)
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === 'true' } catch { return false }
  })

  // Confirmado (ou mock de dev), o cartão desaparece sozinho.
  if (!profile || profile.phone_verified_at || profile.phone_hash === 'dev-bypass') return null
  if (dismissible && dismissed) return null

  const hasNumber = Boolean(profile.phone_hash)

  const dismiss = () => {
    setDismissed(true)
    try { sessionStorage.setItem(DISMISS_KEY, 'true') } catch { /* modo privado */ }
  }

  const savePhone = async () => {
    if (phone.replace(/\D/g, '').length < 9) {
      setError(t('login.error_invalid_phone'))
      return
    }
    setBusy(true)
    setError('')
    try {
      const hash = await hashPhone(phone)
      const { error: updateError } = await updateProfile({ phone_hash: hash })
      if (updateError) throw updateError
      // O perfil do contexto recarrega com o hash → o cartão passa ao
      // passo 2 sozinho; pede-se já o código para poupar um toque.
      await askCode()
      retryProfile()
    } catch (err) {
      console.error('Error saving phone number:', err)
      setError(t('phoneconfirm.error_generic'))
    } finally {
      setBusy(false)
    }
  }

  const askCode = async () => {
    setBusy(true)
    setError('')
    setNotYet(false)
    try {
      const { data, error: rpcError } = await supabase.rpc('start_phone_verification')
      if (rpcError) throw rpcError
      setCode(data?.[0]?.code ?? null)
    } catch (err) {
      console.error('Error starting phone verification:', err)
      setError(err?.message || t('phoneconfirm.error_generic'))
    } finally {
      setBusy(false)
    }
  }

  const checkConfirmed = async () => {
    setBusy(true)
    setNotYet(false)
    try {
      const { data } = await supabase.from('profiles').select('phone_verified_at').eq('id', profile.id).single()
      if (data?.phone_verified_at) {
        retryProfile()
      } else {
        setNotYet(true)
      }
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
        <MessageCircle size={16} className="text-lime-600" />
        {hasNumber ? t('phoneconfirm.title') : t('phoneconfirm.title_link')}
      </p>
      <p className="mt-1 text-xs text-muted">{hasNumber ? t('phoneconfirm.body') : t('phoneconfirm.body_link')}</p>

      {!hasNumber && !code ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <input
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t('login.phone_placeholder')}
            className="input-field flex-1 min-w-[12rem]"
          />
          <button onClick={savePhone} disabled={busy} className={`${pillButton} bg-lime-400 text-ink-900 hover:bg-lime-600`}>
            {busy ? <RefreshCw size={14} className="animate-spin" /> : null} {t('phoneconfirm.save_number')}
          </button>
        </div>
      ) : !code ? (
        <button onClick={askCode} disabled={busy} className={`mt-2.5 ${pillButton} bg-lime-400 text-ink-900 hover:bg-lime-600`}>
          {t('phoneconfirm.get_code')}
        </button>
      ) : (
        <div className="mt-2.5 space-y-2">
          <p className="text-xs text-ink-700">
            {t('phoneconfirm.code_ready')} <span className="font-mono font-extrabold text-ink-900 tabular-nums">{code}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href={`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(code)}`}
              target="_blank"
              rel="noreferrer"
              className={`${pillButton} bg-lime-400 text-ink-900 hover:bg-lime-600`}
            >
              <MessageCircle size={14} /> {t('phoneconfirm.send_whatsapp')}
            </a>
            <button onClick={checkConfirmed} disabled={busy} className={`${pillButton} bg-white border border-line text-ink-900 hover:bg-ink-200/40`}>
              {busy ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} {t('phoneconfirm.sent')}
            </button>
          </div>
          {notYet && <p className="text-xs text-muted">{t('phoneconfirm.not_yet')}</p>}
        </div>
      )}
      {error && <p className="mt-2 text-xs text-danger font-extrabold">{error}</p>}
    </div>
  )
}
