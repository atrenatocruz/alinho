import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageCircle, CheckCircle2, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { WHATSAPP_NUMBER } from '../lib/contacts'

/* Confirmar o número pelo WhatsApp (#537 na base de dados; UI nova com o
   modelo de convidados sem conta — migration_mix_guest_sem_conta.sql).

   Porquê: só números CONFIRMADOS contam para o match do «In» no bot. Quem
   associou o número antes da migração ficou confirmado de raiz
   (grandfathering); quem o associa agora tem de o confirmar, senão o «In»
   dele entra como convidado sem conta (e é adotado quando confirmar).

   Fluxo: pede um código (start_phone_verification, 15 min, 5/h), a pessoa
   manda-o numa mensagem PRIVADA ao robô a partir do próprio telemóvel
   (deep-link wa.me já com o código escrito), e carrega em «Já enviei» —
   o robô confirmou via confirm_phone_from_whatsapp e o perfil recarrega. */
export default function ConfirmPhoneCard({ compact = false }) {
  const { t } = useTranslation()
  const { profile, retryProfile } = useAuth()
  const [code, setCode] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notYet, setNotYet] = useState(false)

  // Sem número associado não há nada para confirmar; confirmado, o cartão
  // desaparece sozinho (o refresh do perfil trata disso).
  if (!profile?.phone_hash || profile.phone_hash === 'dev-bypass' || profile.phone_verified_at) return null

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

  return (
    <div className={`rounded-ctrl border border-line ${compact ? 'bg-ink-50 p-3' : 'card'}`}>
      <p className="flex items-center gap-2 text-sm font-extrabold text-ink-900">
        <MessageCircle size={16} className="text-lime-600" /> {t('phoneconfirm.title')}
      </p>
      <p className="mt-1 text-xs text-muted">{t('phoneconfirm.body')}</p>

      {!code ? (
        <button
          onClick={askCode}
          disabled={busy}
          className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-extrabold px-3.5 py-2 min-h-[36px] rounded-full bg-lime-400 text-ink-900 hover:bg-lime-600 transition-colors duration-fast disabled:opacity-40"
        >
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
              className="inline-flex items-center gap-1.5 text-xs font-extrabold px-3.5 py-2 min-h-[36px] rounded-full bg-lime-400 text-ink-900 hover:bg-lime-600 transition-colors duration-fast"
            >
              <MessageCircle size={14} /> {t('phoneconfirm.send_whatsapp')}
            </a>
            <button
              onClick={checkConfirmed}
              disabled={busy}
              className="inline-flex items-center gap-1.5 text-xs font-extrabold px-3.5 py-2 min-h-[36px] rounded-full bg-ink-50 text-ink-900 hover:bg-ink-200/60 transition-colors duration-fast disabled:opacity-40"
            >
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
