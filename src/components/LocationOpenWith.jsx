import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MapPin, Check } from 'lucide-react'
import { NAVIGATORS, getPreferredNavigator, setPreferredNavigator, navigatorUrl } from '../lib/navigators'

/* Morada com um toque na app de mapas preferida e o "Abrir com…" ao lado
   para escolher outra (Trello #34). Partilhado pela página do mix e pela do
   torneio, para o mesmo gesto fazer o mesmo nos dois sítios (Trello #431).
   R3 (UX, 13 out — como no protótipo): num cartão #F4F5F1, o nome do sítio a
   negrito e a rua pequena por baixo (a morada parte-se na 1.ª vírgula), e
   «Abrir com…» num botão de contorno à direita. */
/** `surface`: 'soft' (#F4F5F1, nas páginas dos eventos) ou 'white' (dentro
 *  de um bloco que já é #F4F5F1, como o «Sobre o clube» — Dev 1, 13 out). */
export default function LocationOpenWith({ location, latitude, longitude, className = '', surface = 'soft' }) {
  const { t } = useTranslation()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [preferredNav, setPreferredNav] = useState(getPreferredNavigator)
  const place = { location, latitude, longitude }
  const cut = String(location || '').indexOf(',')
  const name = cut > 0 ? location.slice(0, cut).trim() : location
  const street = cut > 0 ? location.slice(cut + 1).trim() : ''

  return (
    <div className={`rounded-[14px] px-3.5 py-3 ${surface === 'white' ? 'bg-white' : 'bg-[#F4F5F1]'} ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <a
          href={navigatorUrl(preferredNav, place)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-[44px] min-w-0 items-center gap-2.5 text-ink-900"
        >
          <MapPin size={16} className="shrink-0 text-ink-700" />
          <span className="min-w-0">
            <b className="block truncate font-display text-[14px] font-extrabold leading-tight">{name}</b>
            {street && <small className="block truncate text-[12px] leading-snug text-[#5B6068]">{street}</small>}
          </span>
        </a>
        <button
          type="button"
          onClick={() => setPickerOpen((open) => !open)}
          className="shrink-0 rounded-full border-[1.5px] border-[#CFD2D7] bg-white px-3.5 py-2 font-display text-[12.5px] font-extrabold leading-none text-ink-900"
        >
          {t('gamedetails.open_with')}
        </button>
      </div>
      {pickerOpen && (
        <div className="flex flex-wrap gap-2 mt-2 animate-fade-up">
          {NAVIGATORS.map((nav) => (
            <a
              key={nav.key}
              href={nav.url(place)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                setPreferredNavigator(nav.key)
                setPreferredNav(nav.key)
                setPickerOpen(false)
              }}
              className={`inline-flex items-center gap-1.5 rounded-ctrl px-3 min-h-[44px] text-sm font-extrabold border transition-colors duration-fast ${
                nav.key === preferredNav
                  ? 'bg-ink-50 border-ink-900 text-ink-900'
                  : 'bg-surface border-line text-ink-900 hover:bg-ink-50'
              }`}
            >
              {nav.key === preferredNav && <Check size={14} className="text-ink-900 shrink-0" />}
              {t(nav.labelKey)}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
