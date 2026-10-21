// Criar e editar por passos, a carregar: a forma do StepPage em vez da roda
// (esqueletos, 12 out). O «‹» a sério logo; depois de 0,2 s, o título, a
// barra dos passos e os campos a cinzento; aos 8 s, o erro de sempre.
import { useTranslation } from 'react-i18next'
import { BackBar } from '../ui'
import { SkeletonGate, SkBlock, SkLine } from '../Skeleton'
import { useGoBack } from '../../lib/useGoBack'

const DARK = '!bg-[#D5D7CF]'

export default function StepSkeleton({ fallback = '/', fields = 3 }) {
  const { t } = useTranslation()
  const goBack = useGoBack(fallback)
  return (
    <div className="mx-auto max-w-lg pb-28">
      <SkeletonGate frame={<BackBar onBack={goBack} label={t('common.back')} />}>
        <div className="mt-2 space-y-6">
          {/* O título e a barra dos passos no cinzento mais escuro da capa,
              para se verem no fundo cinzento (UX, 18 out). */}
          <SkLine size="big" w="68%" className={DARK} />
          <div className="space-y-2">
            <SkBlock h={4} rounded="rounded-sm" className={DARK} />
            <SkLine size="label" w="30%" className={DARK} />
          </div>
          {Array.from({ length: fields }, (_, i) => (
            <div key={i} className="space-y-2">
              <SkLine size="text" w={`${[34, 42, 28, 38][i % 4]}%`} />
              {/* O campo como no carregado: caixa branca com contorno (UX, 18 out). */}
              <div aria-hidden className="h-12 rounded-ctrl border border-[#E5E7EB] bg-white" />
            </div>
          ))}
        </div>
      </SkeletonGate>
    </div>
  )
}
