import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Globe } from 'lucide-react'
import { Sheet } from '../agenda/AgendaControls'
import { setSiteLanguage } from './SiteChrome'

/* O menu da língua (design-handoff/2026-10-28-menu-lingua, aprovado pelo
   Francisco a 28 out). Fechado: o globo, a língua em que se está («PT») e a
   seta. Aberto: cada língua no seu nome, a escolhida em lima com «✓». No
   computador abre uma lista por baixo; no telemóvel, a folha de escolha da
   app. Sem bandeiras. Línguas novas entram só em LANGS. */
export const LANGS = [
  { value: 'pt', key: 'profile.language_portuguese' },
  { value: 'en', key: 'profile.language_english' },
  { value: 'es', key: 'profile.language_spanish' },
]

export const currentLang = (lang) => {
  const l = String(lang || 'pt').slice(0, 2)
  return LANGS.some((x) => x.value === l) ? l : 'pt'
}

const isDesktop = () => typeof window !== 'undefined' && window.matchMedia?.('(min-width: 640px)').matches

function LangList({ value, onPick }) {
  const { t } = useTranslation()
  return (
    <ul className="space-y-0.5" role="listbox" aria-label={t('layout.toggle_language')}>
      {LANGS.map((l) => {
        const on = l.value === value
        return (
          <li key={l.value}>
            <button type="button" role="option" aria-selected={on} lang={l.value} onClick={() => onPick(l.value)}
              className={`flex min-h-[44px] w-full items-center justify-between rounded-ctrl px-3 text-left font-display text-[15px] font-extrabold text-ink-900 ${on ? 'bg-lime-100' : 'hover:bg-ink-50'}`}>
              {t(l.key)}
              {on && <Check size={18} className="shrink-0" />}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** `tone`: 'light' (cabeçalho do site, Login) ou 'dark' (rodapé do site). */
export default function LanguageMenu({ tone = 'light', className = '' }) {
  const { t, i18n } = useTranslation()
  const value = currentLang(i18n.language)
  const [open, setOpen] = useState(null) // null | 'list' | 'sheet'
  const ref = useRef(null)

  useEffect(() => {
    if (open !== 'list') return undefined
    const away = (e) => { if (!ref.current?.contains(e.target)) setOpen(null) }
    const esc = (e) => { if (e.key === 'Escape') setOpen(null) }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [open])

  const pick = (lang) => { setOpen(null); if (lang !== value) setSiteLanguage(lang) }
  const pill = tone === 'dark'
    ? 'border-[#3A3E45] text-[#E6E8EB] hover:border-[#5B6068]'
    : 'border-[#D7D9D2] bg-white text-ink-900 hover:border-ink-900'

  return (
    // «relative» só quando quem usa não o posiciona (no Login vem «absolute»).
    <div ref={ref} className={`${/\babsolute\b/.test(className) ? '' : 'relative'} ${className}`}>
      <button type="button" onClick={() => setOpen(open ? null : isDesktop() ? 'list' : 'sheet')}
        aria-haspopup="listbox" aria-expanded={!!open} title={t('layout.toggle_language')}
        className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-full border-[1.5px] px-3 font-display text-[13px] font-extrabold ${pill}`}>
        <Globe size={15} aria-hidden="true" />
        {/* No rodapé escuro, o nome inteiro («Português»); em cima, o código. */}
        {tone === 'dark' ? t(LANGS.find((l) => l.value === value).key) : value.toUpperCase()}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open === 'list' && (
        <div className={`absolute right-0 z-30 w-48 rounded-card bg-white p-1.5 shadow-lift animate-pop ${tone === 'dark' ? 'bottom-full mb-2' : 'top-full mt-2'}`}>
          <LangList value={value} onPick={pick} />
        </div>
      )}
      {open === 'sheet' && (
        <Sheet title={t('site.language_title')} onClose={() => setOpen(null)}>
          <LangList value={value} onPick={pick} />
        </Sheet>
      )}
    </div>
  )
}
