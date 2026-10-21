// Uma página com capa (EventHero) a carregar, em vez da roda (esqueletos,
// 12 out): o «‹» de vidro a sério logo; depois de 0,2 s, a capa num cinzento
// mais escuro e a folha branca com as linhas do topo (quem organiza, título,
// hora, data, a caixa e o estado); aos 8 s, o erro de sempre.
import { ChevronLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { GLASS_ROUND } from '../GlassBar'
import { useSkeleton, useLoadTimeout, SkeletonPage, LoadError, SkBlock, SkLine } from '../Skeleton'

export default function EventCoverSkeleton({ onBack }) {
  const { t } = useTranslation()
  const show = useSkeleton(true)
  const late = useLoadTimeout(true)
  return (
    <div>
      <div className="relative -mx-4 -mt-6 h-[210px]">
        {show && <span aria-hidden className="sk absolute inset-0 overflow-hidden bg-[#D5D7CF]" />}
        {onBack && (
          <button type="button" onClick={onBack} aria-label={t('common.back')}
            className={`${GLASS_ROUND} absolute left-4 top-[calc(var(--safe-top,env(safe-area-inset-top))+12px)] z-[1]`}>
            <ChevronLeft size={22} />
          </button>
        )}
      </div>
      {late ? <div className="mt-6"><LoadError /></div> : show && (
        <SkeletonPage label={t('common.loading')}>
          <div className="relative -mx-4 -mt-5 rounded-t-[22px] bg-white px-4 pb-4 pt-4">
            <SkLine size="text" w="42%" />
            <SkLine size="title" w="72%" className="mt-3" />
            <SkBlock h={50} w={150} rounded="rounded-[10px]" className="mt-2.5" />
            <SkLine size="text" w="50%" className="mt-2.5" />
            <SkBlock h={88} rounded="rounded-card" className="mt-4" />
            <SkBlock h={56} rounded="rounded-card" className="mt-3" />
          </div>
        </SkeletonPage>
      )}
    </div>
  )
}
