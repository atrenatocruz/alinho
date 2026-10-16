import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Share, PlusSquare, MoreVertical, Download } from 'lucide-react'
import { Wordmark } from './Layout'
import {
  shouldShowInstallPrompt, mobilePlatform, markInstallPromptDone,
  hasNativePrompt, runNativePrompt, onInstallChange,
} from '../lib/installPrompt'

/* Ecrã cheio «Adiciona o alinho ao ecrã principal» (Renato, 16 out — a
   partir de um exemplo em iOS). Só no telemóvel e no browser; some para
   sempre neste aparelho quando a pessoa instala, diz «Já adicionei» ou
   «Agora não».
   · iOS: o Safari não deixa instalar por código — três passos à mão.
   · Android: com o diálogo nativo do Chrome (beforeinstallprompt), um botão
     só; sem ele (Firefox, Samsung Internet…), os passos pelo menu ⋮.
   Design alinho: fundo ink-900 com o campo em white/[0.06] (a assinatura
   das superfícies escuras), o lima só no botão principal (One Ball Rule). */

function Court() {
  return (
    <svg aria-hidden="true" viewBox="0 0 200 400" preserveAspectRatio="xMidYMid slice"
      className="pointer-events-none absolute inset-0 h-full w-full text-white/[0.06]">
      <rect x="20" y="20" width="160" height="360" rx="14" fill="none" stroke="currentColor" strokeWidth="2" />
      <line x1="100" y1="20" x2="100" y2="380" stroke="currentColor" strokeWidth="2" />
      <line x1="20" y1="200" x2="180" y2="200" stroke="currentColor" strokeWidth="2" strokeDasharray="6 6" />
    </svg>
  )
}

export default function InstallPrompt() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(() => shouldShowInstallPrompt())
  const [native, setNative] = useState(hasNativePrompt)
  const platform = mobilePlatform()

  useEffect(() => onInstallChange(() => {
    setNative(hasNativePrompt())
    if (!shouldShowInstallPrompt()) setOpen(false)
  }), [])

  if (!open) return null

  const close = () => { markInstallPromptDone(); setOpen(false) }
  const install = async () => {
    if (await runNativePrompt()) close()
  }

  const steps = platform === 'ios'
    ? [
        { text: t('install.ios_step1'), Icon: Share },
        { text: t('install.ios_step2'), Icon: PlusSquare },
        { text: t('install.ios_step3') },
      ]
    : [
        { text: t('install.android_step1'), Icon: MoreVertical },
        { text: t('install.android_step2'), Icon: Download },
        { text: t('install.android_step3') },
      ]

  return createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby="install-title"
      className="fixed inset-0 z-[70] overflow-y-auto bg-ink-900 text-white animate-fade-in">
      <Court />
      <div className="relative mx-auto flex min-h-full max-w-md flex-col px-5 pt-[calc(env(safe-area-inset-top)+48px)] pb-[calc(env(safe-area-inset-bottom)+24px)]">
        <div className="flex justify-center">
          <Wordmark variant="dark" className="!h-9" />
        </div>
        <h1 id="install-title" className="mt-10 text-center font-display text-[32px] font-bold leading-[1.1] tracking-tight">
          {t('install.title')}
        </h1>
        <p className="mt-4 text-center text-base leading-relaxed text-white/60">
          {native ? t('install.body_native') : t('install.body')}
        </p>

        {!native && (
          <ol className="mt-8 space-y-3">
            {steps.map(({ text, Icon }, i) => (
              <li key={i} className="flex items-center gap-4 rounded-card bg-white/[0.06] px-4 py-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 font-display text-base font-bold tabular-nums">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 text-[15px] leading-snug">{text}</span>
                {Icon && <Icon size={22} className="shrink-0 text-white/70" aria-hidden="true" />}
              </li>
            ))}
          </ol>
        )}

        <div className="mt-auto pt-8 space-y-2">
          <button type="button" onClick={native ? install : close}
            className="press min-h-[52px] w-full rounded-ctrl bg-lime-400 px-4 text-base font-extrabold text-ink-900 transition-colors hover:bg-lime-600 active:bg-lime-600">
            {native ? t('install.add_now') : t('install.done')}
          </button>
          <button type="button" onClick={close}
            className="min-h-[48px] w-full rounded-ctrl px-4 text-base font-extrabold text-white/70 hover:text-white">
            {t('install.not_now')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
