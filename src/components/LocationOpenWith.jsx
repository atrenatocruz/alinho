import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MapPin, Check } from 'lucide-react'
import { NAVIGATORS, getPreferredNavigator, setPreferredNavigator, navigatorUrl } from '../lib/navigators'

/* Morada com um toque na app de mapas preferida e o "Abrir com…" ao lado
   para escolher outra (Trello #34). Partilhado pela página do mix e pela do
   torneio, para o mesmo gesto fazer o mesmo nos dois sítios (Trello #431). */
export default function LocationOpenWith({ location, latitude, longitude, className = '' }) {
  const { t } = useTranslation()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [preferredNav, setPreferredNav] = useState(getPreferredNavigator)
  const place = { location, latitude, longitude }

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-2">
        <a
          href={navigatorUrl(preferredNav, place)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-start gap-1.5 min-w-0 text-[13px] text-ink-900"
        >
          <MapPin size={15} className="text-ink-700 shrink-0 mt-0.5" />
          <span>{location}</span>
        </a>
        <button
          onClick={() => setPickerOpen((open) => !open)}
          className="shrink-0 text-[13px] font-extrabold text-ink-900 underline underline-offset-2 min-h-[36px]"
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
