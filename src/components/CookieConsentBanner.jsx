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

  // Acima da barra de baixo quando ela está no ecrã; sem ela (Entrada, passos
  // do «Criar conta»), colada ao fundo, com a margem do telemóvel: 72 px acima
  // do nada tapava o «Criar conta» (#777, UX 7 nov).
  return (
    <div className="fixed inset-x-0 z-50 bg-ink-900 px-5 pt-4 shadow-lift bottom-0 pb-[calc(1rem+var(--safe-bottom,env(safe-area-inset-bottom,0px)))] [body:has(.app-nav):not([data-steps])_&]:bottom-[calc(4.5rem+var(--nav-bottom))] [body:has(.app-nav):not([data-steps])_&]:pb-4">
      <div className="max-w-2xl mx-auto flex flex-col sm:flex-row items-center gap-3">
        <p className="flex-1 text-sm text-ink-200">
          {t('cookieconsent.message')}{' '}
          <Link to="/privacidade" className="underline font-extrabold text-white">
            {t('cookieconsent.privacy_link')}
          </Link>
        </p>
        {/* No telemóvel, empilhados a toda a largura: «Aceitar» em cima, cheio a
            branco (no fundo escuro é o equivalente da ação a preto), «Recusar» por
            baixo, com contorno claro e do mesmo tamanho, para recusar ser tão fácil
            como aceitar (#777, UX 7 nov). No computador, como estava. */}
        <div className="flex flex-col-reverse sm:flex-row gap-2 shrink-0 w-full sm:w-auto">
          <PrimaryButton
            variant="ghost"
            onClick={() => handleChoice('declined')}
            className="w-full sm:w-auto max-sm:bg-transparent max-sm:text-white max-sm:border-white/70 max-sm:active:bg-white/10"
          >
            {t('cookieconsent.decline')}
          </PrimaryButton>
          <PrimaryButton
            onClick={() => handleChoice('accepted')}
            className="w-full sm:w-auto max-sm:bg-white max-sm:border-[1.5px] max-sm:border-white max-sm:active:bg-ink-50"
          >
            {t('cookieconsent.accept')}
          </PrimaryButton>
        </div>
      </div>
    </div>
  )
}
