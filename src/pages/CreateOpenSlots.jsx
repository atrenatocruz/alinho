// Publicar jogos em aberto, em 2 passos (#342, aprovado pelo Francisco a 26
// set: «Sim»). Numa página própria, como todos os eventos: Quando (dia e
// horários livres) e Regras (preço). Saltam «Pessoas» (hoje não se restringe
// quem entra) e «Onde joga» (é sempre no clube). Não há perguntas novas: são
// os mesmos 3 campos do formulário que abria por baixo no Gerir.
// Desenho: design-handoff/2026-09-26-criar-mix-passos/SPEC-jogos-em-aberto.md.
//
// `edit` ({ batchId, games }): «Editar jogo em aberto» — os mesmos passos,
// com a publicação como está (auditoria «Editar tem tudo», #586, ponto 5).
// Um horário com alguém confirmado não sai nem muda de hora (🔒), nem de
// preço; com ele, também o dia fica como está. Os outros mudam ou saem, e pode
// sempre juntar-se horário. Grava com update_open_slot_batch (Dev 3).
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Lock, Plus, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useGoBack } from '../lib/useGoBack'
import { getClubProfile } from '../lib/clubProfile'
import { buildOpenSlotRows, batchToForm, batchSlotsPayload } from '../lib/openSlots'
import { updateOpenSlotBatch } from '../lib/openSlotsApi'
import { describeError } from '../lib/errors'
import { PrimaryButton, DateField, TimeField } from '../components/ui'
import StepPage from '../components/steps/StepPage'
import WhatsappHoursField from '../components/WhatsappHoursField'
import { setEventWhatsappPostTimes } from '../lib/whatsappHours'

const EMPTY_RANGE = () => ({ start: '', end: '' })

function LockLine({ children }) {
  return (
    <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted">
      <Lock size={12} className="mt-0.5 shrink-0 text-warning" /> {children}
    </p>
  )
}

export default function CreateOpenSlots({ edit = null }) {
  const { t } = useTranslation()
  const { slug } = useParams()
  const navigate = useNavigate()
  const goBack = useGoBack(`/gerir/${slug}`)
  const { user } = useAuth()
  const initial = edit ? batchToForm(edit.games) : null
  const [org, setOrg] = useState(null)
  const [step, setStep] = useState(1)
  const [date, setDate] = useState(initial?.date || '')
  const [ranges, setRanges] = useState(initial?.ranges.length ? initial.ranges : [EMPTY_RANGE()])
  const [price, setPrice] = useState(initial?.price || '')
  // Horas do WhatsApp (27 set): null = vem com as do último jogo em aberto
  // do clube; [] = sem lembretes. No editar só se gravam se mudarem.
  const [horas, setHoras] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getClubProfile(slug).then(setOrg).catch((err) => console.error('Error loading club profile:', err))
  }, [slug])

  // Com alguém confirmado num horário, o dia também não muda: mudava para
  // quem já se comprometeu. O preço muda só nos horários sem ninguém.
  const anyLocked = ranges.some((r) => r.locked)
  const validRanges = ranges.filter((r) => r.start && r.end)
  const updateRange = (i, field, value) => setRanges((rs) => rs.map((r, k) => {
    if (k !== i) return r
    const next = { ...r, [field]: value }
    // Um início depois do fim apaga o fim, em vez de deixar um horário ao contrário.
    if (field === 'start' && next.end && next.end <= value) next.end = ''
    return next
  }))
  const removeRange = (i) => setRanges((rs) => (rs.length > 1 ? rs.filter((_, k) => k !== i) : [EMPTY_RANGE()]))

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
    const { data: created, error: err } = await supabase.from('games').insert(rows).select('id')
    if (err) {
      setSaving(false)
      console.error('Error publishing open slots:', err)
      setError(describeError(t, err, 'open_slots.error_publish'))
      return
    }
    // As mesmas horas em cada horário publicado. Os jogos já estão criados:
    // se isto falhar, ficam com as horas do clube, como até aqui.
    if (Array.isArray(horas)) {
      await Promise.all((created || []).map((g) => setEventWhatsappPostTimes('open_slot', g.id, horas)))
        .catch((e) => console.error('Error saving WhatsApp hours:', e))
    }
    setSaving(false)
    navigate(`/gerir/${slug}`)
  }

  // Editar: «Cancelar» pergunta se há alterações por guardar (30 set).
  const [initialSnap] = useState(() => JSON.stringify([initial?.date || '', initial?.ranges || [], initial?.price || '']))
  const dirty = edit && (JSON.stringify([date, ranges, price]) !== initialSnap)

  const saveEdit = async () => {
    setError('')
    let slots
    try {
      slots = batchSlotsPayload(date, ranges)
    } catch (err) {
      setError(describeError(t, err))
      setStep(1)
      return
    }
    setSaving(true)
    try {
      const ids = await updateOpenSlotBatch(edit.batchId, { price: price === '' ? null : parseFloat(price), slots })
      if (Array.isArray(horas)) {
        await Promise.all(ids.map((id) => setEventWhatsappPostTimes('open_slot', id, horas)))
          .catch((e) => console.error('Error saving WhatsApp hours:', e))
      }
      navigate(`/gerir/${slug}`)
    } catch (err) {
      console.error('Error editing open slots:', err)
      const msg = String(err?.message || '')
      // bad_slot: um horário que já não está aberto (cancelado entretanto).
      setError(msg.includes('slot_taken') || msg.includes('bad_slot') ? t('open_slots.edit_error_slot_taken')
        : msg.includes('not_allowed') ? t('open_slots.edit_error_not_allowed')
          : describeError(t, err, 'open_slots.error_publish'))
    } finally {
      setSaving(false)
    }
  }

  const label = 'block text-sm font-medium text-gray-700 mb-2'

  return (
    <StepPage
      title={edit ? t('open_slots.edit_title') : t('open_slots.publish_title')}
      step={step}
      total={2}
      stepLabel={step === 1 ? t('steps.when') : t('steps.rules')}
      onBack={() => { setError(''); if (step === 1) goBack(); else setStep(1) }}
      onNext={() => { setError(''); setStep(2) }}
      nextDisabled={!date || validRanges.length === 0}
      nextHint={t('open_slots.error_missing_fields')}
      error={error}
      edit={edit ? {
        onSave: saveEdit, onCancel: goBack, dirty, saving,
        saveDisabled: !date || validRanges.length === 0, saveHint: t('open_slots.error_missing_fields'),
      } : null}
      footer={step === 2 ? (
        edit ? (
          <PrimaryButton onClick={saveEdit} disabled={saving} className="w-full">{t('open_slots.edit_save')}</PrimaryButton>
        ) : (
          <div>
            <PrimaryButton onClick={publish} disabled={saving || !org} className="w-full">
              {t('open_slots.publish_step')}
            </PrimaryButton>
            <p className="mt-1.5 text-center text-xs text-muted">{t('open_slots.publish_hint')}</p>
          </div>
        )
      ) : null}
    >
      {step === 1 ? (
        <>
          <div>
            <p className={label}>{t('open_slots.day_label')}</p>
            {/* Calendário partilhado: mostra o dia de hoje e tem o atalho
                «Hoje» (Trello #357). */}
            <div className={anyLocked ? 'pointer-events-none opacity-50' : ''} aria-disabled={anyLocked || undefined}>
              <DateField value={date} onChange={setDate} min={new Date().toISOString().slice(0, 10)} />
            </div>
            {anyLocked && <LockLine>{t('open_slots.locked_day')}</LockLine>}
          </div>
          <div>
            <p className={label}>{t('open_slots.free_times_label')}</p>
            <div className="space-y-2">
            {/* Um horário por linha, início e fim lado a lado (versão
                final, 26 set). Um horário deixado em branco não conta. */}
            {ranges.map((range, i) => {
              // Apagar um horário (Renato, 29 set: «não o consegues apagar»):
              // sempre, menos numa linha única vazia e nos que já têm alguém.
              // No editar, o jogo desse horário é cancelado ao gravar.
              const canRemove = !range.locked && (ranges.length > 1 || range.start || range.end)
              return (
              <div key={range.gameId || `new-${i}`}>
                <div className={`grid gap-2 ${canRemove ? 'grid-cols-[1fr_1fr_44px]' : 'grid-cols-2'}`}>
                  <div className={range.locked ? 'pointer-events-none opacity-50' : ''}>
                    <TimeField value={range.start} onChange={(v) => updateRange(i, 'start', v)}
                      hint={t('open_slots.start_hint')} />
                  </div>
                  <div className={range.locked ? 'pointer-events-none opacity-50' : ''}>
                    <TimeField value={range.end} onChange={(v) => updateRange(i, 'end', v)}
                      hint={t('open_slots.end_hint')} min={range.start || null} />
                  </div>
                  {canRemove && (
                    <button type="button" onClick={() => removeRange(i)} aria-label={t('open_slots.remove_range')}
                      className="inline-flex min-h-[44px] items-center justify-center rounded-ctrl text-ink-500 hover:bg-ink-50 hover:text-danger">
                      <X size={18} />
                    </button>
                  )}
                </div>
                {range.locked && <LockLine>{t('open_slots.locked_slot')}</LockLine>}
              </div>
              )
            })}
            <button type="button" onClick={() => setRanges((rs) => [...rs, EMPTY_RANGE()])}
              className="press inline-flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-ctrl border border-dashed border-ink-200 text-sm font-extrabold text-ink-900">
              <Plus size={16} /> {t('open_slots.join_time')}
            </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div>
            <p className={label}>{t('open_slots.price_label')}</p>
            <input type="number" step="0.01" min="0" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)}
              className="input-field" placeholder={t('open_slots.price_example')} />
            {/* O preço novo vale para os horários sem ninguém; nos outros fica
                o de antes (base de dados do Dev 3, decisão do PO, 28 set). */}
            {anyLocked && <LockLine>{t('open_slots.locked_price')}</LockLine>}
          </div>
          <WhatsappHoursField organizationId={org?.id} kind="open_slot" value={horas} onChange={setHoras} />
        </>
      )}
    </StepPage>
  )
}
