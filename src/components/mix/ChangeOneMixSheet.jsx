// «Mudar só este mix» (ações do evento, assunto 2, aprovado a 26 set):
// outra hora ou outro sítio só neste dia — as regras da série ficam. Mexe
// só na linha deste mix; a série continua a contar a partir das suas
// próprias datas, por isso as seguintes não mudam.
//
// Folha própria (z-50) e não a ConfirmSheet (z-60): o calendário do campo
// da data abre por cima dela, e com a ConfirmSheet ficava escondido.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { describeError } from '../../lib/errors'
import { DateTimeField } from '../ui'

const toLocalInput = (d) => {
  const dt = new Date(d)
  return new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

export default function ChangeOneMixSheet({ open, game, title, onClose, onSaved }) {
  const { t } = useTranslation()
  const [date, setDate] = useState('')
  const [location, setLocation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !game) return
    setDate(toLocalInput(game.date))
    setLocation(game.location || '')
    setBusy(false); setError('')
  }, [open, game])

  if (!open || !game) return null

  const dateChanged = date && date !== toLocalInput(game.date)
  const placeChanged = location.trim() !== (game.location || '').trim()

  const save = async () => {
    if (new Date(date) <= new Date()) { setError(t('eventactions.change_one_past')); return }
    setBusy(true); setError('')
    const patch = {}
    if (dateChanged) patch.date = new Date(date).toISOString()
    if (placeChanged) {
      // Sítio escrito à mão: o ponto no mapa era do sítio antigo.
      patch.location = location.trim() || null
      patch.latitude = null
      patch.longitude = null
    }
    const { error: err } = await supabase.from('games').update(patch).eq('id', game.id)
    if (err) {
      console.error('Error changing one mix:', err)
      setError(describeError(t, err, 'eventactions.change_one_error'))
      setBusy(false)
      return
    }
    setBusy(false)
    onSaved?.()
    onClose()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 animate-fade-in sm:items-center sm:p-4"
      onClick={() => { if (!busy) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-one-title"
        className="w-full max-w-md rounded-t-[24px] bg-white px-5 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+20px)] shadow-lift sm:rounded-[24px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-ink-200" />
        <p id="change-one-title" className="text-[20px] font-extrabold leading-tight text-ink-900">{title}</p>
        <p className="mt-1 text-[15px] leading-snug text-ink-500">{t('eventactions.change_one_hint')}</p>

        <p className="mt-4 mb-1.5 text-sm font-extrabold text-ink-900">{t('eventactions.change_one_when')}</p>
        <DateTimeField value={date} onChange={setDate} />
        <label htmlFor="change-one-place" className="mt-4 mb-1.5 block text-sm font-extrabold text-ink-900">{t('eventactions.change_one_where')}</label>
        <input
          id="change-one-place"
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className="w-full min-h-[48px] rounded-ctrl border border-line bg-white px-3.5 text-[15px] text-ink-900"
        />

        {error && (
          <p role="alert" className="mt-3 rounded-ctrl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm font-bold text-danger">{error}</p>
        )}
        <div className="mt-5 space-y-2.5">
          <button type="button" onClick={save} disabled={busy || !(dateChanged || placeChanged)}
            className="w-full min-h-[52px] rounded-ctrl bg-ink-900 px-4 text-[15px] font-extrabold text-white disabled:opacity-40">
            {t('eventactions.change_one_save')}
          </button>
          <button type="button" onClick={onClose} disabled={busy}
            className="w-full min-h-[44px] px-4 text-[15px] font-extrabold text-ink-700 disabled:opacity-40">
            {t('eventactions.not_now')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
