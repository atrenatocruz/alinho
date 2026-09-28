// «Publicar <nome>?» de um rascunho de mix (Trello #544), com a pergunta
// «Abrem as inscrições» (Francisco, 28 set: os rascunhos do Smash Padel
// abrem em dias marcados). Sem desenho novo: a folha de sempre e, por baixo
// da frase, a peça «Abrem as inscrições» do mix único — «Já» ou um dos dias
// antes, com a hora e a frase verde. Numa série, a mesma peça com a regra da
// série («Depois, sempre…»): o 1.º abre nessa hora e os seguintes seguem-na.
// O botão é «Publicar» nos dois casos; a opção segura continua «Agora não».
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmSheet } from '../ui'
import LaunchDayPicker from '../LaunchDayPicker'
import { launchDate } from '../../lib/launchDay'
import { draftRecurrence, publishDraftMix } from '../../lib/mixDraft'

const pad = (n) => String(n).padStart(2, '0')

/** «N dias antes, às HH:MM» a partir de um momento de abertura. */
function fieldsFrom(mixDate, open) {
  const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  return { days: String(Math.round((day(mixDate) - day(open)) / 86400000)), time: `${pad(open.getHours())}:${pad(open.getMinutes())}` }
}

export default function PublishDraftSheet({ game, userId, onClose, onPublished, errorOf }) {
  const { t } = useTranslation()
  const mixDate = game ? new Date(game.date) : null
  const [rec, setRec] = useState(null)
  const [days, setDays] = useState('0')
  const [time, setTime] = useState('10:00')

  // Vem com o que já estava escolhido: o launch_at do rascunho, ou a regra
  // da série. Se isso já passou, «Já».
  useEffect(() => {
    if (!game) return undefined
    let alive = true
    const pick = (open) => {
      if (!alive || !open || open.getTime() <= Date.now()) return
      const f = fieldsFrom(mixDate, open)
      setDays(f.days); setTime(f.time)
    }
    setDays('0')
    if (game.launch_at) pick(new Date(game.launch_at))
    if (game.recurrence_id) {
      draftRecurrence(game.recurrence_id)
        .then((r) => {
          if (!alive) return
          setRec(r)
          if (!game.launch_at && r?.mix_offset_seconds) pick(new Date(mixDate.getTime() - r.mix_offset_seconds * 1000))
        })
        .catch((err) => console.error('Error loading draft recurrence:', err))
    }
    return () => { alive = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.id])

  const n = parseInt(days, 10) || 0
  const publish = async () => {
    const open = n >= 1 ? launchDate(mixDate, n, time) : null
    const offsetSeconds = rec && open ? Math.round((mixDate.getTime() - open.getTime()) / 1000) : null
    const published = await publishDraftMix(game, userId, { launchAt: open, offsetSeconds })
    onPublished?.(published)
  }

  return (
    <ConfirmSheet
      open={!!game}
      title={t('mixdraft.publish_title', { name: game?.title || '' })}
      message={t('mixdraft.publish_message')}
      confirmLabel={t('mixdraft.publish')}
      cancelLabel={t('mixdraft.not_now')}
      onConfirm={publish}
      onClose={onClose}
      errorOf={errorOf}
    >
      {game && (
        <div className="mt-4">
          <LaunchDayPicker
            allowNow
            mixDate={mixDate}
            frequency={rec?.frequency || null}
            daysBefore={days}
            onDaysBefore={(v) => setDays(String(v))}
            time={time}
            onTime={setTime}
            // O robô só anuncia mixes abertos: com a abertura marcada, anuncia
            // quando abre (designer, 28 set).
            summaryExtra={t('mixdraft.bot_announces_then')}
          />
        </div>
      )}
    </ConfirmSheet>
  )
}
