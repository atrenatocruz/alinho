/* Criar e editar um mix em 4 passos (#342; desenho aprovado pelo Francisco a
   26 set: design-handoff/2026-09-26-criar-mix-passos/SPEC.md).

   Pessoas · Quando · Onde joga · Regras, numa página própria, com a moldura
   partilhada dos passos (StepPage, do Dev 2). O nome fica em cima, sempre à
   vista. Tudo vem respondido com o valor de hoje: quem não quer mudar carrega
   em «Seguinte».

   Não guarda nada sozinho: usa o MESMO estado (gameForm) e as MESMAS funções
   de gravar do formulário antigo do GerirClube, que continua por trás da
   bandeira `assistente_mix` para se poder voltar atrás em segundos.
   Os campos de hoje que o desenho não mostra vão para o passo onde a pergunta
   pertence (o grupo onde aparece → Pessoas; arranque automático → Quando;
   pontuação e tamanho dos grupos → Regras), sempre com o valor de hoje. */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Minus, Plus } from 'lucide-react'
import StepPage from '../steps/StepPage'
import LaunchDayPicker from '../LaunchDayPicker'
import { Chips, DateField, DateTimeField, Select } from '../ui'
import { advanceByFrequency } from '../../lib/mixDraft'
import { totalRounds, reverseClimbWarning } from '../../lib/mixLogic'
import { AGE_RESTRICTIONS } from '../../lib/ageCategories'
import { formatDate, formatTime } from '../../lib/formatDate'
import { LEVEL_SCALES, LEVEL_NUMBERS, parseLevel, scaleForGender, GENDER_FOR_SCALE } from '../../lib/mixLevels'
import WhatsappHoursField from '../WhatsappHoursField'
import PlacesUnavailableHint from '../PlacesUnavailableHint'

const pairsAreFixed = (form) => form.format !== 'americano' && !(form.rotate_partners && form.format === 'sobe_desce')

function Field({ label, children, hint }) {
  return (
    <div>
      <p className="text-sm font-medium text-gray-700 mb-2">{label}</p>
      {children}
      {hint && <p className="text-sm text-muted mt-1.5">{hint}</p>}
    </div>
  )
}

/**
 * props:
 *  form, setForm       — o gameForm do GerirClube
 *  editingGame         — o mix a editar (ou null ao criar)
 *  options             — { courtTimes, gameTimes, formats, scoringFormats, pairingModes, levels, scopes }
 *  mixScopeId, setMixScopeId
 *  maxCourts           — limite do plano
 *  locationInputRef    — o autocompletar da Google liga-se a este campo
 *  launchDayError, clearLaunchDayError
 *  error               — erro ao gravar (fica por cima do botão)
 *  onCancel            — sair sem gravar
 *  onSubmit(asDraft)   — criar (publicar ou rascunho) / guardar a edição
 *  editExtras          — ao editar: pausar, outras datas, parar, eliminar (vêm do GerirClube)
 *  organizationId      — o clube (ou o grupo do âmbito) do mix: o dos grupos de WhatsApp
 */
export default function MixWizard({
  form, setForm, editingGame, options, mixScopeId, setMixScopeId, maxCourts, locationInputRef,
  launchDayError, clearLaunchDayError, error, onCancel, onSubmit, editExtras = null, organizationId = null,
}) {
  const { t, i18n } = useTranslation()
  const [step, setStep] = useState(1)
  const [busy, setBusy] = useState(false)
  // Sempre sobre o form mais recente: o campo das horas do WhatsApp
  // preenche-se depois de uma ida à base de dados, e um set com o form de
  // antes apagava o que se escreveu entretanto.
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const setRec = (patch) => setForm((f) => ({ ...f, recurrence: { ...f.recurrence, ...patch } }))
  const rec = form.recurrence
  const labels = [t('steps.people'), t('steps.when'), t('steps.where'), t('steps.rules')]
  const numCourts = parseInt(form.num_courts, 10) || 1
  const rankedLocked = editingGame && ['in_progress', 'finished'].includes(editingGame.status)
  // O nível: «Qualquer nível» ou «Escolher» → aparecem os níveis de hoje.
  const [pickLevel, setPickLevel] = useState(!!form.level)
  // Masculino, Feminino ou Misto, de 1 a 6 (#577). O escalão começa pelo
  // «Quem pode entrar» (só mulheres → F, misto → MX) e pode mudar-se.
  const [levelScale, setLevelScale] = useState(parseLevel(form.level)?.scale || scaleForGender(form.gender_restriction))
  const levelNum = parseLevel(form.level)?.num

  // O que falta em cada passo para o «Seguinte» andar.
  const missing = (() => {
    if (step === 1 && !form.title.trim()) return t('mixwizard.missing_title')
    if (step === 2) {
      if (!form.date) return t('mixwizard.missing_date')
      // Um mix não se marca para o passado (Ruben, 29 set). Ao editar, a
      // data que o mix já tinha continua a servir — só se mexer é que conta.
      if (new Date(form.date) < new Date()
          && !(editingGame?.date && new Date(editingGame.date).getTime() === new Date(form.date).getTime())) {
        return t('mixwizard.date_in_past')
      }
      if (rec.enabled && !(parseInt(rec.launchDaysBefore, 10) >= 1)) return t('gerirclube.validate_launch_days_before')
      if (rec.enabled && rec.endsType === 'on_date' && !rec.endsOn) return t('gerirclube.validate_end_date')
      if (rec.enabled && rec.endsType === 'after_occurrences' && !(parseInt(rec.endsAfterOccurrences, 10) >= 1)) return t('gerirclube.validate_occurrences_count')
    }
    return null
  })()

  const back = () => (step === 1 ? onCancel() : setStep(step - 1))
  const next = () => { if (!missing) { setStep(step + 1); window.scrollTo?.(0, 0) } }
  const submit = async (asDraft) => {
    setBusy(true)
    try { await onSubmit(asDraft) } finally { setBusy(false) }
  }

  const nameTop = (
    <input
      type="text"
      value={form.title}
      onChange={(e) => set({ title: e.target.value })}
      className="input-field text-base font-extrabold"
      placeholder={t('gerirclube.title_placeholder')}
      aria-label={t('gerirclube.title_label')}
    />
  )

  const footer = step === 4 ? (
    editingGame ? (
      <div className="space-y-4">
        <button type="button" disabled={busy} onClick={() => submit(false)} className="btn-primary w-full disabled:opacity-40">
          {t('mixwizard.save_changes')}
        </button>
        {editExtras}
      </div>
    ) : (
      <div className="space-y-2">
        <button type="button" disabled={busy} onClick={() => submit(false)} className="btn-primary w-full disabled:opacity-40">
          {t('mixdraft.publish_mix')}
        </button>
        <p className="text-xs text-muted text-center">{t('mixdraft.publish_mix_hint')}</p>
        <button type="button" disabled={busy} onClick={() => submit(true)} className="btn-secondary w-full !mt-3 disabled:opacity-40">
          {t('mixdraft.save_draft')}
        </button>
        <p className="text-xs text-muted text-center">{t('mixdraft.save_draft_hint')}</p>
      </div>
    )
  ) : null

  // O mix que abre com a regra da repetição (o seguinte ao de hoje).
  const nextMix = form.date ? advanceByFrequency(new Date(form.date), rec.frequency) : null

  return (
    <StepPage
      title={editingGame ? t('mixwizard.title_edit') : t('mixwizard.title_new')}
      step={step}
      total={4}
      stepLabel={labels[step - 1]}
      onBack={back}
      top={nameTop}
      onNext={next}
      nextDisabled={!!missing}
      nextHint={missing}
      footer={footer}
      error={step === 4 ? error : ''}
    >
      {/* Os 4 passos ficam montados e só se mostra um: o autocompletar do
          local liga-se ao campo mal a página abre, e nada se perde a voltar. */}
      <div className={step === 1 ? 'space-y-5' : 'hidden'}>
        {options.scopes.length > 1 && !editingGame && (
          <Field label={t('mixwizard.scope_label')}>
            <Select value={mixScopeId} onChange={setMixScopeId} options={options.scopes} />
          </Field>
        )}
        <Field label={t('mixwizard.who_label')}>
          <Chips
            label={t('mixwizard.who_label')}
            value={form.gender_restriction}
            onChange={(v) => {
              // O nível segue «Quem pode entrar» (QA, 27 set): um mix só de
              // mulheres com nível M saía nos grupos de WhatsApp masculinos.
              if (v === 'indiferente') { set({ gender_restriction: v }); return }
              const s = scaleForGender(v)
              setLevelScale(s)
              set({ gender_restriction: v, ...(levelNum ? { level: `${s}${levelNum}` } : {}) })
            }}
            options={[
              { value: 'indiferente', label: t('mixwizard.who_anyone') },
              { value: 'masculino', label: t('mixwizard.who_men') },
              { value: 'feminino', label: t('mixwizard.who_women') },
              { value: 'misto', label: t('mixwizard.who_mixed') },
            ]}
          />
        </Field>
        <Field label={t('mixwizard.level_label')} hint={pickLevel ? t('mixwizard.level_hint') : null}>
          <Chips
            label={t('mixwizard.level_label')}
            value={pickLevel ? 'pick' : 'any'}
            onChange={(v) => {
              setPickLevel(v === 'pick')
              if (v === 'any') set({ level: '' })
              else setLevelScale(parseLevel(form.level)?.scale || scaleForGender(form.gender_restriction))
            }}
            options={[
              { value: 'any', label: t('mixwizard.level_any') },
              { value: 'pick', label: t('mixwizard.level_pick') },
            ]}
          />
          {pickLevel && (
            <div className="mt-2">
              <Chips label={t('mixlevels.scale_label')} value={levelScale}
                onChange={(s) => {
                  // …e o contrário: escolher o escalão acerta «Quem pode entrar».
                  setLevelScale(s)
                  set({ gender_restriction: GENDER_FOR_SCALE[s], ...(levelNum ? { level: `${s}${levelNum}` } : {}) })
                }}
                options={LEVEL_SCALES.map((s) => ({ value: s, label: t(`mixlevels.scale_${s.toLowerCase()}`) }))} />
              <div className="mt-2">
                <Chips label={t('mixwizard.level_label')} value={form.level} onChange={(v) => set({ level: v })}
                  options={LEVEL_NUMBERS.map((n) => ({ value: `${levelScale}${n}`, label: String(n) }))} />
              </div>
            </div>
          )}
        </Field>
        <Field label={t('mixwizard.age_label')}>
          <Chips
            label={t('mixwizard.age_label')}
            value={form.age_restriction || ''}
            onChange={(v) => set({ age_restriction: v || null })}
            options={[{ value: '', label: t('gerirclube.age_any') }, ...AGE_RESTRICTIONS.map((a) => ({ value: a.value, label: t(a.labelKey) }))]}
          />
        </Field>
        <Field label={t('mixwizard.signup_label')} hint={form.allow_pair_signup && !pairsAreFixed(form) ? t('mixwizard.signup_needs_fixed') : null}>
          <Chips
            label={t('mixwizard.signup_label')}
            value={form.allow_pair_signup ? 'pair' : 'solo'}
            onChange={(v) => set({ allow_pair_signup: v === 'pair' })}
            options={[
              { value: 'solo', label: t('mixwizard.signup_solo') },
              { value: 'pair', label: t('mixwizard.signup_pair') },
            ]}
          />
        </Field>
        <p className="text-sm text-muted">{t('mixwizard.prefilled_hint')}</p>
      </div>

      <div className={step === 2 ? 'space-y-5' : 'hidden'}>
        <Field label={t('mixwizard.date_label')}>
          <DateTimeField value={form.date} onChange={(v) => set({ date: v })} min={new Date()} />
        </Field>
        {(!editingGame || !editingGame.recurrence || editingGame.recurrence.is_active) && (
          <Field label={t('mixwizard.repeat_label')}>
            <Chips
              label={t('mixwizard.repeat_label')}
              value={rec.enabled ? rec.frequency : 'no'}
              onChange={(v) => (v === 'no' ? setRec({ enabled: false }) : setRec({ enabled: true, frequency: v }))}
              options={[
                { value: 'no', label: t('mixwizard.repeat_no') },
                ...(rec.enabled && rec.frequency === 'daily' ? [{ value: 'daily', label: t('gerirclube.freq_daily') }] : []),
                { value: 'weekly', label: t('mixwizard.repeat_weekly') },
                { value: 'monthly', label: t('mixwizard.repeat_monthly') },
                ...(rec.enabled && rec.frequency === 'yearly' ? [{ value: 'yearly', label: t('gerirclube.freq_yearly') }] : []),
              ]}
            />
          </Field>
        )}
        {/* Numa série, o dia escolhido é o dos mixes seguintes; o primeiro
            abre ao publicar — e isso tem de estar escrito (QA, 27 set). */}
        {rec.enabled && !editingGame && form.date && (
          <p className="text-sm text-ink-700">
            {t('mixwizard.first_opens_now', { date: formatDate(form.date, i18n.language, { weekday: 'short', day: 'numeric', month: 'numeric' }).replace(/\./g, '') })}
          </p>
        )}
        {rec.enabled ? (
          <LaunchDayPicker
            key={`${editingGame?.id || 'novo'}-${rec.frequency}`}
            mixDate={nextMix}
            frequency={rec.frequency}
            daysBefore={rec.launchDaysBefore}
            onDaysBefore={(v) => { clearLaunchDayError(); setRec({ launchDaysBefore: String(v) }) }}
            time={rec.launchTime}
            onTime={(v) => setRec({ launchTime: v })}
            error={launchDayError}
          />
        ) : !editingGame && (
          // Num mix que não se repete: «Já» (abre ao publicar) ou um dos dias
          // antes — o mix fica 'pending' com launch_at e abre sozinho a essa
          // hora (migration_abrem_inscricoes.sql, Dev 3, 27 set).
          <LaunchDayPicker
            allowNow
            mixDate={form.date ? new Date(form.date) : null}
            frequency={null}
            daysBefore={form.launch?.daysBefore ?? '0'}
            onDaysBefore={(v) => { clearLaunchDayError(); set({ launch: { ...(form.launch || {}), daysBefore: String(v) } }) }}
            time={form.launch?.time || '10:00'}
            onTime={(v) => { clearLaunchDayError(); set({ launch: { ...(form.launch || {}), time: v } }) }}
            error={launchDayError}
          />
        )}
        {rec.enabled && (
          <Field label={t('mixwizard.ends_label')}>
            <Chips
              label={t('mixwizard.ends_label')}
              value={rec.endsType}
              onChange={(v) => setRec({ endsType: v })}
              options={[
                { value: 'never', label: t('mixwizard.ends_never') },
                { value: 'on_date', label: t('mixwizard.ends_on_date') },
                { value: 'after_occurrences', label: t('mixwizard.ends_after') },
              ]}
            />
            {rec.endsType === 'on_date' && (
              <div className="mt-2">
                <DateField value={rec.endsOn} onChange={(v) => setRec({ endsOn: v })} placeholder={t('gerirclube.end_date_placeholder')} />
              </div>
            )}
            {rec.endsType === 'after_occurrences' && (
              <input type="number" min="1" inputMode="numeric" value={rec.endsAfterOccurrences}
                onChange={(e) => setRec({ endsAfterOccurrences: e.target.value })}
                className="input-field mt-2" placeholder={t('gerirclube.occurrences_placeholder')} />
            )}
          </Field>
        )}
        <Field label={t('gerirclube.auto_start_label')} hint={t('gerirclube.auto_start_help')}>
          <input type="number" min="1" inputMode="numeric" value={form.auto_start_hours_before}
            onChange={(e) => set({ auto_start_hours_before: e.target.value })}
            className="input-field" placeholder={t('gerirclube.auto_start_placeholder')} />
          {(() => {
            const hours = parseInt(form.auto_start_hours_before, 10)
            const mixDate = form.date ? new Date(form.date) : null
            if (!hours || hours <= 0 || !mixDate || Number.isNaN(mixDate.getTime())) return null
            const openDate = new Date(mixDate.getTime() - hours * 3_600_000)
            const sameDay = openDate.toDateString() === mixDate.toDateString()
            const dateLabel = sameDay ? '' : `${formatDate(openDate, i18n.language, { day: 'numeric', month: 'long' })} `
            return (
              <p className="text-sm text-ink-900 mt-1.5">
                {t('gerirclube.auto_start_preview', { date: dateLabel, time: formatTime(openDate, i18n.language, { hour: '2-digit', minute: '2-digit' }) })}
              </p>
            )
          })()}
        </Field>
      </div>

      <div className={step === 3 ? 'space-y-5' : 'hidden'}>
        <Field label={t('gerirclube.location_label')}>
          <input
            ref={locationInputRef}
            type="text"
            value={form.location}
            // Escrever a morada à mão invalida as coordenadas (Trello #203).
            onChange={(e) => set({ location: e.target.value, latitude: null, longitude: null })}
            className="input-field"
            placeholder={t('gerirclube.location_placeholder')}
          />
          <PlacesUnavailableHint />
        </Field>
        <Field label={t('mixwizard.courts_label')}>
          <div className="flex items-center gap-3">
            <div className="inline-flex items-center rounded-ctrl border border-line bg-canvas">
              <button type="button" aria-label="−" onClick={() => set({ num_courts: Math.max(1, numCourts - 1) })}
                className="w-11 h-11 flex items-center justify-center text-ink-900"><Minus size={16} /></button>
              <span className="w-8 text-center font-extrabold tabular-nums">{numCourts}</span>
              <button type="button" aria-label="+" onClick={() => set({ num_courts: Math.min(Math.max(maxCourts, numCourts), numCourts + 1) })}
                className="w-11 h-11 flex items-center justify-center text-ink-900"><Plus size={16} /></button>
            </div>
            <p className="text-sm text-muted">
              = <strong className="text-ink-900">{t('gerirclube.players_count', { count: numCourts * 4 })}</strong> {t('mixwizard.per_court')}
            </p>
          </div>
          {numCourts >= maxCourts && <p className="text-sm text-muted mt-1.5">{t('mixwizard.courts_plan_max', { max: maxCourts })}</p>}
        </Field>
        <Field label={t('mixwizard.court_time_label')} hint={t('mixwizard.court_time_hint')}>
          <Chips label={t('mixwizard.court_time_label')} value={form.court_time_minutes}
            onChange={(v) => set({ court_time_minutes: v })} options={options.courtTimes} />
        </Field>
      </div>

      <div className={step === 4 ? 'space-y-5' : 'hidden'}>
        <Field label={t('gerirclube.format_label')}
          hint={t(`mixlogic.format_help_${form.format === 'sobe_desce' && form.rotate_partners ? 'sobe_desce_rotate' : form.format}`)}>
          <Chips label={t('gerirclube.format_label')} value={form.format} options={options.formats}
            onChange={(v) => set({
              format: v,
              ...(v === 'americano' ? { scoring_format: 'pontos_simples' } : {}),
              ...(v !== 'sobe_desce' ? { rotate_partners: false, seed_reverse: false } : {}),
            })} />
        </Field>
        {form.format === 'grupos_eliminatorias' && (
          <Field label={t('gerirclube.pool_size_label')} hint={t('gerirclube.pool_size_help')}>
            <input type="number" min="3" max="8" value={form.pool_size}
              onChange={(e) => set({ pool_size: e.target.value })} className="input-field" />
          </Field>
        )}
        <Field label={t('mixwizard.game_time_label')}
          hint={t('mixwizard.rounds_in', { count: totalRounds(form), time: options.courtTimes.find((c) => c.value === form.court_time_minutes)?.label || `${form.court_time_minutes}min` })}>
          <Chips label={t('mixwizard.game_time_label')} value={form.game_time_minutes}
            onChange={(v) => set({ game_time_minutes: v })} options={options.gameTimes} />
        </Field>
        {form.format !== 'americano' && (
          <Field label={t('gerirclube.scoring_label')}>
            <Chips label={t('gerirclube.scoring_label')} value={form.scoring_format}
              onChange={(v) => set({ scoring_format: v })} options={options.scoringFormats} />
          </Field>
        )}
        {/* O 8-8 do pro set (#580), como no torneio: tie-break a 7 (FPP) ou
            super tie-break a 10. */}
        {form.format !== 'americano' && form.scoring_format === 'pro_set_9' && (
          <Field label={t('tournament.create.tiebreak_8_8')}>
            <Chips label={t('tournament.create.tiebreak_8_8')} value={form.tiebreak_8_8 || 'tiebreak'}
              onChange={(v) => set({ tiebreak_8_8: v })}
              options={[
                { value: 'tiebreak', label: t('tournament.create.tiebreak_8_8_tiebreak') },
                { value: 'super_tiebreak', label: t('tournament.create.tiebreak_8_8_super_tiebreak') },
              ]} />
          </Field>
        )}
        {form.format === 'sobe_desce' && (
          <Field label={t('mixwizard.pairs_label')}
            hint={t(form.rotate_partners ? 'gerirclube.rotate_partners_rotate_help' : 'gerirclube.rotate_partners_fixed_help')}>
            <Chips label={t('mixwizard.pairs_label')} value={form.rotate_partners ? 'rotate' : 'fixed'}
              onChange={(v) => set({ rotate_partners: v === 'rotate' })}
              options={[
                { value: 'fixed', label: t('gerirclube.rotate_partners_fixed') },
                { value: 'rotate', label: t('gerirclube.rotate_partners_rotate') },
              ]} />
          </Field>
        )}
        {/* Sobe e desce invertido (Renato, 29 set): as mais fortes começam
            no último campo e têm de subir até ao Campo 1. */}
        {form.format === 'sobe_desce' && (
          <Field label={t('gerirclube.seed_reverse_label')}
            hint={t(form.seed_reverse ? 'gerirclube.seed_reverse_reverse_help' : 'gerirclube.seed_reverse_normal_help')}>
            <Chips label={t('gerirclube.seed_reverse_label')} value={form.seed_reverse ? 'reverse' : 'normal'}
              onChange={(v) => set({ seed_reverse: v === 'reverse' })}
              options={[
                { value: 'normal', label: t('gerirclube.seed_reverse_normal') },
                { value: 'reverse', label: t('gerirclube.seed_reverse_reverse') },
              ]} />
            {/* Dá tempo para subir? (29 set) — sobem um campo por ronda. */}
            {form.seed_reverse && (() => {
              const courts = parseInt(form.num_courts, 10) || 1
              const rounds = totalRounds(form)
              const warn = reverseClimbWarning({ numCourts: courts, rounds })
              return warn ? (
                <p role="status" className={`mt-2 rounded-ctrl px-3 py-2 text-sm font-bold ${warn === 'cant_reach' ? 'bg-warning/10 text-[#92400E]' : 'bg-ink-50 text-ink-700'}`}>
                  {t(`gerirclube.seed_reverse_warn_${warn}`, { courts, rounds })}
                </p>
              ) : null
            })()}
          </Field>
        )}
        <Field label={t('mixwizard.pairing_label')}
          hint={t(options.pairingModes.find((o) => o.value === form.pairing_mode)?.helpKey || 'gerirclube.pairing_mode_por_nivel_help')}>
          <Chips label={t('mixwizard.pairing_label')} value={form.pairing_mode} onChange={(v) => set({ pairing_mode: v })}
            options={options.pairingModes.map((o) => ({ value: o.value, label: t(o.shortKey || o.labelKey) }))} />
        </Field>
        <Field label={t('mixwizard.ranked_label')}
          hint={rankedLocked ? null : t(form.ranked ? 'gerirclube.ranked_yes_help' : 'gerirclube.ranked_no_help')}>
          {rankedLocked ? (
            <p className="text-sm text-muted">{t(form.ranked ? 'gerirclube.ranked_locked_yes' : 'gerirclube.ranked_locked_no')}</p>
          ) : (
            <Chips label={t('mixwizard.ranked_label')} value={form.ranked ? 'yes' : 'no'} onChange={(v) => set({ ranked: v === 'yes' })}
              options={[{ value: 'yes', label: t('gerirclube.ranked_yes') }, { value: 'no', label: t('gerirclube.ranked_no') }]} />
          )}
        </Field>
        <Field label={t('mixwizard.price_label')}>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center gap-2 input-field">
              <input type="number" step="0.5" min="0" inputMode="decimal" value={form.price_per_player}
                onChange={(e) => set({ price_per_player: e.target.value })}
                className="w-full min-w-0 bg-transparent outline-none text-base" placeholder="8" />
              <span className="shrink-0 text-sm text-muted">{t('mixwizard.per_person')}</span>
            </label>
            <input type="text" value={form.prize} onChange={(e) => set({ prize: e.target.value })}
              className="input-field" placeholder={t('mixwizard.prize_placeholder')} />
          </div>
          <label className="flex items-center gap-3 cursor-pointer mt-3">
            <input type="checkbox" checked={form.has_voucher} onChange={(e) => set({ has_voucher: e.target.checked })} className="w-5 h-5" />
            <span className="text-sm text-ink-900">{t('gerirclube.has_voucher_label')}</span>
          </label>
        </Field>
        {/* Lembretes no WhatsApp dentro do evento (design-handoff/
            2026-09-27-whatsapp-no-evento): no último passo, por cima do botão
            final. Sempre kind="mix" — é daí que vêm os textos e as horas do
            último mix; a série grava-se à parte (GerirClube). */}
        {organizationId && (
          <WhatsappHoursField
            organizationId={organizationId}
            kind="mix"
            value={form.whatsapp_post_times ?? null}
            onChange={(v) => set({ whatsapp_post_times: v })}
          />
        )}
      </div>
    </StepPage>
  )
}
