import { useTranslation } from 'react-i18next'
import { Nav, Footer, usePageTop } from './Landing'
import { SiteTop, Teachers } from './Plans'

/* alinho.pt/professores: o que era o separador «Professores» dos Planos, numa
   página sua, aberta pela porta «Professores» do menu
   (design-handoff/2026-10-28-site-paginas-sem-separadores, aprovado pelo
   Francisco a 28 out). */
export default function Professores() {
  const { t } = useTranslation()
  usePageTop()
  return (
    <div className="min-h-screen bg-white">
      <Nav />
      <SiteTop title={t('plans.tab_teachers')} lead={t('plans.teachers_lead')} />
      <main className="mx-auto max-w-[1200px] px-4 pb-20 pt-8 sm:px-10">
        <Teachers />
      </main>
      <Footer />
    </div>
  )
}
