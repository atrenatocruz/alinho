import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import pt from '../locales/pt.json'
import en from '../locales/en.json'
import es from '../locales/es.json'

// A pre-auth visitor can switch language from Landing/Login (no profile to
// persist it on yet) — that choice is stashed in localStorage so it
// survives a reload before any account exists. Wrapped in try/catch:
// localStorage can throw (private browsing, disabled storage, etc).
function getInitialLanguage() {
  try {
    const stored = localStorage.getItem('preferredLanguage')
    if (stored === 'pt' || stored === 'en' || stored === 'es') return stored
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
      // Espanhol (passo 2 do plano das línguas, 26 out): o es.json é do Copywriter.
      es: { translation: es },
    },
    lng: getInitialLanguage(),
    fallbackLng: 'pt',
    interpolation: { escapeValue: false }, // React already escapes
  })

// O plural de Portugal: «0 seguidores», «0 duplas». Com o código «pt» o
// browser usa a regra do Brasil, em que o zero conta como um («0 seguidor»,
// relatório do QA de 9 out). As traduções continuam em «pt».
const plurals = i18n.services.pluralResolver
const baseRule = plurals.getRule.bind(plurals)
plurals.getRule = (code, options) => baseRule(code === 'pt' ? 'pt-PT' : code, options)

export default i18n
