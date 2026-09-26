// Criar um torneio, por passos (Trello #361, print 07 do desenho aprovado).
// Quatro passos, pela ordem em que o organizador pensa:
//   1 quando e onde · 2 campos e horas · 3 categorias · 4 regras
// O formato só se escolhe depois de fechadas as inscrições (outro cartão) —
// aqui não aparece, porque nesta altura ainda não se sabe quantas duplas há.
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ImagePlus, Lock, Plus, Trash2, X } from 'lucide-react'
import { Chips, DateField, PrimaryButton } from '../ui'
import { TIEBREAK_RULES } from './tieBreak'
import { categoryCode, categoryName, stepProblem, saveProblem, totalCourtHours, totalSlots, pricePerPlayer } from '../../lib/tournaments'
import { localInputToIso, isoToLocalInput } from '../../lib/tournamentDay'
import { FieldLabel, MonoLabel } from './TournamentBits'
import { removeTournamentPoster, uploadTournamentPoster } from '../../lib/tournamentPosterStorage'
import { describeError } from '../../lib/errors'
import StepPage from '../steps/StepPage'

const DEFAULT_RULES = {
  entry_mode: 'dupla',        // dupla | sozinho | as_duas
  scoring: 'pro_set_9',
  tiebreak_8_8: 'tiebreak',   // em 8-8: tie-break a 7 | super tie-break a 10
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
function Field({ label, children, hint, error, className = '' }) {
  return (
    <div className={className}>
      <FieldLabel>{label}</FieldLabel>
      {/* Campo em falta ou errado: contorno vermelho no campo E a frase por
          baixo (regra das janelas, 24 set). */}
      {error ? <div className="[&_input]:!border [&_input]:!border-danger [&_.input-field]:!border-danger">{children}</div> : children}
      {/* O porquê fica junto ao campo que o causa (Trello #514). */}
      {error && <p role="alert" className="mt-1 text-xs font-bold text-danger">{error}</p>}
      {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </div>
  )
}

// min-h 44: alvo de toque para o dedo, à beira do campo (Trello #558).
const inputClass = 'input-field'

// Só para os botões de acrescentar (+ dia, + campo, + categoria). As
// escolhas usam <Chips>, a pastilha única da app (Trello #528).
function Chip({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-[44px] items-center gap-1 whitespace-nowrap rounded-full border border-line px-3.5 py-1.5 text-sm font-extrabold text-ink-700 transition-colors hover:bg-ink-50"
    >
      {children}
    </button>
  )
}

/** Serve para criar e para editar. A editar, `initial` traz o torneio como
 *  o admin o escreveu; `locked` (há inscrições) deixa mudar só o que não
 *  estraga inscrições feitas — é a mesma regra que o update_tournament
 *  impõe do lado da base de dados. */
/** As categorias que jogam em cada dia, e a que horas — no passo «Onde joga»,
 *  ao lado das horas de abertura desse dia (desenho de 23 set, «#342»).
 *
 *  Está aqui, e não na ficha da categoria, porque a hora de início de uma
 *  categoria é «a que horas» e não «quem entra». E assim não se marca uma
 *  categoria para as 12h num dia que só abre às 14h — antes só se descobria
 *  com o horário já feito.
 *
 *  Uma categoria ainda sem dia aparece à parte, para não passar despercebida:
 *  sem dia não entra no horário de ninguém. */
function DayCategories({ draft, set, dayLabel }) {
  const { t } = useTranslation()
  if (draft.days.length === 0 || draft.categories.length === 0) return null

  const patch = (code, change) => set({
    categories: draft.categories.map((c) => (c.code === code ? { ...c, ...change } : c)),
  })
  const semDia = draft.categories.filter((c) => !c.day)

  return (
    <div>
      <FieldLabel>{t('tournament.create.who_plays_when')}</FieldLabel>
      {draft.days.map((d) => {
        const doDia = draft.categories.filter((c) => c.day === d.date)
        return (
          <div key={d.date} className="card mt-2">
            <b className="text-sm text-ink-900">{dayLabel(d.date)}</b>
            <span className="ml-1.5 text-xs text-ink-500">
              {t('tournament.create.day_open', { from: d.starts_at, to: d.ends_at, courts: Number(d.courts) || 0 })}
            </span>
            {doDia.length === 0 ? (
              <p className="mt-1.5 text-xs text-ink-500">{t('tournament.create.day_no_categories')}</p>
            ) : doDia.map((c) => (
              <div key={c.code} className="mt-1.5 flex items-center gap-2">
                <span className="rounded-md bg-ink-900 px-1.5 py-0.5 font-mono text-xs font-bold text-white">{c.code}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink-700">{c.name}</span>
                <input
                  type="time"
                  aria-label={t('tournament.create.start_time')}
                  className="input-field !w-[100px] !px-2 shrink-0"
                  value={c.start_time || ''}
                  onChange={(e) => patch(c.code, { start_time: e.target.value })}
                />
                <button type="button" onClick={() => patch(c.code, { day: '' })}
                  aria-label={t('tournament.create.remove')} className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center -my-3 -mx-2 shrink-0 text-ink-300 hover:text-danger">
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )
      })}

      {semDia.length > 0 && (
        <div className="mt-2 rounded-card border border-warning/30 bg-warning/10 p-4">
          <b className="text-sm text-ink-900">{t('tournament.create.no_day_yet')}</b>
          {semDia.map((c) => (
            <div key={c.code} className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="rounded-md bg-ink-900 px-1.5 py-0.5 font-mono text-xs font-bold text-white">{c.code}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink-700">{c.name}</span>
              {draft.days.map((d) => (
                <Chip key={d.date} onClick={() => patch(c.code, { day: d.date, start_time: c.start_time || d.starts_at })}>
                  {dayLabel(d.date)}
                </Chip>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Uma secção trancada: continua à vista, na mesma ordem de quando se cria,
 *  e diz PORQUÊ. Um campo que desaparece deixa quem monta sem saber se não
 *  existe, se está noutro sítio, ou se está trancado — e isso é pior do que
 *  o «não podes». */
function Locked({ title, reason, children }) {
  const { t } = useTranslation()
  return (
    <div className="card">
      <div className="flex items-center gap-1.5">
        <Lock size={13} className="shrink-0 text-ink-500" />
        <b className="text-sm text-ink-700">{title}</b>
        <span className="ml-auto shrink-0 text-xs font-semibold uppercase tracking-wide text-ink-500">
          {t('tournament.create.locked_tag')}
        </span>
      </div>
      <p className="mt-1 text-xs text-ink-500">{reason}</p>
      {children && <div className="mt-2">{children}</div>}
    </div>
  )
}

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
    // Vem em UTC: mostra-se na hora local (Trello #487). Cortar o texto, como
    // antes, mostrava a hora UTC como se fosse de Lisboa.
    entries_close_at: isoToLocalInput(initial?.tournament?.entries_deadline),
    draw_at: (initial?.tournament?.draw_on || '').slice(0, 10),
    days: (initial?.days || []).map((d) => ({
      date: d.date, starts_at: (d.starts_at || '').slice(0, 5), ends_at: (d.ends_at || '').slice(0, 5), courts: d.courts,
    })),
    courts: (initial?.courts || []).map((c) => c.name),
    categories: (initial?.categories || []).map((c) => ({
      code: c.code, name: c.name, gender: c.gender, level: c.level,
      day: c.day_date, start_time: (c.start_time || '').slice(0, 5),
      slots: c.slots, price: Math.round((c.price_cents || 0) / 100),
      prize_first: c.prize_first || '', prize_second: c.prize_second || '',
    })),
    organizer_text: initial?.tournament?.organizer_text || '',
    rules: { ...DEFAULT_RULES, ...(initial?.tournament?.rules || {}) },
  }))
  const editing_existing = !!initial

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))
  const setRule = (key, value) => setDraft((d) => ({ ...d, rules: { ...d.rules, [key]: value } }))
  const hours = useMemo(() => totalCourtHours(draft.days), [draft.days])
  // O prazo que o torneio já tinha, a editar: se não mudar, não se trava.
  const [initialDeadline] = useState(() => isoToLocalInput(initial?.tournament?.entries_deadline))
  const checkOpts = { now: new Date(), initialDeadline: initial ? initialDeadline : undefined }
  const problem = stepProblem(step, draft, checkOpts)
  // A guardar sem passos (a editar com inscrições, ou no fim): datas e regras.
  const finalProblem = saveProblem(draft, checkOpts)
  const shown = tried ? ((locked || step === 4) ? (problem || finalProblem) : problem) : null
  const fieldError = (keys) => (shown && keys.includes(shown) ? t(`tournament.create.problem_${shown}`) : null)
  const DEADLINE_PROBLEMS = ['deadline', 'deadline_past', 'deadline_after_start']
  const DRAW_PROBLEMS = ['draw_after_start', 'draw_before_deadline']
  // Guarda só sem problemas; com um, mostra-o junto ao campo.
  const guarded = (fn) => () => {
    const p = problem || finalProblem
    if (p) { setTried(true); return }
    fn()
  }
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

  // Tudo o que sai deste formulário passa por aqui: o prazo vai com fuso
  // (Trello #487). Antes seguia "2026-10-05T23:59" sem fuso, a base de dados
  // lia-o como UTC, e em Lisboa as inscrições fechavam às 00:59.
  // A data do sorteio é opcional: vazia vai como null, porque "" rebenta no
  // ::timestamptz do servidor (22007) e o organizador só via «Algo correu mal».
  const outgoing = (d) => ({
    ...d,
    entries_close_at: localInputToIso(d.entries_close_at),
    draw_at: d.draw_at || null,
  })

  const publish = (status) => onCreate({
    ...outgoing(draft),
    is_public: true,
    status,
    categories: draft.categories.map((c) => ({
      ...c, slots: Number(c.slots), price: Number(c.price) || 0,
      prize_first: (c.prize_first || '').trim() || null,
      prize_second: (c.prize_second || '').trim() || null,
    })),
  })

  // "Sex 9 out" — dia curto, como nos chips do print 07.
  const dayLabel = (iso) => {
    const d = new Date(`${iso}T12:00`)
    const part = (opt) => d.toLocaleDateString(i18n.language, opt).replace('.', '')
    const weekday = part({ weekday: 'short' })
    return `${weekday.charAt(0).toUpperCase() + weekday.slice(1)} ${d.getDate()} ${part({ month: 'short' })}`
  }

  // A mesma moldura dos outros «criar» (StepPage, revisão da designer de
  // 26 set): nome e cartaz no «top», soltos; a barra «N de 4 · passo»; o
  // botão de baixo. O espaçamento entre campos é o da StepPage, como no mix.
  /* O nome e o cartaz são a IDENTIDADE do torneio, não um passo: ficam
     por cima da barra de progresso, à vista do princípio ao fim, como o
     título de um documento (desenho de 23 set, «#342»).

     Com «Pessoas» a abrir, meter o nome lá dentro obrigava a definir
     categorias antes de dar nome ao torneio, o que ninguém faz. E um
     quinto passo não se acrescenta: um fluxo pode SALTAR um passo,
     nunca inventar um. */
  const top = (
    <div className="space-y-5">
      {/* O nome sem rótulo, como o do mix (versão final de 26 set). */}
      <input className="input-field text-base font-extrabold" value={draft.name} onChange={(e) => set({ name: e.target.value })}
        placeholder={t('tournament.create.name_placeholder')} aria-label={t('tournament.create.name')} />
      <Field label={t('tournament.create.poster')} hint={draft.poster_url ? null : t('tournament.create.poster_hint')}>
        {draft.poster_url ? (
          <div className="relative overflow-hidden rounded-ctrl border border-line">
            <img src={draft.poster_url} alt={t('tournament.create.poster')} className="block max-h-60 w-full object-cover" />
            <button
              type="button"
              onClick={removePoster}
              aria-label={t('tournament.create.poster_remove')}
              className="absolute right-2 top-2 inline-flex h-11 w-11 items-center justify-center rounded-full bg-ink-900/80 text-white"
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
        {poster.error && <p className="mt-1 text-xs text-danger">{poster.error}</p>}
      </Field>
    </div>
  )

  const save = guarded(() => onCreate(outgoing(draft)))
  /* Uma pergunta a sério, dois botões do tamanho dos normais, cada um com
     a consequência escrita por baixo — como os do mix (desenho de 23 set,
     ponto 4; versão final de 26 set).
     Antes era um botão grande e verde em cima e um pequeno de
     contorno por baixo: não é uma pergunta, é um caminho normal com
     uma saída lateral — e foi assim que se criou um torneio sem dar
     pela escolha.

     ⚠️ «Abrir inscrições» substitui «Publicar e anunciar»: a função
     só escreve o estado novo na tabela — não cria aviso, não manda
     nada para o WhatsApp, não toca no sino de ninguém. O nome
     antigo prometia o que o código não faz. É PROPOSTA, por acordar
     com o Renato e o Ruben; se decidirem outro nome, muda-se a
     palavra e os dois botões ficam na mesma. */
  const footer = !locked && step === 4 && !editing_existing ? (
    <div className="space-y-2">
      <p className="text-sm font-extrabold text-ink-900">{t('tournament.create.open_now_question')}</p>
      <button type="button" disabled={saving} onClick={guarded(() => publish('inscricoes'))} className="btn-primary w-full disabled:opacity-40">
        {t('tournament.create.publish')}
      </button>
      <p className="text-center text-xs text-muted">{t('tournament.create.publish_hint')}</p>
      <button type="button" disabled={saving} onClick={guarded(() => publish('rascunho'))} className="btn-secondary w-full !mt-3 disabled:opacity-40">
        {t('tournament.create.save_draft')}
      </button>
      <p className="text-center text-xs text-muted">{t('tournament.create.save_draft_hint')}</p>
    </div>
  ) : null

  return (
    <StepPage
      title={editing_existing ? t('tournament.create.edit_title') : t('tournament.create.title')}
      step={locked ? 1 : step}
      total={locked ? 1 : 4}
      stepLabel={t(`tournament.create.step${step}`)}
      onBack={step === 1 || locked ? onCancel : () => setStep(step - 1)}
      top={top}
      onNext={locked || step === 4 ? save : () => (problem ? setTried(true) : (setTried(false), setStep(step + 1)))}
      nextLabel={locked || step === 4 ? t('tournament.create.save_changes') : t('tournament.create.next')}
      footer={footer}
      error={error}
      busy={saving}
    >
      {locked && <p className="text-xs text-ink-500">{t('tournament.create.edit_locked')}</p>}

      {/* Com inscrições feitas, só se mexe no que não as estraga — é a mesma
          regra que o update_tournament impõe na base de dados. O que não se
          pode mudar NÃO desaparece: fica à vista, trancado, com a razão
          (desenho de 23 set, ponto 5). Antes sumia, e quem montava não sabia
          se não existia, se estava noutro sítio, ou se estava trancado. */}
      {locked && (
        <>
          <Field label={t('tournament.create.location')}>
            <input className={inputClass} value={draft.location} onChange={(e) => set({ location: e.target.value })} />
          </Field>
          <Field label={t('tournament.create.entries_until')} error={fieldError(DEADLINE_PROBLEMS)}>
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                {/* Escolher o dia fecha às 23:59 desse dia, em Lisboa (QA, 26 set).
                    Antes mantinha a hora que lá estava: um prazo antigo em
                    00:59 (guardado sem fuso antes do #487) fazia «5 out»
                    virar 5 out 00:59, a véspera à noite. */}
                <DateField value={draft.entries_close_at.slice(0, 10)} onChange={(v) => set({ entries_close_at: `${v}T23:59` })} />
              </div>
              <input type="time" className="input-field !w-[104px] !px-2" value={draft.entries_close_at.slice(11) || '23:59'} onChange={(e) => set({ entries_close_at: `${draft.entries_close_at.slice(0, 10)}T${e.target.value}` })} />
            </div>
          </Field>
          <Field label={t('tournament.create.draw')} hint={t('tournament.create.draw_hint')} error={fieldError(DRAW_PROBLEMS)}>
            <DateField value={draft.draw_at} onChange={(v) => set({ draw_at: v })} />
          </Field>
          <Field label={t('tournament.create.organizer_text')}>
            <textarea rows={3} className={inputClass} value={draft.organizer_text} onChange={(e) => set({ organizer_text: e.target.value })} />
          </Field>
        </>
      )}

      {/* 1 · Pessoas — as categorias. Cada uma é «quem pode entrar», dito
          uma vez: género, nível, vagas, preço e prémios.

          O DIA e a HORA de cada categoria NÃO estão aqui: são «a que horas»,
          e vivem no passo 3 ao lado das horas de abertura de cada dia. Assim
          não se marca uma categoria para as 12h num dia que só abre às 14h —
          antes só se descobria com o horário já feito. */}
      {locked && (
        <Locked title={t('tournament.create.step1')} reason={t('tournament.create.locked_categories')}>
          {(initial?.categories || []).map((c) => (
            <div key={c.id || c.code} className="flex items-center gap-2 border-t border-line py-1.5 first:border-t-0">
              <span className="rounded-md bg-ink-500 px-1.5 py-0.5 font-mono text-xs font-bold text-white">{c.code}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink-700">{c.name}</span>
              <span className="shrink-0 text-xs text-ink-500">
                {t('tournament.create.category_line', { slots: c.slots, price: Math.round((c.price_cents || 0) / 100) })}
              </span>
            </div>
          ))}
        </Locked>
      )}
      {!locked && step === 1 && (
        <>
          {/* A lista das categorias é um bloco só: as linhas ficam coladas. */}
          {draft.categories.length > 0 && <div>
          {draft.categories.map((c, i) => (
            <div key={i} className="flex items-center gap-2.5 border-t border-line py-2">
              <span className="rounded-md bg-ink-900 px-1.5 py-0.5 font-mono text-xs font-bold text-white">{c.code}</span>
              <span className="min-w-0 flex-1">
                <b className="block truncate text-sm font-semibold text-ink-900">{c.name}</b>
                <span className="text-xs text-ink-500">
                  {t('tournament.create.category_line', { slots: c.slots, price: c.price || 0 })}
                  {c.day ? ` · ${dayLabel(c.day)}${c.start_time ? ` ${c.start_time}` : ''}` : ''}
                </span>
              </span>
              <button type="button" onClick={() => setEditing(i)} className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center -my-3 -mx-2 text-xs text-ink-500 hover:underline">{t('tournament.create.edit')}</button>
              <button type="button" aria-label={t('tournament.create.remove')} onClick={() => set({ categories: draft.categories.filter((_, k) => k !== i) })} className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center -my-3 -mx-2 text-ink-300 hover:text-danger">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          </div>}

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
            <div>
              <Chip onClick={() => setEditing('new')}><Plus size={13} /> {t('tournament.create.add_category')}</Chip>
            </div>
          )}

          <Field label={t('tournament.create.max_categories')}>
            <Chips value={draft.rules.max_categories} onChange={(n) => setRule('max_categories', n)}
              label={t('tournament.create.max_categories')}
              options={[1, 2, 3].map((n) => ({ value: n, label: String(n) }))} />
          </Field>

          {/* Só com dias e campos: antes disso a conta dava «0 h de campo» (QA,
              26 set). É uma explicação, por isso texto normal. */}
          {draft.categories.length > 0 && Math.round(hours) > 0 && (
            <p className="text-xs text-ink-500">
              {t('tournament.create.slots_vs_hours', { teams: totalSlots(draft.categories), hours: Math.round(hours) })}
            </p>
          )}
        </>
      )}

      {/* 2 · Quando — os dias do torneio e os prazos. */}
      {locked && (
        <Locked title={t('tournament.create.step2')} reason={t('tournament.create.locked_days')} />
      )}
      {!locked && step === 2 && (
        <>
          <Field label={t('tournament.create.days')} hint={t('tournament.create.days_hint')}>
            <div className="flex flex-wrap gap-1.5">
              {draft.days.map((d) => (
                <span key={d.date} className="inline-flex items-center gap-1.5 rounded-full bg-ink-900 px-3 py-1.5 text-sm font-semibold text-white">
                  {dayLabel(d.date)}
                  <button type="button" aria-label={t('tournament.create.remove')} onClick={() => set({ days: draft.days.filter((x) => x.date !== d.date) })} className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center -my-3 -mx-2">
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
          {/* «Abrem as inscrições», o mesmo controlo do mix (acrescento de 25
              set). Escolher outro dia precisa da base de dados: por agora só
              «Já», que abre ao publicar no último passo. */}
          <Field label={t('launchday.label')} hint={t('tournament.create.opens_now_hint')}>
            <Chips label={t('launchday.label')} value="now" onChange={() => {}}
              options={[{ value: 'now', label: t('tournament.create.opens_now') }]} />
          </Field>
          <Field label={t('tournament.create.entries_until')} error={fieldError(DEADLINE_PROBLEMS)}>
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <DateField value={draft.entries_close_at.slice(0, 10)} onChange={(v) => set({ entries_close_at: `${v}T23:59` })} />
              </div>
              <input type="time" className="input-field !w-[104px] !px-2" value={draft.entries_close_at.slice(11) || '23:59'} onChange={(e) => set({ entries_close_at: `${draft.entries_close_at.slice(0, 10)}T${e.target.value}` })} />
            </div>
          </Field>
          <Field label={t('tournament.create.draw')} hint={t('tournament.create.draw_hint')} error={fieldError(DRAW_PROBLEMS)}>
            <DateField value={draft.draw_at} onChange={(v) => set({ draw_at: v })} />
          </Field>
        </>
      )}

      {/* 3 · Onde joga — o local, e um bloco por dia com os campos, as horas
          de abertura e as categorias que jogam nesse dia. Vê-se de relance se
          um dia está sobrecarregado, que é a pergunta de quem monta. */}
      {!locked && step === 3 && (
        <>
          <Field label={t('tournament.create.location')}>
            <input className={inputClass} value={draft.location} onChange={(e) => set({ location: e.target.value })} />
          </Field>
          {draft.days.map((d, i) => (
            <div key={d.date} className="card">
              <b className="text-sm text-ink-900">{dayLabel(d.date)}</b>
              <div className="mt-2 flex items-center gap-2">
                <input type="time" className="input-field !w-[100px] !px-2" value={d.starts_at} onChange={(e) => patchDay(i, { starts_at: e.target.value })} />
                <span className="text-xs text-ink-500">{t('tournament.create.to')}</span>
                <input type="time" className="input-field !w-[100px] !px-2" value={d.ends_at} onChange={(e) => patchDay(i, { ends_at: e.target.value })} />
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input type="number" min="1" max="30" className="input-field !w-[72px] !px-2" value={d.courts} onChange={(e) => patchDay(i, { courts: e.target.value })} />
                <span className="text-xs text-ink-500">{t('tournament.create.courts_label')}</span>
              </div>
            </div>
          ))}
          <Field label={t('tournament.create.court_names')} hint={t('tournament.create.court_names_hint')}>
            <div className="flex flex-wrap gap-1.5">
              {draft.courts.map((name, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm">
                  {name}
                  <button type="button" aria-label={t('tournament.create.remove')} onClick={() => set({ courts: draft.courts.filter((_, k) => k !== i) })} className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center -my-3 -mx-2"><X size={13} /></button>
                </span>
              ))}
              <Chip onClick={() => set({ courts: [...draft.courts, t('tournament.create.court_n', { n: draft.courts.length + 1 })] })}>
                <Plus size={13} /> {t('tournament.create.add_court')}
              </Chip>
            </div>
          </Field>
          <div className="flex items-center justify-between border-t border-line pt-3 text-sm">
            <span className="text-ink-500">{t('tournament.create.court_time')}</span>
            <b className="text-ink-900">{t('tournament.create.hours', { count: Math.round(hours) })}</b>
          </div>
          <DayCategories draft={draft} set={set} dayLabel={dayLabel} />
        </>
      )}

      {/* 4 · Regras — NÃO trancadas: a duração dos jogos e o tipo de contagem
          têm de se poder mexer no próprio dia, porque «é imprevisível, e os
          jogos, paragens e assim podem mudar» (Francisco, 23 set). É também
          o que o `editable` do get_tournament_for_edit deixa. */}
      {locked && (
        <div className="flex items-center gap-1.5 border-t border-line pt-3">
          <b className="text-sm text-ink-700">{t('tournament.create.section4')}</b>
          <span className="text-xs text-ink-500">· {t('tournament.create.rules_editable')}</span>
        </div>
      )}
      {(locked || step === 4) && (
        <>
          <Field label={t('tournament.create.entry_mode')}>
            {/* Uma resposta num formulário → pastilhas soltas (Trello #528). */}
            <Chips
              value={draft.rules.entry_mode}
              onChange={(v) => setRule('entry_mode', v)}
              label={t('tournament.create.entry_mode')}
              options={[
                { value: 'dupla', label: t('tournament.create.entry_pair') },
                { value: 'sozinho', label: t('tournament.create.entry_solo') },
                { value: 'as_duas', label: t('tournament.create.entry_both') },
              ]}
            />
          </Field>
          <Field label={t('tournament.create.scoring')}>
            <Chips value={draft.rules.scoring} onChange={(v) => setRule('scoring', v)}
              label={t('tournament.create.scoring')}
              options={SCORINGS.map((s) => ({ value: s, label: t(`tournament.create.scoring_${s}`) }))} />
          </Field>
          {/* Pro set em 8-8: tie-break a 7 ou super tie-break a 10 — escolhe
              quem organiza (Francisco, 25 set). Nos sets, o 6-6 é sempre a 7. */}
          {draft.rules.scoring === 'pro_set_9' && (
            <Field label={t('tournament.create.tiebreak_8_8')}>
              <Chips value={draft.rules.tiebreak_8_8 || 'tiebreak'} onChange={(v) => setRule('tiebreak_8_8', v)}
                label={t('tournament.create.tiebreak_8_8')}
                options={TIEBREAK_RULES.map((r) => ({ value: r, label: t(`tournament.create.tiebreak_8_8_${r}`) }))} />
            </Field>
          )}
          <Field label={t('tournament.create.duration')} hint={t('tournament.create.duration_hint', { max: draft.rules.duration_max })} error={fieldError(['duration_order'])}>
            <div className="flex items-center gap-2">
              <input type="number" min="15" max="180" step="5" className="input-field !w-[86px] !px-2" value={draft.rules.duration_min} onChange={(e) => setRule('duration_min', Number(e.target.value))} />
              <span className="text-xs text-ink-500">{t('tournament.create.to')}</span>
              <input type="number" min="15" max="180" step="5" className="input-field !w-[86px] !px-2" value={draft.rules.duration_max} onChange={(e) => setRule('duration_max', Number(e.target.value))} />
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
                <label key={key} className="flex items-center justify-between gap-2 rounded-ctrl border border-line px-3 py-2 text-xs text-ink-700">
                  <span className="min-w-0">{label}</span>
                  <input type="number" min={min} max={max} className="input-field !w-[76px] !px-2 text-right" value={draft.rules[key]} onChange={(e) => setRule(key, Number(e.target.value))} />
                </label>
              ))}
            </div>
          </Field>
          <Field label={t('tournament.create.selection')}>
            <Chips
              value={draft.rules.selection}
              onChange={(v) => setRule('selection', v)}
              label={t('tournament.create.selection')}
              options={[
                { value: 'manual', label: t('tournament.create.selection_manual') },
                { value: 'pontos', label: t('tournament.create.selection_points') },
              ]}
            />
          </Field>
          <Field label={t('tournament.create.organizer_text')}>
            <textarea rows={3} className={inputClass} value={draft.organizer_text} onChange={(e) => set({ organizer_text: e.target.value })} placeholder={t('tournament.create.organizer_text_placeholder')} />
          </Field>
        </>
      )}

      {shown && ![...DEADLINE_PROBLEMS, ...DRAW_PROBLEMS, 'duration_order'].includes(shown) && (
        <p className="text-xs text-danger">{t(`tournament.create.problem_${shown}`)}</p>
      )}
    </StepPage>
  )
}

/** A ficha de uma categoria: género e nível dão o código (M5, MX4), e o dia
 *  e a hora são os que aparecem a quem chega de fora («sábado, a partir das
 *  12h»). */
function CategoryEditor({ value, taken = [], days, dayLabel, onCancel, onSave }) {
  const { t, i18n } = useTranslation()
  const [cat, setCat] = useState(value || {
    gender: 'masculino', level: 5, name: '', day: days[0]?.date || '', start_time: days[0]?.starts_at || '', slots: 16, price: 25, prize_first: '', prize_second: '',
  })
  const code = categoryCode(cat.gender, cat.level)
  const name = cat.name || categoryName(t, cat.gender, cat.level)
  const set = (patch) => setCat((c) => ({ ...c, ...patch }))
  // Num torneio há uma categoria por nível, e só uma (decisão do Francisco,
  // 22 set). Dois «M5» davam o mesmo código e a base de dados recusa-os —
  // mais vale dizê-lo aqui, em português, do que deixar o admin sem saída.
  const repeated = taken.includes(code)

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <b className="text-sm text-ink-900">{code} · {name}</b>
        <button type="button" onClick={onCancel} aria-label={t('tournament.create.cancel')} className="text-ink-300 hover:text-ink-700"><X size={16} /></button>
      </div>
      <Field className="mt-3" label={t('tournament.create.gender')}>
        <Chips value={cat.gender} onChange={(g) => set({ gender: g, name: '' })}
          label={t('tournament.create.gender')}
          options={GENDERS.map((g) => ({ value: g, label: t(`tournament.create.gender_${g}`) }))} />
      </Field>
      <Field className="mt-3" label={t('tournament.create.level')}>
        <Chips value={cat.level} onChange={(n) => set({ level: n, name: '' })}
          label={t('tournament.create.level')}
          options={[1, 2, 3, 4, 5, 6].map((n) => ({ value: n, label: String(n) }))} />
      </Field>
      <Field className="mt-3" label={t('tournament.create.category_custom_name')}>
        <input className={inputClass} value={cat.name} onChange={(e) => set({ name: e.target.value })} placeholder={categoryName(t, cat.gender, cat.level)} />
      </Field>
      <div className="mt-3 flex gap-3">
        <div className="flex-1">
          <FieldLabel>{t('tournament.create.slots')}</FieldLabel>
          <input type="number" min="2" max="128" className={inputClass} value={cat.slots} onChange={(e) => set({ slots: e.target.value })} />
        </div>
        <div className="flex-1">
          <FieldLabel>{t('tournament.create.price')}</FieldLabel>
          <input type="number" min="0" max="500" className={inputClass} value={cat.price} onChange={(e) => set({ price: e.target.value })} />
          {/* A conta feita, a acompanhar o que se escreve. A unidade NÃO muda
              — tudo no torneio é em duplas (vagas em duplas, inscritos em
              duplas), e mexer nela com um evento já aberto dobrava ou partia
              ao meio um preço a sério. O que se tira é a adivinha: o cartaz
              diz «25 € por jogador» e o campo pede «por dupla», e quem não
              parar para pensar escreve 25 e fica a cobrar metade. */}
          {Number(cat.price) > 0 && (
            <p className="mt-1 text-xs text-ink-500">
              {/* A parte da DUPLA vai a negrito porque é o número que se
                  acabou de escrever: quem lê o cartaz («25 € por pessoa»)
                  tem de ver ali, sem dúvida nenhuma, que o campo é outro. */}
              <b className="text-ink-900">{t('tournament.create.price_pair', { pair: Number(cat.price) })}</b>
              {' · '}
              {t('tournament.create.price_person', { each: pricePerPlayer(cat.price, i18n.language) })}
            </p>
          )}
        </div>
      </div>
      {/* Prémios: texto livre, porque nem sempre é dinheiro («2 garrafas de
          bolas · voucher» no desenho, print 12). São por categoria — no Smash
          Cup cada uma tem o seu. Aparecem no pódio quando o torneio acaba, e
          na página de quem chega de fora. Deixar em branco = sem prémio, e
          nada aparece. */}
      {/* Um por linha, e não lado a lado: no telemóvel «100 € + 2 garrafas de
          bolas» não cabe em meia largura e a pessoa escreve às cegas. */}
      <div className="mt-3">
        <FieldLabel>{t('tournament.create.prize_first')}</FieldLabel>
        <input type="text" maxLength={80} className={inputClass} placeholder={t('tournament.create.prize_placeholder')}
               value={cat.prize_first || ''} onChange={(e) => set({ prize_first: e.target.value })} />
      </div>
      <div className="mt-3">
        <FieldLabel>{t('tournament.create.prize_second')}</FieldLabel>
        <input type="text" maxLength={80} className={inputClass} placeholder={t('tournament.create.prize_placeholder')}
               value={cat.prize_second || ''} onChange={(e) => set({ prize_second: e.target.value })} />
      </div>
      <p className="mt-1.5 text-xs text-ink-500">{t('tournament.create.prize_hint')}</p>
      {repeated && <p className="mt-3 text-xs text-danger">{t('tournament.create.category_repeated', { name: categoryName(t, cat.gender, cat.level) })}</p>}
      <PrimaryButton className="mt-3 w-full" disabled={repeated || !cat.slots || Number(cat.slots) < 2} onClick={() => onSave({ ...cat, code, name })}>
        {t('tournament.create.save')}
      </PrimaryButton>
    </div>
  )
}
