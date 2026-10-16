// A Home com a forma dela ao abrir (SPEC 2026-10-12-home-esqueleto): o topo,
// a barra e a barra de baixo são a sério; aqui fica só o conteúdo a cinzento,
// pela ordem da Home — a etiqueta, 2 cartões pequenos dos próximos jogos (o 2.º
// a espreitar), a linha «A decorrer agora», a etiqueta do dia e 2 cartões
// grandes (hora, título, uma linha, as bolinhas). Sem texto nem números.
import { useTranslation } from 'react-i18next'
import { SkLine, SkCircle, SkBlock, SkCard, SkeletonPage } from '../Skeleton'

function SmallCard() {
  return (
    <SkCard className="w-[62%] shrink-0 space-y-2">
      <SkLine size="label" w="55%" />
      <SkLine size="text" w="80%" />
      <SkLine size="text" w="45%" />
    </SkCard>
  )
}

/** O cartão grande de evento a cinzento (Home e «Já jogados»). */
export function BigCard() {
  return (
    <SkCard className="space-y-2.5">
      <div className="flex items-center gap-2.5">
        <SkCircle size={40} />
        <div className="flex-1 space-y-1.5">
          <SkLine size="text" w="40%" />
          <SkLine size="label" w="25%" />
        </div>
      </div>
      <SkLine size="big" w={84} />
      <SkLine size="text" w="62%" />
      <SkLine size="text" w="48%" />
      <div className="flex items-center gap-1 pt-1">
        {[0, 1, 2, 3].map((i) => <SkCircle key={i} size={26} />)}
      </div>
    </SkCard>
  )
}

export default function HomeSkeleton() {
  const { t } = useTranslation()
  return (
    <SkeletonPage label={t('common.loading')} className="mt-3 space-y-5">
      <div className="space-y-2.5">
        <SkLine size="label" w={120} />
        <div className="flex gap-2.5 overflow-hidden"><SmallCard /><SmallCard /></div>
      </div>
      <SkBlock h={44} />
      <div className="space-y-2.5">
        <SkLine size="label" w={150} />
        <BigCard />
        <BigCard />
      </div>
    </SkeletonPage>
  )
}
