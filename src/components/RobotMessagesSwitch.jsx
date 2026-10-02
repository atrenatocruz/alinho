import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'

/**
 * Mensagens novas do robô (design-handoff/2026-10-01-mensagens-whatsapp,
 * aprovadas pelo Renato e pelo Francisco a 1 out): um interruptor por clube.
 * Ligado, o robô usa os textos novos nos grupos deste clube; desligado, os de
 * sempre. Só o super admin o vê — e só ele o pode mudar: a trava está na base
 * de dados (migration_robo_mensagens_novas.sql, 'not_allowed').
 * Guarda logo ao tocar, como o plano.
 */
export default function RobotMessagesSwitch({ organizationId, value, onChange }) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const toggle = async (next) => {
    if (saving) return
    setSaving(true)
    setError('')
    onChange(next)
    // .select() para saber se gravou: a policy de UPDATE da organizations é
    // só para admins do clube, e um super admin que não o seja não dá erro —
    // passa 0 linhas.
    const { data, error: updateError } = await supabase
      .from('organizations')
      .update({ whatsapp_new_messages: next })
      .eq('id', organizationId)
      .select('id')
    if (updateError || !data?.length) {
      console.error('Error switching robot messages:', updateError || 'no row updated')
      onChange(!next)
      setError(t('gerirclube.robot_messages_error'))
    }
    setSaving(false)
  }

  return (
    <div className="mt-6 pt-6 border-t border-gray-200">
      <label className="flex items-center justify-between gap-4 p-3 rounded-ctrl border border-line">
        <div>
          <p className="font-extrabold text-ink-900 text-sm">{t('gerirclube.robot_messages_label')}</p>
          <p className="text-[11px] text-muted">
            {t(value ? 'gerirclube.robot_messages_on_hint' : 'gerirclube.robot_messages_off_hint')}
          </p>
          <p className="text-[11px] text-muted">{t('gerirclube.robot_messages_who_hint')}</p>
        </div>
        <input
          type="checkbox"
          checked={!!value}
          disabled={saving}
          onChange={(e) => toggle(e.target.checked)}
          className="w-5 h-5 shrink-0"
        />
      </label>
      {error && <p role="alert" className="mt-2 text-sm font-extrabold text-danger">{error}</p>}
    </div>
  )
}
