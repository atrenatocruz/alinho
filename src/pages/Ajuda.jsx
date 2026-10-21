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
  // A Ajuda nova (site arrumado, 18 out): o mesmo conteúdo do site, com as
  // faixas a sair das margens da página.
  return (
    // O bloco preto do fim vai até ao fundo, por baixo da barra (SPEC: «sem
    // espaço branco no fim»): a margem de baixo do Layout é engolida aqui.
    <div style={{ marginBottom: 'calc(-7rem - env(safe-area-inset-bottom))' }}>
      <BackBar onBack={goBack} label={t('common.back')} title={t('ajuda.title')} />
      <div className="-mt-6">
        <HelpContent inApp />
      </div>
    </div>
  )
}
