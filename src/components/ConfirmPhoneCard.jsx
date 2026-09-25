// Confirmar o número pelo WhatsApp (Trello #537). Quem jogou como convidado
// pelo WhatsApp e depois se registou tinha o histórico noutra conta — a do
// convidado. Com o número confirmado, esse histórico passa para esta conta
// (supabase/migration_537_confirmar_numero.sql).
//
// Porque é a pessoa a mandar o código ao bot, e não o contrário: assim fica
// provado que o número é dela (a mensagem VEM desse número), e o bot não
// escreve a números que não conhece — o WhatsApp castiga isso.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, MessageCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { describeError } from '../lib/errors'

// O número do bot, só dígitos com o indicativo (ex.: 351912345678).
const BOT_NUMBER = (import.meta.env.VITE_WHATSAPP_BOT_NUMBER || '').replace(/\D/g, '')

export default function ConfirmPhoneCard() {
  const { t } = useTranslation()
  const { profile, retryProfile } = useAuth()
  const [pedido, setPedido] = useState(null) // { code, expires_at }
  const [aPedir, setAPedir] = useState(false)
  const [erro, setErro] = useState('')
  const [aVerificar, setAVerificar] = useState(false)
  const [aindaNao, setAindaNao] = useState(false)

  if (!profile?.phone_hash || profile.phone_hash === 'dev-bypass') return null

  if (profile.phone_verified_at) {
    return (
      <p className="inline-flex items-center gap-1.5 text-sm font-extrabold text-ok">
        <Check size={15} /> {t('confirmphone.confirmed')}
      </p>
    )
  }

  const pedirCodigo = async () => {
    setAPedir(true)
    setErro('')
    setAindaNao(false)
    try {
      const { data, error } = await supabase.rpc('start_phone_verification')
      if (error) throw error
      setPedido(data?.[0] || null)
    } catch (error) {
      setErro(describeError(t, error))
    } finally {
      setAPedir(false)
    }
  }

  // Depois de mandar a mensagem, volta a ler o perfil: se o bot já
  // confirmou, o cartão passa a «Número confirmado».
  const jaEnviei = async () => {
    setAVerificar(true)
    setAindaNao(false)
    await retryProfile()
    setAVerificar(false)
    setAindaNao(true)
  }

  return (
    <div className="rounded-ctrl border border-line bg-canvas p-4 space-y-3">
      <div>
        <p className="font-extrabold text-ink-900">{t('confirmphone.title')}</p>
        <p className="text-sm text-muted mt-0.5">{t('confirmphone.why')}</p>
      </div>

      {!pedido ? (
        <button type="button" onClick={pedirCodigo} disabled={aPedir}
          className="btn-secondary w-full !text-sm disabled:opacity-40">
          {t('confirmphone.start')}
        </button>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-ink-700">{t(BOT_NUMBER ? 'confirmphone.send_hint' : 'confirmphone.send_hint_no_number')}</p>
          <p className="text-center font-mono text-3xl font-extrabold tracking-[0.3em] text-ink-900">{pedido.code}</p>
          {BOT_NUMBER && (
            <a href={`https://wa.me/${BOT_NUMBER}?text=${encodeURIComponent(pedido.code)}`}
              target="_blank" rel="noopener noreferrer"
              className="btn-primary w-full inline-flex items-center justify-center gap-2 !text-sm">
              <MessageCircle size={16} /> {t('confirmphone.send')}
            </a>
          )}
          <button type="button" onClick={jaEnviei} disabled={aVerificar}
            className="btn-secondary w-full !text-sm disabled:opacity-40">
            {t('confirmphone.sent')}
          </button>
          {aindaNao && <p className="text-xs text-muted text-center">{t('confirmphone.not_yet')}</p>}
          <p className="text-[11px] text-muted text-center">{t('confirmphone.expires')}</p>
        </div>
      )}
      {erro && <p className="text-sm text-danger">{erro}</p>}
    </div>
  )
}
