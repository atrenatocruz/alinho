// «Mudar só este mix ou também os seguintes?» (SPEC design-handoff/2026-10-
// 13-serie-so-este-ou-seguintes, aprovada pelo Francisco). Aparece ao
// guardar o Editar de uma data de um mix que se repete, quando alguma regra
// mudou. Vem escolhido «Só este mix», que não mexe em mais nada.
//   - `changes`: as pastilhas («Formato: Sobe e desce»), no máximo 4 e
//     depois «e mais N»;
//   - `notes`: as frases por baixo («A hora muda só neste mix.», «O dia em
//     que abrem as inscrições muda em todos os mixes da série.»);
//   - `following`: [{ date, people }] dos seguintes com inscritos — com «Este
//     e os seguintes», a caixa amarela diz quantos e, com `notifies`, que
//     recebem um aviso;
//   - onPick('this' | 'following'); onClose: «Voltar sem guardar» (não perde
//     nada do que se escreveu).
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

const MAX_PILLS = 4

export default function SeriesScopeSheet({ open, title, repeats, dayLabel, changes = [], notes = [], following = [], notifies = false, whatText = '', onPick, onClose }) {
  const { t } = useTranslation()
  const [scope, setScope] = useState('this')
  useEffect(() => { if (open) setScope('this') }, [open])
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null

  const shown = changes.slice(0, MAX_PILLS)
  const more = changes.length - shown.length
  const withPeople = following.filter((f) => f.people > 0)
  const total = withPeople.reduce((n, f) => n + f.people, 0)
  const option = (value, name, hint) => (
    <button type="button" role="radio" aria-checked={scope === value} onClick={() => setScope(value)}
      className={`flex w-full items-start gap-3 rounded-[16px] bg-white p-3.5 text-left ${scope === value ? 'border-2 border-ink-900' : 'border-[1.5px] border-[#D5D8DE]'}`}>
      <span aria-hidden="true" className={`mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 ${scope === value ? 'border-ink-900' : 'border-[#C9CCD1]'}`}>
        {scope === value && <span className="h-[11px] w-[11px] rounded-full bg-ink-900" />}
      </span>
      <span className="min-w-0">
        <span className="block font-display text-[16px] font-extrabold text-ink-900">{name}</span>
        <span className="mt-0.5 block text-[14px] leading-snug text-[#5B6068]">{hint}</span>
      </span>
    </button>
  )

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 animate-fade-in sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="series-scope-title" onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-[24px] bg-white px-5 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+16px)] shadow-lift sm:rounded-[24px]">
        <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-ink-200" />
        <p id="series-scope-title" className="font-display text-[22px] font-extrabold leading-tight text-ink-900">{t('seriescope.title')}</p>
        <p className="mt-2 text-[15px] leading-snug text-[#5B6068]">{t('seriescope.repeats', { name: title, repeats })}</p>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {shown.map((c) => (
            <span key={c} className="rounded-full bg-[#F1F2EE] px-3 py-1.5 font-display text-[13px] font-bold text-ink-900">{c}</span>
          ))}
          {more > 0 && <span className="rounded-full bg-[#F1F2EE] px-3 py-1.5 font-display text-[13px] font-bold text-ink-900">{t('seriescope.and_more', { count: more })}</span>}
        </div>
        {notes.map((n) => <p key={n} className="mt-2 text-[13.5px] leading-snug text-[#5B6068]">{n}</p>)}
        <div role="radiogroup" aria-label={t('seriescope.title')} className="mt-4 space-y-2.5">
          {option('this', t('seriescope.only_this'), t('seriescope.only_this_hint', { day: dayLabel ? dayLabel[0].toLocaleUpperCase() + dayLabel.slice(1) : '' }))}
          {option('following', t('seriescope.following'), t('seriescope.following_hint', { day: dayLabel }))}
        </div>
        {scope === 'following' && withPeople.length > 0 && (
          <p className="mt-3 flex items-start gap-2 rounded-[14px] bg-[#FEF6E4] px-3.5 py-3 text-[14px] leading-snug text-ink-900">
            <span aria-hidden="true">⚠</span>
            <span>
              {withPeople.length === 1
                ? t('seriescope.people_single', { day: withPeople[0].date, count: withPeople[0].people })
                : t('seriescope.people_many', { days: withPeople.map((f) => f.date).join(', '), count: total })}
              {notifies && whatText ? ` ${t('seriescope.they_get_notice', { what: whatText })}` : ''}
            </span>
          </p>
        )}
        <div className="mt-5 space-y-1">
          <button type="button" onClick={() => onPick(scope)}
            className="press w-full min-h-[52px] rounded-ctrl bg-ink-900 px-4 font-display text-[15px] font-extrabold text-white">
            {t('seriescope.save')}
          </button>
          <button type="button" onClick={onClose}
            className="w-full min-h-[44px] font-display text-[14px] font-bold text-ink-900 underline underline-offset-2">
            {t('seriescope.back')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
