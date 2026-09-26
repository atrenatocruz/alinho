// Horas a que o robô publica os mixes no WhatsApp (Trello #553): até 3 horas
// certas por dia, iguais para todos os grupos de WhatsApp do clube. Em cada
// hora o robô publica o cartão de cada mix aberto com vagas, com @all.
//
// Só aparece a quem pode fazer alguma coisa com ela: clubes com grupos de
// WhatsApp ligados, e depois de migration_whatsapp_post_hours.sql correr
// (antes disso a coluna não vem no `org` e isto fica escondido).
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageCircle } from 'lucide-react'
import { listWhatsappGroups, setWhatsappPostHours, toggleHour, POST_HOURS, POST_HOURS_MAX } from '../lib/whatsappGroups'
import { describeError } from '../lib/errors'

export default function WhatsappPostHours({ organizationId, hours, onSaved }) {
  const { t } = useTranslation()
  const [hasGroups, setHasGroups] = useState(false)
  const [draft, setDraft] = useState(hours || [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => { setDraft(hours || []) }, [hours])

  useEffect(() => {
    let cancelled = false
    listWhatsappGroups(organizationId)
      .then((groups) => { if (!cancelled) setHasGroups(groups.length > 0) })
      .catch(() => { if (!cancelled) setHasGroups(false) })
    return () => { cancelled = true }
  }, [organizationId])

  if (!Array.isArray(hours) || !hasGroups) return null

  const changed = draft.join(',') !== [...hours].sort((a, b) => a - b).join(',')
  const full = draft.length >= POST_HOURS_MAX

  const save = async () => {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const result = await setWhatsappPostHours(organizationId, draft)
      onSaved?.(result)
      setSaved(true)
    } catch (err) {
      setError(describeError(t, err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card p-3.5">
      <div className="flex items-center gap-2">
        <MessageCircle size={16} className="shrink-0 text-ink-700" />
        <b className="text-sm text-ink-900">{t('gerirclube.post_hours_title')}</b>
      </div>
      <p className="mt-1 text-[12.5px] text-muted">{t('gerirclube.post_hours_help', { max: POST_HOURS_MAX })}</p>

      <div role="group" aria-label={t('gerirclube.post_hours_title')} className="-mx-1 mt-2 flex flex-wrap gap-1.5 px-1">
        {POST_HOURS.map((h) => {
          const on = draft.includes(h)
          const blocked = !on && full
          return (
            <button
              key={h}
              type="button"
              aria-pressed={on}
              disabled={blocked}
              onClick={() => { setSaved(false); setDraft((d) => toggleHour(d, h)) }}
              className="inline-flex min-h-[44px] items-center disabled:opacity-40"
            >
              <span className={`inline-flex min-h-[40px] items-center rounded-full border px-3 text-sm font-extrabold transition-colors duration-fast ${
                on ? 'border-ink-900 bg-ink-900 text-white' : 'border-line bg-canvas text-ink-700'
              }`}>
                {t('gerirclube.post_hours_hour', { hour: h })}
              </span>
            </button>
          )
        })}
      </div>

      <p className="mt-2 text-[12px] text-ink-700">
        {draft.length === 0
          ? t('gerirclube.post_hours_none')
          : t('gerirclube.post_hours_summary', { hours: draft.map((h) => t('gerirclube.post_hours_hour', { hour: h })).join(' · ') })}
      </p>

      {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
      {saved && !changed && <p className="mt-2 text-[12px] font-bold text-ok-700">{t('gerirclube.post_hours_saved')}</p>}
      {changed && (
        <button type="button" onClick={save} disabled={saving} className="btn-primary mt-3 w-full !text-sm">
          {saving ? t('gerirclube.post_hours_saving') : t('gerirclube.post_hours_save')}
        </button>
      )}
    </div>
  )
}
