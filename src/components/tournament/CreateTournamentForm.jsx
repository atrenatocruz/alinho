// Criar um torneio, por passos (Trello #361, print 07 do desenho aprovado).
// Quatro passos, pela ordem em que o organizador pensa:
//   1 quando e onde · 2 campos e horas · 3 categorias · 4 regras
// O formato só se escolhe depois de fechadas as inscrições (outro cartão) —
// aqui não aparece, porque nesta altura ainda não se sabe quantas duplas há.
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ImagePlus, Plus, Trash2, X } from 'lucide-react'
import { DateField, PrimaryButton } from '../ui'
import { categoryCode, categoryName, stepProblem, totalCourtHours, totalSlots } from '../../lib/tournaments'
import { MonoLabel } from './TournamentBits'
import { removeTournamentPoster, uploadTournamentPoster } from '../../lib/tournamentPosterStorage'
import { describeError } from '../../lib/errors'

const DEFAULT_RULES = {
  entry_mode: 'dupla',        // dupla | sozinho | as_duas
  scoring: 'pro_set_9',
  duration_min: 30,
  duration_max: 60,
  max_consecutive: 2,         // nunca 3 seguidos (SPEC §6)
  arrive_before: 20,
  early_notice: 30,
  tolerance: 10,
  selection: 'manual',        // manual | pontos
  max_categories: 2,
}

const SCORINGS = ['pro_set_9', 'melhor_2_sets', 'melhor_3_sets']
const GENDERS = ['masculino', 'feminino', 'misto']

const pad = (n) => String(n).padStart(2, '0')
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Campo de texto simples, com o rótulo em mono como nos wireframes. */
function Field({ label, children, hint }) {
  return (
    <div className="mt-3">
      <MonoLabel className="mb-1.5">{label}</MonoLabel>
      {children}
      {hint && <p className="mt-1 text-[11.5px] text-ink-500">{hint}</p>}
    </div>
  )
}

const inputClass = 'w-full rounded-ctrl border border-line bg-canvas px-3 py-2.5 text-sm text-ink-900 placeholder:text-ink-300'

function Chip({ on, onClick, children, muted }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-1.5 text-[12.5px] transition-colors ${
        on ? 'border-2 border-ok px-[11px] py-[5px] font-semibold text-ink-900'
          : muted ? 'border border-line text-ink-300' : 'border border-line text-ink-700 hover:bg-ink-50'
      }`}
    >
      {children}
    </button>
  )
}

function Segmented({ options, value, onChange }) {
  return (
    <div className="flex rounded-ctrl bg-ink-50 p-[3px]">
      {options.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={`flex-1 rounded-[10px] py-1.5 text-[12px] font-semibold transition-colors ${
            value === key ? 'bg-canvas text-ink-900 shadow-lift' : 'text-ink-500'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/** Serve para criar e para editar. A editar, `initial` traz o torneio como
 *  o admin o escreveu; `locked` (há inscrições) deixa mudar só o que não
 *  estraga inscrições feitas — é a mesma regra que o update_tournament
 *  impõe do lado da base de dados. */
export default function CreateTournamentForm({ club, initial = null, locked = false, onCancel, onCreate, saving, error }) {
  const { t, i18n } = useTranslation()
  const [step, setStep] = useState(1)
  const [addingDay, setAddingDay] = useState(false)
  // O aviso do que falta só aparece depois de se tentar avançar — antes
  // disso seria um ecrã a dizer que está errado ainda antes de se escrever.
  const [tried, setTried] = useState(false)
  const fileInput = useRef(null)
  const [poster, setPoster] = useState({ busy: false, error: '' })
  const [editing, setEditing] = useState(null) // índice da categoria aberta, ou 'new'
  const [draft, setDraft] = useState(() => ({
    name: initial?.tournament?.name || '',
    location: initial?.tournament?.location || club?.location || club?.name || '',
    poster_url: initial?.tournament?.poster_url || null,
    entries_close_at: (initial?.tournament?.entries_deadline || '').slice(0, 16),
    draw_at: (initial?.tournament?.draw_on || '').slice(0, 10),
    days: (initial?.days || []).map((d) => ({
      date: d.date, starts_at: (d.starts_at || '').slice(0, 5), ends_at: (d.ends_at || '').slice(0, 5), courts: d.courts,
    })),
    courts: (initial?.courts || []).map((c) => c.name),
    categories: (initial?.categories || []).map((c) => ({
      code: c.code, name: c.name, gender: c.gender, level: c.level,
      day: c.day_date, start_time: (c.start_time || '').slice(0, 5),
      slots: c.slots, price: Math.round((c.price_cents || 0) / 100),
    })),
    organizer_text: initial?.tournament?.organizer_text || '',
    rules: { ...DEFAULT_RULES, ...(initial?.tournament?.rules || {}) },
  }))
  const editing_existing = !!initial

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))
  const setRule = (key, value) => setDraft((d) => ({ ...d, rules: { ...d.rules, [key]: value } }))
  const hours = useMemo(() => totalCourtHours(draft.days), [draft.days])
  const problem = stepProblem(step, draft)
  const firstDay = draft.days.length ? [...draft.days].map((d) => d.date).sort()[0] : null

  const addDay = (date) => {
    if (!date || draft.days.some((d) => d.date === date)) return
    const last = draft.days[draft.days.length - 1]
    set({
      days: [...draft.days, {
        date,
        starts_at: last?.starts_at || '09:00',
        ends_at: last?.ends_at || '21:00',
        courts: last?.courts || club?.courts || 4,
      }].sort((a, b) => a.date.localeCompare(b.date)),
    })
    setAddingDay(false)
  }
  const patchDay = (i, patch) => set({ days: draft.days.map((d, k) => (k === i ? { ...d, ...patch } : d)) })

  const saveCategory = (cat) => {
    const list = [...draft.categories]
    if (editing === 'new') list.push(cat)
    else list[editing] = cat
    set({ categories: list })
    setEditing(null)
  }

  const pickPoster = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPoster({ busy: true, error: '' })
    try {
      const url = await uploadTournamentPoster(club?.id, file)
      set({ poster_url: url })
      setPoster({ busy: false, error: '' })
    } catch (err) {
      setPoster({ busy: false, error: describeError(t, err, 'tournament.create.poster_error') })
    }
  }

  const removePoster = async () => {
    const url = draft.poster_url
    set({ poster_url: null })
    setPoster({ busy: false, error: '' })
    try { await removeTournamentPoster(url) } catch { /* ficheiro órfão não estraga o ecrã */ }
  }

  const publish = (status) => onCreate({
    ...draft,
    is_public: true,
    status,
    categories: draft.categories.map((c) => ({ ...c, slots: Number(c.slots), price: Number(c.price) || 0 })),
  })

  // "Sex 9 out" — dia curto, como nos chips do print 07.
  const dayLabel = (iso) => {
    const d = new Date(`${iso}T12:00`)
    const part = (opt) => d.toLocaleDateString(i18n.language, opt).replace('.', '')
    const weekday = part({ weekday: 'short' })
    return `${weekday.charAt(0).toUpperCase() + weekday.slice(1)} ${d.getDate()} ${part({ month: 'short' })}`
  }

  return (
    <div>
      <button type="button" onClick={step === 1 ? onCancel : () => setStep(step - 1)} className="inline-flex items-center gap-1.5 text-sm font-extrabold text-ink-700 hover:underline">
        <ArrowLeft size={16} /> {step === 1 ? t('tournament.create.cancel') : t('common.back')}
      </button>

      <h2 className="mt-3 font-display text-lg font-extrabold text-ink-900">
        {editing_existing ? t('tournament.create.edit_title') : t('tournament.create.title')}
      </h2>
      {locked ? (
        <p className="mt-1.5 text-[11.5px] text-ink-500">{t('tournament.create.edit_locked')}</p>
      ) : (
        <>
          <div className="mt-1.5 flex gap-1">
            {[1, 2, 3, 4].map((n) => (
              <i key={n} className={`h-1 flex-1 rounded-sm ${n <= step ? 'bg-ink-900' : 'bg-ink-50'}`} />
            ))}
          </div>
          <p className="mt-1.5 text-[11.5px] text-ink-500">{t(`tournament.create.step${step}`)}</p>
        </>
      )}

      {/* Com inscrições feitas, só se mexe no que não as estraga — é a mesma
          regra que o update_tournament impõe na base de dados. */}
      {locked && (
        <>
          <Field label={t('tournament.create.name')}>
            <input className={inputClass} value={draft.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label={t('tournament.create.location')}>
            <input className={inputClass} value={draft.location} onChange={(e) => set({ location: e.target.value })} />
          </Field>
          <Field label={t('tournament.create.entries_until')}>
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <DateField value={draft.entries_close_at.slice(0, 10)} onChange={(v) => set({ entries_close_at: `${v}T${draft.entries_close_at.slice(11) || '23:59'}` })} />
              </div>
              <input type="time" className="w-[104px] rounded-ctrl border border-line bg-canvas px-2 py-2.5 text-sm" value={draft.entries_close_at.slice(11) || '23:59'} onChange={(e) => set({ entries_close_at: `${draft.entries_close_at.slice(0, 10)}T${e.target.value}` })} />
            </div>
          </Field>
          <Field label={t('tournament.create.draw')} hint={t('tournament.create.draw_hint')}>
            <DateField value={draft.draw_at} onChange={(v) => set({ draw_at: v })} />
          </Field>
          <Field label={t('tournament.create.organizer_text')}>
            <textarea rows={3} className={inputClass} value={draft.organizer_text} onChange={(e) => set({ organizer_text: e.target.value })} />
          </Field>
        </>
      )}

      {/* 1 · Quando e onde */}
      {!locked && step === 1 && (
        <>
          <Field label={t('tournament.create.name')}>
            <input className={inputClass} value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder={t('tournament.create.name_placeholder')} />
          </Field>
          <Field label={t('tournament.create.days')} hint={t('tournament.create.days_hint')}>
            <div className="flex flex-wrap gap-1.5">
              {draft.days.map((d) => (
                <span key={d.date} className="inline-flex items-center gap-1.5 rounded-full bg-ink-900 px-3 py-1.5 text-[12.5px] font-semibold text-white">
                  {dayLabel(d.date)}
                  <button type="button" aria-label={t('tournament.create.remove')} onClick={() => set({ days: draft.days.filter((x) => x.date !== d.date) })}>
                    <X size={13} />
                  </button>
                </span>
              ))}
              {addingDay ? (
                <div className="w-full"><DateField value="" min={isoDate(new Date())} onChange={addDay} placeholder={t('tournament.create.pick_day')} /></div>
              ) : (
                <Chip onClick={() => setAddingDay(true)}><Plus size={13} /> {t('tournament.create.add_day')}</Chip>
              )}
            </div>
          </Field>
          <Field label={t('tournament.create.location')}>
            <input className={inputClass} value={draft.location} onChange={(e) => set({ location: e.target.value })} />
          </Field>
          <Field label={t('tournament.create.entries_until')}>
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <DateField value={draft.entries_close_at.slice(0, 10)} max={firstDay || undefined} onChange={(v) => set({ entries_close_at: `${v}T${draft.entries_close_at.slice(11) || '23:59'}` })} />
              </div>
              <input type="time" className="w-[104px] rounded-ctrl border border-line bg-canvas px-2 py-2.5 text-sm" value={draft.entries_close_at.slice(11) || '23:59'} onChange={(e) => set({ entries_close_at: `${draft.entries_close_at.slice(0, 10) || firstDay || ''}T${e.target.value}` })} />
            </div>
          </Field>
          <Field label={t('tournament.create.draw')} hint={t('tournament.create.draw_hint')}>
            <DateField value={draft.draw_at} max={firstDay || undefined} onChange={(v) => set({ draw_at: v })} />
          </Field>
          <Field label={t('tournament.create.poster')} hint={draft.poster_url ? null : t('tournament.create.poster_hint')}>
            {draft.poster_url ? (
              <div className="relative overflow-hidden rounded-ctrl border border-line">
                <img src={draft.poster_url} alt={t('tournament.create.poster')} className="block max-h-60 w-full object-cover" />
                <button
                  type="button"
                  onClick={removePoster}
                  aria-label={t('tournament.create.poster_remove')}
                  className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-ink-900/80 text-white"
                >
                  <X size={15} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={poster.busy}
                onClick={() => fileInput.current?.click()}
                className={`${inputClass} flex items-center gap-2 text-left text-ink-500 disabled:opacity-60`}
              >
                <ImagePlus size={18} />
                {poster.busy ? t('tournament.create.poster_uploading') : t('tournament.create.poster_pick')}
              </button>
            )}
            <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={pickPoster} />
            {poster.error && <p className="mt-1 text-[12px] text-danger">{poster.error}</p>}
          </Field>
        </>
      )}

      {/* 2 · Campos e horas */}
      {!locked && step === 2 && (
        <>
          {draft.days.map((d, i) => (
            <div key={d.date} className="mt-2 rounded-card border border-line p-3">
              <b className="text-sm text-ink-900">{dayLabel(d.date)}</b>
              <div className="mt-2 flex items-center gap-2">
                <input type="time" className="w-[100px] rounded-ctrl border border-line bg-canvas px-2 py-2 text-sm" value={d.starts_at} onChange={(e) => patchDay(i, { starts_at: e.target.value })} />
                <span className="text-xs text-ink-500">{t('tournament.create.to')}</span>
                <input type="time" className="w-[100px] rounded-ctrl border border-line bg-canvas px-2 py-2 text-sm" value={d.ends_at} onChange={(e) => patchDay(i, { ends_at: e.target.value })} />
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input type="number" min="1" max="30" className="w-[72px] rounded-ctrl border border-line bg-canvas px-2 py-2 text-sm" value={d.courts} onChange={(e) => patchDay(i, { courts: e.target.value })} />
                <span className="text-xs text-ink-500">{t('tournament.create.courts_label')}</span>
              </div>
            </div>
          ))}
          <Field label={t('tournament.create.court_names')} hint={t('tournament.create.court_names_hint')}>
            <div className="flex flex-wrap gap-1.5">
              {draft.courts.map((name, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12.5px]">
                  {name}
                  <button type="button" aria-label={t('tournament.create.remove')} onClick={() => set({ courts: draft.courts.filter((_, k) => k !== i) })}><X size={13} /></button>
                </span>
              ))}
              <Chip onClick={() => set({ courts: [...draft.courts, t('tournament.create.court_n', { n: draft.courts.length + 1 })] })}>
                <Plus size={13} /> {t('tournament.create.add_court')}
              </Chip>
            </div>
          </Field>
          <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-[12.5px]">
            <span className="text-ink-500">{t('tournament.create.court_time')}</span>
            <b className="text-ink-900">{t('tournament.create.hours', { count: Math.round(hours) })}</b>
          </div>
        </>
      )}

      {/* 3 · Categorias */}
      {!locked && step === 3 && (
        <>
          {draft.categories.map((c, i) => (
            <div key={i} className="flex items-center gap-2.5 border-t border-line py-2">
              <span className="rounded-md bg-ink-900 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">{c.code}</span>
              <span className="min-w-0 flex-1">
                <b className="block truncate text-[13px] font-semibold text-ink-900">{c.name}</b>
                <span className="text-[11px] text-ink-500">
                  {t('tournament.create.category_line', { slots: c.slots, price: c.price || 0 })}
                  {c.day ? ` · ${dayLabel(c.day)}${c.start_time ? ` ${c.start_time}` : ''}` : ''}
                </span>
              </span>
              <button type="button" onClick={() => setEditing(i)} className="text-[11.5px] text-ink-500 hover:underline">{t('tournament.create.edit')}</button>
              <button type="button" aria-label={t('tournament.create.remove')} onClick={() => set({ categories: draft.categories.filter((_, k) => k !== i) })} className="text-ink-300 hover:text-danger">
                <Trash2 size={15} />
              </button>
            </div>
          ))}

          {editing !== null ? (
            <CategoryEditor
              value={editing === 'new' ? null : draft.categories[editing]}
              taken={draft.categories.filter((_, k) => k !== editing).map((c) => c.code)}
              days={draft.days}
              dayLabel={dayLabel}
              onCancel={() => setEditing(null)}
              onSave={saveCategory}
            />
          ) : (
            <div className="mt-3">
              <Chip onClick={() => setEditing('new')}><Plus size={13} /> {t('tournament.create.add_category')}</Chip>
            </div>
          )}

          <Field label={t('tournament.create.max_categories')}>
            <div className="flex gap-1.5">
              {[1, 2, 3].map((n) => (
                <Chip key={n} on={draft.rules.max_categories === n} onClick={() => setRule('max_categories', n)}>{n}</Chip>
              ))}
            </div>
          </Field>

          {draft.categories.length > 0 && (
            <div className="mt-3 rounded-ctrl border border-[#F5D6A8] bg-[#FFF7EC] p-2.5 text-[11.5px] text-ink-700">
              {t('tournament.create.slots_vs_hours', { teams: totalSlots(draft.categories), hours: Math.round(hours) })}
            </div>
          )}
        </>
      )}

      {/* 4 · Regras */}
      {!locked && step === 4 && (
        <>
          <Field label={t('tournament.create.entry_mode')}>
            <Segmented
              value={draft.rules.entry_mode}
              onChange={(v) => setRule('entry_mode', v)}
              options={[['dupla', t('tournament.create.entry_pair')], ['sozinho', t('tournament.create.entry_solo')], ['as_duas', t('tournament.create.entry_both')]]}
            />
          </Field>
          <Field label={t('tournament.create.scoring')}>
            <div className="flex flex-wrap gap-1.5">
              {SCORINGS.map((s) => (
                <Chip key={s} on={draft.rules.scoring === s} onClick={() => setRule('scoring', s)}>{t(`tournament.create.scoring_${s}`)}</Chip>
              ))}
            </div>
          </Field>
          <Field label={t('tournament.create.duration')} hint={t('tournament.create.duration_hint', { max: draft.rules.duration_max })}>
            <div className="flex items-center gap-2">
              <input type="number" min="15" max="180" step="5" className="w-[86px] rounded-ctrl border border-line bg-canvas px-2 py-2 text-sm" value={draft.rules.duration_min} onChange={(e) => setRule('duration_min', Number(e.target.value))} />
              <span className="text-xs text-ink-500">{t('tournament.create.to')}</span>
              <input type="number" min="15" max="180" step="5" className="w-[86px] rounded-ctrl border border-line bg-canvas px-2 py-2 text-sm" value={draft.rules.duration_max} onChange={(e) => setRule('duration_max', Number(e.target.value))} />
              <span className="text-xs text-ink-500">min</span>
            </div>
          </Field>
          <Field label={t('tournament.create.schedule')}>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                ['max_consecutive', t('tournament.create.max_consecutive'), 1, 2],
                ['arrive_before', t('tournament.create.arrive_before'), 0, 60],
                ['early_notice', t('tournament.create.early_notice'), 5, 120],
                ['tolerance', t('tournament.create.tolerance'), 0, 30],
              ].map(([key, label, min, max]) => (
                <label key={key} className="flex items-center justify-between gap-2 rounded-ctrl border border-line px-3 py-2 text-[12px] text-ink-700">
                  <span className="min-w-0">{label}</span>
                  <input type="number" min={min} max={max} className="w-[64px] rounded-md border border-line px-1.5 py-1 text-right text-sm" value={draft.rules[key]} onChange={(e) => setRule(key, Number(e.target.value))} />
                </label>
              ))}
            </div>
          </Field>
          <Field label={t('tournament.create.selection')}>
            <Segmented
              value={draft.rules.selection}
              onChange={(v) => setRule('selection', v)}
              options={[['manual', t('tournament.create.selection_manual')], ['pontos', t('tournament.create.selection_points')]]}
            />
          </Field>
          <Field label={t('tournament.create.organizer_text')}>
            <textarea rows={3} className={inputClass} value={draft.organizer_text} onChange={(e) => set({ organizer_text: e.target.value })} placeholder={t('tournament.create.organizer_text_placeholder')} />
          </Field>
        </>
      )}

      {tried && problem && <p className="mt-3 text-[12px] text-danger">{t(`tournament.create.problem_${problem}`)}</p>}
      {error && <p className="mt-3 text-[12px] text-danger">{error}</p>}

      <div className="mt-5 space-y-2">
        {locked ? (
          <PrimaryButton className="w-full" disabled={saving} onClick={() => onCreate(draft)}>{t('tournament.create.save_changes')}</PrimaryButton>
        ) : step < 4 ? (
          <PrimaryButton className="w-full" onClick={() => (problem ? setTried(true) : (setTried(false), setStep(step + 1)))}>{t('tournament.create.next')}</PrimaryButton>
        ) : (
          <>
            <PrimaryButton className="w-full" disabled={saving} onClick={() => (editing_existing ? onCreate(draft) : publish('inscricoes'))}>
              {editing_existing ? t('tournament.create.save_changes') : t('tournament.create.publish')}
            </PrimaryButton>
            {!editing_existing && (
              <button type="button" disabled={saving} onClick={() => publish('rascunho')} className="w-full rounded-ctrl border border-line py-2.5 text-sm font-semibold text-ink-700 hover:bg-ink-50">
                {t('tournament.create.save_draft')}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/** A ficha de uma categoria: género e nível dão o código (M5, MX4), e o dia
 *  e a hora são os que aparecem a quem chega de fora («sábado, a partir das
 *  12h»). */
function CategoryEditor({ value, taken = [], days, dayLabel, onCancel, onSave }) {
  const { t } = useTranslation()
  const [cat, setCat] = useState(value || {
    gender: 'masculino', level: 5, name: '', day: days[0]?.date || '', start_time: days[0]?.starts_at || '', slots: 16, price: 25,
  })
  const code = categoryCode(cat.gender, cat.level)
  const name = cat.name || categoryName(t, cat.gender, cat.level)
  const set = (patch) => setCat((c) => ({ ...c, ...patch }))
  // Num torneio há uma categoria por nível, e só uma (decisão do Francisco,
  // 22 set). Dois «M5» davam o mesmo código e a base de dados recusa-os —
  // mais vale dizê-lo aqui, em português, do que deixar o admin sem saída.
  const repeated = taken.includes(code)

  return (
    <div className="mt-3 rounded-card border border-line p-3">
      <div className="flex items-center justify-between">
        <b className="text-sm text-ink-900">{code} · {name}</b>
        <button type="button" onClick={onCancel} aria-label={t('tournament.create.cancel')} className="text-ink-300 hover:text-ink-700"><X size={16} /></button>
      </div>
      <Field label={t('tournament.create.gender')}>
        <div className="flex flex-wrap gap-1.5">
          {GENDERS.map((g) => (
            <Chip key={g} on={cat.gender === g} onClick={() => set({ gender: g, name: '' })}>{t(`tournament.create.gender_${g}`)}</Chip>
          ))}
        </div>
      </Field>
      <Field label={t('tournament.create.level')}>
        <div className="flex flex-wrap gap-1.5">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <Chip key={n} on={cat.level === n} onClick={() => set({ level: n, name: '' })}>{n}</Chip>
          ))}
        </div>
      </Field>
      <Field label={t('tournament.create.category_custom_name')}>
        <input className={inputClass} value={cat.name} onChange={(e) => set({ name: e.target.value })} placeholder={categoryName(t, cat.gender, cat.level)} />
      </Field>
      <Field label={t('tournament.create.category_when')} hint={t('tournament.create.category_when_hint')}>
        <div className="flex flex-wrap items-center gap-1.5">
          {days.map((d) => (
            <Chip key={d.date} on={cat.day === d.date} onClick={() => set({ day: d.date, start_time: cat.start_time || d.starts_at })}>{dayLabel(d.date)}</Chip>
          ))}
          <input type="time" className="w-[100px] rounded-ctrl border border-line bg-canvas px-2 py-2 text-sm" value={cat.start_time || ''} onChange={(e) => set({ start_time: e.target.value })} />
        </div>
      </Field>
      <div className="mt-3 flex gap-3">
        <div className="flex-1">
          <MonoLabel className="mb-1.5">{t('tournament.create.slots')}</MonoLabel>
          <input type="number" min="2" max="128" className={inputClass} value={cat.slots} onChange={(e) => set({ slots: e.target.value })} />
        </div>
        <div className="flex-1">
          <MonoLabel className="mb-1.5">{t('tournament.create.price')}</MonoLabel>
          <input type="number" min="0" max="500" className={inputClass} value={cat.price} onChange={(e) => set({ price: e.target.value })} />
        </div>
      </div>
      {repeated && <p className="mt-3 text-[12px] text-danger">{t('tournament.create.category_repeated', { name: categoryName(t, cat.gender, cat.level) })}</p>}
      <PrimaryButton className="mt-3 w-full" disabled={repeated || !cat.slots || Number(cat.slots) < 2} onClick={() => onSave({ ...cat, code, name })}>
        {t('tournament.create.save')}
      </PrimaryButton>
    </div>
  )
}
