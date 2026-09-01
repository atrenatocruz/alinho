import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Shield } from 'lucide-react'
import { Wordmark } from '../components/Layout'

// Order here is the order sections render in — matches
// privacy.section_<key>_title / privacy.section_<key>_body in pt.json/en.json.
const SECTIONS = [
  'intro', 'data_collected', 'purpose', 'sharing',
  'cookies', 'retention', 'rights', 'changes', 'contact',
]

export default function PrivacyPolicy() {
  const { t } = useTranslation()
  return (
    <div className="min-h-screen bg-canvas">
      <header className="bg-surface border-b border-line sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link to="/" className="text-ink-700">
            <ArrowLeft size={24} />
          </Link>
          <h1 className="text-2xl text-ink-900">{t('privacy.title')}</h1>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        <div className="text-center mb-2">
          <Shield size={40} className="mx-auto text-ink-700 mb-3" />
          <Wordmark variant="light" className="h-7 mx-auto" />
        </div>

        {SECTIONS.map((key) => (
          <section key={key} className="card space-y-2">
            <h2 className="text-lg font-extrabold text-ink-900">
              {t(`privacy.section_${key}_title`)}
            </h2>
            <p className="text-sm text-muted leading-relaxed">
              {t(`privacy.section_${key}_body`)}
            </p>
          </section>
        ))}
      </main>
    </div>
  )
}
