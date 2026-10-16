import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Nav, Footer, useLoginHref, usePageTop, PRIMARY_CTA } from './Landing'
import { NOVIDADES, novidadeDate } from '../lib/novidades'

/* alinho.pt/novidades (Trello #619) — design-handoff/2026-10-10-site-como-
   funciona, aprovado pelo Francisco a 10 out. Uma entrada por versão, a mais
   recente em cima, com «Nova» e a borda preta; as outras com a borda fina.
   As entradas vêm de src/lib/novidades.js: junta-se uma nova lá, sem mexer
   neste desenho. */
export default function Novidades() {
  usePageTop()
  const { t, i18n } = useTranslation()
  const loginHref = useLoginHref()
  const lang = i18n.language?.startsWith('en') ? 'en' : 'pt'
  return (
    <div className="min-h-screen bg-[#F7F7F4]">
      <Nav />
      <section className="bg-[#F7F7F4]">
        <div className="max-w-2xl mx-auto px-5 pt-24 pb-14">
          <h1 className="text-[40px] sm:text-5xl text-ink-900 leading-[1.05]">{t('nov.title')}</h1>
          <p className="text-ink-700 text-lg mt-4">{t('nov.intro')}</p>
          <div className="mt-8 space-y-4">
            {NOVIDADES.map((n, i) => (
              <article key={n.date} className={`rounded-card bg-white p-5 ${i === 0 ? 'border-2 border-ink-900' : 'border border-line'}`}>
                <p className="flex items-center gap-2 font-mono text-[12px] font-bold uppercase tracking-widest text-ink-500">
                  {novidadeDate(n.date, lang)}
                  {i === 0 && <span className="rounded-full bg-lime-400 px-2 py-0.5 font-sans text-[11px] font-extrabold normal-case tracking-normal text-ink-900">{t('nov.new')}</span>}
                </p>
                <h2 className="mt-2 text-xl text-ink-900">{n.title[lang]}</h2>
                <ul className="mt-3 list-disc space-y-2 pl-5 text-ink-700 leading-relaxed marker:text-ink-900">
                  {n.items[lang].map((item) => <li key={item}>{item}</li>)}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="bg-ink-900 pt-14 pb-10 px-5">
        <div className="max-w-md mx-auto flex flex-col gap-3">
          <h2 className="text-3xl text-white mb-3">{t('nov.end_title')}</h2>
          <Link to={loginHref('signup')} className={`${PRIMARY_CTA} inline-flex items-center justify-center`}>{t('landing.signup_link')}</Link>
          <Link to="/como-funciona" className="inline-flex min-h-[48px] items-center justify-center rounded-ctrl border border-white/30 px-6 font-extrabold text-white hover:bg-white/10">
            {t('nov.end_how')}
          </Link>
        </div>
      </section>
      <Footer />
    </div>
  )
}
