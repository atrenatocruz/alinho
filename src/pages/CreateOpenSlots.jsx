// Publicar jogos em aberto, em 2 passos (#342, aprovado pelo Francisco a 26
// set: «Sim»). Numa página própria, como todos os eventos: Quando (dia e
// horários livres) e Regras (preço). Saltam «Pessoas» (hoje não se restringe
// quem entra) e «Onde joga» (é sempre no clube). Não há perguntas novas: são
// os mesmos 3 campos do formulário que abria por baixo no Gerir.
// Desenho: design-handoff/2026-09-26-criar-mix-passos/SPEC-jogos-em-aberto.md.
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useGoBack } from '../lib/useGoBack'
import { getClubProfile } from '../lib/clubProfile'
import { buildOpenSlotRows } from '../lib/openSlots'
import { describeError } from '../lib/errors'
import { PrimaryButton, PickerInput, DateField } from '../components/ui'
import StepPage from '../components/steps/StepPage'

const EMPTY_RANGE = () => ({ start: '', end: '' })

export default function CreateOpenSlots() {
  const { t } = useTranslation()
  const { slug } = useParams()
  const navigate = useNavigate()
  const goBack = useGoBack(`/gerir/${slug}`)
  const { user } = useAuth()
  const [org, setOrg] = useState(null)
  const [step, setStep] = useState(1)
  const [date, setDate] = useState('')
  const [ranges, setRanges] = useState([EMPTY_RANGE()])
  const [price, setPrice] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getClubProfile(slug).then(setOrg).catch((err) => console.error('Error loading club profile:', err))
  }, [slug])

  const validRanges = ranges.filter((r) => r.start && r.end)
  const updateRange = (i, field, value) => setRanges((rs) => rs.map((r, k) => (k === i ? { ...r, [field]: value } : r)))

  const publish = async () => {
    if (!org?.id) return
    setError('')
    let rows
    try {
      ;({ rows } = buildOpenSlotRows({
        organizationId: org.id,
        date,
        priceDefault: price === '' ? null : parseFloat(price),
        timeRanges: validRanges,
        createdBy: user.id,
      }))
    } catch (err) {
      setError(describeError(t, err))
      setStep(1)
      return
    }
    setSaving(true)
    const { error: err } = await supabase.from('games').insert(rows)
    setSaving(false)
    if (err) {
      console.error('Error publishing open slots:', err)
      setError(describeError(t, err, 'open_slots.error_publish'))
      return
    }
    navigate(`/gerir/${slug}`)
  }

  const label = 'block text-sm font-medium text-gray-700 mb-2'

  return (
    <StepPage
      title={t('open_slots.publish_title')}
      step={step}
      total={2}
      stepLabel={step === 1 ? t('steps.when') : t('steps.rules')}
      onBack={() => { setError(''); if (step === 1) goBack(); else setStep(1) }}
      onNext={() => { setError(''); setStep(2) }}
      nextDisabled={!date || validRanges.length === 0}
      nextHint={t('open_slots.error_missing_fields')}
      error={error}
      footer={step === 2 ? (
        <div>
          <PrimaryButton onClick={publish} disabled={saving || !org} className="w-full">
            {t('open_slots.publish_step')}
          </PrimaryButton>
          <p className="mt-1.5 text-center text-xs text-muted">{t('open_slots.publish_hint')}</p>
        </div>
      ) : null}
    >
      {step === 1 ? (
        <>
          <div>
            <p className={label}>{t('open_slots.day_label')}</p>
            {/* Calendário partilhado: mostra o dia de hoje e tem o atalho
                «Hoje» (Trello #357). */}
            <DateField value={date} onChange={setDate} min={new Date().toISOString().slice(0, 10)} />
          </div>
          <div className="space-y-2">
            <p className={label}>{t('open_slots.free_times_label')}</p>
            {ranges.map((range, i) => (
              <div key={i} className="flex items-center gap-2">
                <PickerInput type="time" value={range.start} onChange={(e) => updateRange(i, 'start', e.target.value)}
                  hint={t('open_slots.start_hint')} aria-label={t('open_slots.start_hint')} className="flex-1" />
                <span className="text-muted">–</span>
                <PickerInput type="time" value={range.end} onChange={(e) => updateRange(i, 'end', e.target.value)}
                  hint={t('open_slots.end_hint')} aria-label={t('open_slots.end_hint')} className="flex-1" />
                {ranges.length > 1 && (
                  <button type="button" onClick={() => setRanges((rs) => rs.filter((_, k) => k !== i))}
                    className="p-2 text-danger" aria-label={t('open_slots.remove_range')}>
                    <Trash2 size={18} />
                  </button>
                )}
              </div>
            ))}
            <button type="button" onClick={() => setRanges((rs) => [...rs, EMPTY_RANGE()])}
              className="press inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-ctrl border border-dashed border-ink-200 text-sm font-extrabold text-ink-700">
              <Plus size={16} /> {t('open_slots.join_time')}
            </button>
          </div>
        </>
      ) : (
        <div>
          <p className={label}>{t('open_slots.price_label')}</p>
          <input type="number" step="0.01" min="0" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)}
            className="input-field" placeholder={t('open_slots.price_example')} />
        </div>
      )}
    </StepPage>
  )
}
