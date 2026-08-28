import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import pt from '../locales/pt.json'
import en from '../locales/en.json'

// A pre-auth visitor can switch language from Landing/Login (no profile to
// persist it on yet) — that choice is stashed in localStorage so it
// survives a reload before any account exists. Wrapped in try/catch:
// localStorage can throw (private browsing, disabled storage, etc).
function getInitialLanguage() {
  try {
    const stored = localStorage.getItem('preferredLanguage')
    if (stored === 'pt' || stored === 'en') return stored
  } catch {
    // ignore — fall through to default
  }
  return 'pt'
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      pt: { translation: pt },
      en: { translation: en },
    },
    lng: getInitialLanguage(),
    fallbackLng: 'pt',
    interpolation: { escapeValue: false }, // React already escapes
  })

export default i18n
