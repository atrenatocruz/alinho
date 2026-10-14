import { Link } from 'react-router-dom'
import { useGoBack } from '../lib/useGoBack'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, FileText } from 'lucide-react'
import { Wordmark } from '../components/Layout'
import { founderNames, POLICY_VERSION, SUPPORT_EMAIL } from '../lib/contacts'
import { formatDate } from '../lib/formatDate'

// Order here is the order sections render in — matches
// terms.section_<key>_title / terms.section_<key>_body in pt.json/en.json.
// Termos novos (BA, aprovados pelo Francisco a 13 out): ranking, prizes e
// account são secções novas; a «pilot» passou a «Preços e planos».
const SECTIONS = [
  'intro', 'pilot', 'responsibilities', 'admins', 'ranking', 'prizes',
  'whatsapp', 'account', 'liability', 'changes', 'law', 'contact',
]

export default function TermsOfService() {
  const goBack = useGoBack('/')
  const { t, i18n } = useTranslation()
  return (
    <div className="min-h-screen bg-canvas">
      <header className="bg-surface border-b border-line sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-4">
          <button type="button" onClick={goBack} aria-label={t('common.back')} className="text-ink-700">
            <ArrowLeft size={24} />
          </button>
          <h1 className="text-2xl text-ink-900">{t('terms.title')}</h1>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        <div className="text-center mb-2">
          <FileText size={40} className="mx-auto text-ink-700 mb-3" />
          <Wordmark variant="light" className="h-7 mx-auto" />
          {/* A mesma data que se aceita no ConsentGate (POLICY_VERSION). */}
          <p className="mt-3 text-xs text-muted">
            {t('legal.last_updated', { date: formatDate(`${POLICY_VERSION}T12:00:00`, i18n.language, { day: 'numeric', month: 'long', year: 'numeric' }) })}
          </p>
        </div>

        {SECTIONS.map((key) => (
          <section key={key} className="card space-y-2">
            <h2 className="text-lg font-extrabold text-ink-900">
              {t(`terms.section_${key}_title`)}
            </h2>
            {/* Um texto com várias linhas é uma lista (as responsabilidades). */}
            {(() => {
              const lines = t(`terms.section_${key}_body`).split(/\n/)
              return lines.length > 1 ? (
                <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted leading-relaxed">
                  {lines.map((line) => <li key={line}>{line}</li>)}
                </ul>
              ) : (
                <p className="text-sm text-muted leading-relaxed">{lines[0]}</p>
              )
            })()}
            {/* Quem gere o alinho até haver empresa (13 out). */}
            {key === 'intro' && (
              <p className="text-sm text-muted leading-relaxed">{t('terms.intro_founders', { names: founderNames(i18n.language), email: SUPPORT_EMAIL })}</p>
            )}
          </section>
        ))}
      </main>
    </div>
  )
}
