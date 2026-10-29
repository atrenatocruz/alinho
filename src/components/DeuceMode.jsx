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
      {/* Trancado também ao teclado (QA, 28 out): inert tira o foco e o
          clique, e o onChange ignora o que ainda chegar. */}
      <div className={locked ? 'pointer-events-none opacity-50' : ''} aria-disabled={locked || undefined} {...(locked ? { inert: '' } : {})}>
        <Chips label={t('deuce.label')} value={value} onChange={locked ? () => {} : onChange} options={options} />
      </div>
      {locked ? (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-muted"><Lock size={14} className="shrink-0" />{lockedText || t('deuce.locked')}</p>
      ) : (
        <p className="mt-2 text-sm text-muted">{t(`deuce.hint_${value}`)}</p>
      )}
    </div>
  )
}

/** A folha «Como se joga o 40-40»: o texto do modo e, por baixo, os tie-breaks.
 *  Também a abre a caixa «Pontuação» da página do torneio (Dev 1, 28 out). */
export function DeuceHelpSheet({ mode, noTieBreaks = false, onClose }) {
  const { t } = useTranslation()
  return (
    <Sheet title={t('deuce.help_title')} onClose={onClose}>
      <p className="text-sm leading-relaxed text-ink-900">
        <b className="font-extrabold">{t(`deuce.${mode}`)}.</b> {t(`deuce.help_${mode}`)}
      </p>
      {!noTieBreaks && <p className="mt-3 text-sm text-muted">{t('deuce.help_tiebreak')}</p>}
    </Sheet>
  )
}

/** «Pro set a 9 · ponto de ouro» com o «?» que explica o modo. `noTieBreaks`:
 *  o Set sem fim não tem tie-breaks, e a frase deles sai (QA, 27 out). `text`:
 *  outra frase à frente do «?», como o «Aos 40-40: ponto de ouro» da liga (Dev 1, 28 out). */
export function DeuceModeLabel({ scoringLabel, mode, noTieBreaks = false, text = null }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <>
      <span className="inline-flex items-center gap-1">
        <span>{text || `${scoringLabel} · ${t(`deuce.short_${mode}`)}`}</span>
        {/* 44 px ao toque, o ícone com 16 (QA, 28 out); a margem negativa
            devolve o espaço, e a linha fica com a mesma altura. */}
        <button type="button" onClick={() => setOpen(true)} aria-label={t('deuce.help_title')}
          className="-my-2.5 -mr-2.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted">
          <HelpCircle size={16} />
        </button>
      </span>
      {open && <DeuceHelpSheet mode={mode} noTieBreaks={noTieBreaks} onClose={() => setOpen(false)} />}
    </>
  )
}
