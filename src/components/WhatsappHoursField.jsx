// «Lembrar no WhatsApp, enquanto houver vagas» — as horas a que o robô volta
// a publicar um evento nos grupos de WhatsApp do clube, dentro do próprio
// evento (design-handoff/2026-09-27-whatsapp-no-evento, aprovado pelo
// Francisco a 27 set). Um só campo para todos os eventos que o robô anuncia:
// mix (Bugs), torneio (Dev 1), jogos em aberto (Dev 2) e turma (Dev 4).
//
// Uso: <WhatsappHoursField organizationId kind="tournament" value={horas} onChange={setHoras} />
//   kind   — 'mix' | 'open_slot' | 'tournament' | 'lesson' (os mesmos da base
//            de dados; muda também as palavras)
//   value  — ['10:00', '18:30'] · [] = sem lembretes · null = ainda por
//            preencher: vem com as horas do último evento do mesmo tipo
//   Só aparece se o clube tiver grupos de WhatsApp ligados.
// Guardar: setEventWhatsappPostTimes(kind, id, horas) em lib/whatsappHours,
// logo depois de criar e ao gravar a edição (Dev 3). O robô é do Renato.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, X } from 'lucide-react'
import { Select } from './ui'
import { listWhatsappGroups } from '../lib/whatsappGroups'
import { defaultWhatsappPostTimes, HOURS_MAX, HALF_HOURS, sortHours } from '../lib/whatsappHours'

export default function WhatsappHoursField({ organizationId, kind = 'mix', value, onChange, editing = false }) {
  const { t } = useTranslation()
  const [hasGroups, setHasGroups] = useState(false)
  const [picking, setPicking] = useState(false)
  const [live, setLive] = useState(true) // false = a base de dados ainda não tem as horas por evento

  useEffect(() => {
    let cancelled = false
    if (!organizationId) return undefined
    listWhatsappGroups(organizationId)
      .then((groups) => { if (!cancelled) setHasGroups(groups.length > 0) })
      .catch(() => { if (!cancelled) setHasGroups(false) })
    return () => { cancelled = true }
  }, [organizationId])

  // Vem preenchido com as horas do último evento do mesmo tipo no clube.
  useEffect(() => {
    let cancelled = false
    if (!hasGroups || value != null) return undefined
    defaultWhatsappPostTimes(organizationId, kind)
      .then((hours) => {
        if (cancelled) return
        if (hours === null) { setLive(false); return }
        onChange(sortHours(hours).slice(0, HOURS_MAX))
      })
      .catch(() => { if (!cancelled) onChange([]) })
    return () => { cancelled = true }
  }, [hasGroups, value, organizationId, kind]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!hasGroups || !live) return null
  const hours = value || []
  const full = hours.length >= HOURS_MAX
  const help = full ? t('whatsapp_hours.full') : hours.length === 0 ? t(`whatsapp_hours.none_${kind}`) : t(`whatsapp_hours.${editing ? 'help_edit' : 'help'}_${kind}`)

  return (
    <div>
      <p className="mb-2 text-sm font-medium text-gray-700">{t(`whatsapp_hours.label_${kind}`)}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {hours.map((h) => (
          <button key={h} type="button" onClick={() => onChange(hours.filter((x) => x !== h))}
            aria-label={t('whatsapp_hours.remove', { hour: h })}
            className="inline-flex min-h-[44px] items-center">
            <span className="inline-flex min-h-[40px] items-center gap-1 rounded-full bg-ink-900 px-3 text-sm font-extrabold text-white">
              {h} <X size={14} />
            </span>
          </button>
        ))}
        {!full && !picking && (
          <button type="button" onClick={() => setPicking(true)} className="inline-flex min-h-[44px] items-center">
            <span className="inline-flex min-h-[40px] items-center gap-1 rounded-full border border-dashed border-line px-3 text-sm font-extrabold text-ink-700">
              <Plus size={14} /> {t('whatsapp_hours.add')}
            </span>
          </button>
        )}
      </div>
      {picking && !full && (
        <div className="mt-2">
          {/* De meia em meia hora; as que já estão escolhidas não aparecem. */}
          <Select value="" placeholder={t('whatsapp_hours.pick')}
            options={HALF_HOURS.filter((h) => !hours.includes(h)).map((h) => ({ value: h, label: h }))}
            onChange={(h) => { if (h) onChange(sortHours([...hours, h])); setPicking(false) }} />
        </div>
      )}
      <p className="mt-1.5 text-xs text-muted">{help}</p>
    </div>
  )
}
