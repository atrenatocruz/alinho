import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PrimaryButton } from './ui'

const STORAGE_KEY = 'cookieConsent'

const readStoredChoice = () => {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

const storeChoice = (value) => {
  try {
    localStorage.setItem(STORAGE_KEY, value)
  } catch {
    // Private browsing or storage disabled — the choice just won't
    // persist, so the banner shows again next visit. Not worth
    // surfacing an error for.
  }
}

/* ════════════════════════════════════════════════════════════════════════
   Cookie consent banner (Trello #154). Mounted once in App.jsx, outside
   Guard/Routes, so it renders identically on Landing, Login, and every
   in-app route. Simple accept/decline — no category toggles, since no
   non-essential cookies exist anywhere in this codebase today (see spec).
   ════════════════════════════════════════════════════════════════════════ */
export default function CookieConsentBanner() {
  const { t } = useTranslation()
  const [choice, setChoice] = useState(readStoredChoice)

  if (choice) return null

  const handleChoice = (value) => {
    storeChoice(value)
    setChoice(value)
  }

  return (
    <div className="fixed inset-x-0 z-50 bg-ink-900 px-5 py-4 shadow-lift bottom-[calc(5.5rem+env(safe-area-inset-bottom))]">
      <div className="max-w-2xl mx-auto flex flex-col sm:flex-row items-center gap-3">
        <p className="flex-1 text-sm text-ink-200">
          {t('cookieconsent.message')}{' '}
          <Link to="/privacidade" className="underline font-extrabold text-white">
            {t('cookieconsent.privacy_link')}
          </Link>
        </p>
        <div className="flex gap-2 shrink-0 w-full sm:w-auto">
          <PrimaryButton
            variant="ghost"
            onClick={() => handleChoice('declined')}
            className="flex-1 sm:flex-none"
          >
            {t('cookieconsent.decline')}
          </PrimaryButton>
          <PrimaryButton onClick={() => handleChoice('accepted')} className="flex-1 sm:flex-none">
            {t('cookieconsent.accept')}
          </PrimaryButton>
        </div>
      </div>
    </div>
  )
}
