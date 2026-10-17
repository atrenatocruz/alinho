import { useTranslation } from 'react-i18next'
import { useGoBack } from '../lib/useGoBack'
import { BackBar } from '../components/ui'
import { HelpContent } from './Instructions'

/* A ajuda dentro da app (Renato, 17 out): o (?) dos Rankings abria a página
   pública /instrucoes, fora da app, e para voltar era preciso o «back» do
   Safari. Aqui o mesmo conteúdo (HelpContent), com o «‹» da app e a barra
   de baixo. /ajuda#ranking e /ajuda#xp descem logo à parte certa. */
export default function Ajuda() {
  const { t } = useTranslation()
  const goBack = useGoBack('/rankings')
  return (
    <div className="pb-6">
      <BackBar onBack={goBack} label={t('common.back')} title={t('instructions.title')} />
      <h1 className="text-[28px] font-extrabold leading-tight text-ink-900">{t('instructions.title')}</h1>
      <div className="mt-1">
        <HelpContent />
      </div>
    </div>
  )
}
