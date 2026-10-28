// «Aos 40-40» (design-handoff/2026-10-22-aos-40-40-criar): as três pastilhas
// com a linha da escolhida por baixo (no Criar e no Editar), e o «?» da página
// do evento, que abre a folha «Como se joga o 40-40».
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HelpCircle, Lock } from 'lucide-react'
import { Chips } from './ui'
import { Sheet } from './agenda/AgendaControls'
import { DEUCE_MODES } from '../lib/deuceMode'

/** As pastilhas e a linha de ajuda. `locked`: com resultados já contados, a
 *  cinzento e com o cadeado de sempre. `lockedText`: outra frase para o cadeado
 *  (o Editar torneio fecha pelo estado, mesmo sem resultados; Dev 1, 28 out). */
export function DeuceModeChips({ value, onChange, locked = false, lockedText = null }) {
  const { t } = useTranslation()
  const options = DEUCE_MODES.map((m) => ({ value: m, label: t(`deuce.${m}`) }))
  return (
    <div>
      <div className={locked ? 'pointer-events-none opacity-50' : ''} aria-disabled={locked || undefined}>
        <Chips label={t('deuce.label')} value={value} onChange={onChange} options={options} />
      </div>
      {locked ? (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-muted"><Lock size={14} className="shrink-0" />{lockedText || t('deuce.locked')}</p>
      ) : (
        <p className="mt-2 text-sm text-muted">{t(`deuce.hint_${value}`)}</p>
      )}
    </div>
  )
}

/** «Pro set a 9 · ponto de ouro» com o «?» que explica o modo. `noTieBreaks`:
 *  o Set sem fim não tem tie-breaks, e a frase deles sai (QA, 27 out). `stacked`:
 *  em caixas estreitas, duas linhas sem o «·», o modo com maiúscula (Dev 1, 28 out). */
export function DeuceModeLabel({ scoringLabel, mode, noTieBreaks = false, stacked = false }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <>
      <span className="inline-flex items-center gap-1">
        {stacked
          ? <span className="flex flex-col"><span>{scoringLabel}</span><span>{t(`deuce.${mode}`)}</span></span>
          : <span>{scoringLabel} · {t(`deuce.short_${mode}`)}</span>}
        <button type="button" onClick={() => setOpen(true)} aria-label={t('deuce.help_title')}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted">
          <HelpCircle size={16} />
        </button>
      </span>
      {open && (
        <Sheet title={t('deuce.help_title')} onClose={() => setOpen(false)}>
          <p className="text-sm leading-relaxed text-ink-900">
            <b className="font-extrabold">{t(`deuce.${mode}`)}.</b> {t(`deuce.help_${mode}`)}
          </p>
          {!noTieBreaks && <p className="mt-3 text-sm text-muted">{t('deuce.help_tiebreak')}</p>}
        </Sheet>
      )}
    </>
  )
}
