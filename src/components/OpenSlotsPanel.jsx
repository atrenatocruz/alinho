import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, Clock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { PrimaryButton } from './ui'
import { buildOpenSlotRows } from '../lib/openSlots'
import { formatDate, formatTime } from '../lib/formatDate'
import { describeError } from '../lib/errors'

const EMPTY_RANGE = () => ({ start: '', end: '' })

export default function OpenSlotsPanel({ organizationId }) {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const [slots, setSlots] = useState([])
  const [loading, setLoading] = useState(true)
  const [date, setDate] = useState('')
  const [price, setPrice] = useState('')
  const [ranges, setRanges] = useState([EMPTY_RANGE()])

  const loadOpenSlots = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('games')
      .select('*, participants(id, status)')
      .eq('organization_id', organizationId)
      .eq('origin', 'open_slot')
      .order('date', { ascending: false })

    if (error) {
      console.error('Error loading open slots:', error)
    } else {
      setSlots(data || [])
    }
    setLoading(false)
  }

  useEffect(() => {
    if (organizationId) loadOpenSlots()
  }, [organizationId])

  const addRange = () => setRanges([...ranges, EMPTY_RANGE()])
  const removeRange = (index) => setRanges(ranges.filter((_, i) => i !== index))
  const updateRange = (index, field, value) => {
    setRanges(ranges.map((r, i) => (i === index ? { ...r, [field]: value } : r)))
  }

  const handlePublish = async () => {
    const validRanges = ranges.filter((r) => r.start && r.end)
    if (!date || validRanges.length === 0) {
      alert(t('open_slots.error_missing_fields'))
      return
    }

    let rows
    try {
      ;({ rows } = buildOpenSlotRows({
        organizationId,
        date,
        priceDefault: price === '' ? null : parseFloat(price),
        timeRanges: validRanges,
        createdBy: user.id,
      }))
    } catch (err) {
      alert(describeError(t, err))
      return
    }

    const { error } = await supabase.from('games').insert(rows)
    if (error) {
      console.error('Error publishing open slots:', error)
      alert(describeError(t, error, 'open_slots.error_publish'))
      return
    }

    setDate('')
    setPrice('')
    setRanges([EMPTY_RANGE()])
    loadOpenSlots()
  }

  const handleCancel = async (slotId) => {
    if (!confirm(t('open_slots.confirm_cancel'))) return
    const { error } = await supabase.from('games').update({ status: 'cancelled' }).eq('id', slotId)
    if (error) {
      console.error('Error cancelling open slot:', error)
      alert(describeError(t, error, 'open_slots.error_cancel'))
      return
    }
    loadOpenSlots()
  }

  const confirmedCount = (slot) => (slot.participants || []).filter((p) => p.status === 'confirmed').length
  const capacity = (slot) => slot.max_players || slot.num_courts * 4

  return (
    <div className="space-y-4">
      <div className="bg-surface border border-line rounded-ctrl p-4 space-y-3">
        <h3 className="font-extrabold text-ink-900">{t('open_slots.publish_title')}</h3>
        <div>
          <label className="text-sm font-bold text-ink-700">{t('open_slots.date_label')}</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input-field w-full mt-1"
          />
        </div>
        <div>
          <label className="text-sm font-bold text-ink-700">{t('open_slots.price_label')}</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="input-field w-full mt-1"
            placeholder={t('open_slots.price_placeholder')}
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-bold text-ink-700">{t('open_slots.ranges_label')}</label>
          {ranges.map((range, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="time"
                value={range.start}
                onChange={(e) => updateRange(i, 'start', e.target.value)}
                className="input-field flex-1"
              />
              <span className="text-muted">–</span>
              <input
                type="time"
                value={range.end}
                onChange={(e) => updateRange(i, 'end', e.target.value)}
                className="input-field flex-1"
              />
              {ranges.length > 1 && (
                <button onClick={() => removeRange(i)} className="text-danger p-2" aria-label={t('open_slots.remove_range')}>
                  <Trash2 size={18} />
                </button>
              )}
            </div>
          ))}
          <button onClick={addRange} className="text-sm font-bold text-ink-700 flex items-center gap-1">
            <Plus size={16} /> {t('open_slots.add_range')}
          </button>
        </div>
        <PrimaryButton onClick={handlePublish} className="w-full">
          {t('open_slots.publish_button')}
        </PrimaryButton>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-ink-700"></div>
        </div>
      ) : (
        <div className="space-y-2">
          {slots.length === 0 && <p className="text-muted text-sm">{t('open_slots.empty_list')}</p>}
          {slots.map((slot) => (
            <div key={slot.id} className="bg-surface border border-line rounded-ctrl p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock size={16} className="text-muted" />
                <span className="font-bold">
                  {formatDate(slot.date, i18n.language, { day: '2-digit', month: '2-digit', year: 'numeric' })} ·{' '}
                  {formatTime(slot.date, i18n.language, { hour: '2-digit', minute: '2-digit' })}–
                  {formatTime(
                    new Date(new Date(slot.date).getTime() + (slot.court_time_minutes || 0) * 60_000),
                    i18n.language,
                    { hour: '2-digit', minute: '2-digit' }
                  )}
                </span>
                <span className="text-muted text-sm">
                  {confirmedCount(slot)}/{capacity(slot)} · {t(`open_slots.status_${slot.status}`)}
                </span>
              </div>
              {slot.status !== 'cancelled' && confirmedCount(slot) === 0 && (
                <button onClick={() => handleCancel(slot.id)} className="text-danger p-2" aria-label={t('open_slots.cancel_button')}>
                  <Trash2 size={18} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
