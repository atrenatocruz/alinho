// «Personalizar a Home» (Home do futuro, SPEC-2, ponto 4 — aprovado pelo
// Francisco a 9 out): interruptores para o que aparece no topo da Home, cada
// um com uma linha que diz o que é. Os jogos para te inscreveres aparecem
// sempre. Guarda por pessoa, neste aparelho (arrastar para mudar a ordem fica
// para depois).
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet } from '../agenda/AgendaControls'

export const HOME_SECTIONS = ['mine', 'live', 'foryou']
const LABEL = {
  mine: ['home.next_title', 'home.customize_mine_text'],
  live: ['live.title', 'home.customize_live_text'],
  foryou: ['home.foryou_title', 'home.customize_foryou_text'],
}

const storageKey = (userId) => `alinho.home.hidden.${userId || 'anon'}`

function readHidden(userId) {
  try {
    const v = JSON.parse(localStorage.getItem(storageKey(userId)) || '[]')
    return Array.isArray(v) ? v.filter((k) => HOME_SECTIONS.includes(k)) : []
  } catch {
    return []
  }
}

/** O que a pessoa escondeu do topo da Home: `hidden.has('live')`. */
export function useHomeSections(userId) {
  const [hidden, setHidden] = useState(() => new Set(readHidden(userId)))
  const toggle = (key) => setHidden((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    try { localStorage.setItem(storageKey(userId), JSON.stringify([...next])) } catch { /* sem memória, só nesta visita */ }
    return next
  })
  return { hidden, toggle }
}

function Switch({ on, label, onClick }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick}
      className={`relative h-[26px] w-11 shrink-0 rounded-full transition-colors ${on ? 'bg-ink-900' : 'bg-[#D1D5DB]'}`}>
      <span aria-hidden className={`absolute top-[3px] h-5 w-5 rounded-full transition-[left] duration-200 ${on ? 'left-[21px] bg-lime-400' : 'left-[3px] bg-white'}`} />
    </button>
  )
}

export default function PersonalizeHomeSheet({ hidden, onToggle, onClose }) {
  const { t } = useTranslation()
  return (
    <Sheet title={t('home.customize_home')} onClose={onClose}>
      <p className="-mt-1 text-[13px] text-ink-700">{t('home.customize_text')}</p>
      <div className="mt-2">
        {HOME_SECTIONS.map((key) => (
          <div key={key} className="flex items-center gap-2.5 border-b border-[#F0F0EE] px-0.5 py-3">
            <span className="min-w-0 flex-1 text-[14.5px] font-bold text-ink-900">
              {t(LABEL[key][0])}
              <small className="block text-[11.5px] font-medium text-muted">{t(LABEL[key][1])}</small>
            </span>
            <Switch on={!hidden.has(key)} label={t(LABEL[key][0])} onClick={() => onToggle(key)} />
          </div>
        ))}
      </div>
      <button type="button" onClick={onClose}
        className="press mt-4 flex min-h-[52px] w-full items-center justify-center rounded-ctrl bg-ink-900 px-4 text-[15px] font-extrabold text-white">
        {t('home.customize_done')}
      </button>
    </Sheet>
  )
}
