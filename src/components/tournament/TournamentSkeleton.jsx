// Os esqueletos do torneio (SPEC 2026-10-12-esqueletos-app, «Torneio: como a
// página do jogo, com a capa, os 4 números e “O teu próximo jogo” a
// cinzento»). Só o que vem dos dados fica a cinzento; o «‹» e os separadores
// são a sério em quem chama. Sem texto nem números inventados.
import { useTranslation } from 'react-i18next'
import { SkLine, SkPill, SkBlock, SkCard, SkeletonPage, useSkeleton } from '../Skeleton'

/** A página do torneio: as pastilhas de cima, o cartão (capa, etiqueta,
 *  título, clube, os 4 números) e «O teu próximo jogo». */
export function TournamentPageSkeleton() {
  const { t } = useTranslation()
  return (
    <SkeletonPage label={t('common.loading')} className="space-y-4">
      <div className="flex gap-2"><SkPill w={84} h={36} /><SkPill w={74} h={36} /></div>
      <SkCard className="!p-0 overflow-hidden">
        <SkBlock h={140} rounded="rounded-none" />
        <div className="space-y-2.5 p-4">
          <div className="flex justify-between"><SkPill w={78} h={24} /><SkPill w={96} h={24} /></div>
          <SkLine size="title" w="70%" />
          <SkLine size="text" w="55%" />
          <div className="grid grid-cols-4 gap-1 pt-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex flex-col items-center gap-1.5">
                <SkLine size="title" w={28} />
                <SkLine size="label" w="70%" />
              </div>
            ))}
          </div>
        </div>
      </SkCard>
      <SkCard className="space-y-2.5">
        <SkLine size="label" w={110} />
        <SkLine size="text" w="75%" />
        <SkLine size="text" w="50%" />
      </SkCard>
    </SkeletonPage>
  )
}

/** Um separador ou uma secção a carregar: umas linhas em cartões. Só
 *  aparece se demorar mais de 0,2 s (antes disso, nada). */
export function PanelSkeleton({ rows = 3 }) {
  const { t } = useTranslation()
  const show = useSkeleton(true)
  if (!show) return null
  return (
    <SkeletonPage label={t('common.loading')} className="space-y-2.5">
      {Array.from({ length: rows }, (_, i) => (
        <SkCard key={i} className="space-y-2">
          <SkLine size="label" w={i % 2 ? '30%' : '40%'} />
          <SkLine size="text" w={i % 2 ? '65%' : '80%'} />
          <SkLine size="text" w={i % 2 ? '40%' : '50%'} />
        </SkCard>
      ))}
    </SkeletonPage>
  )
}

/** O ecrã de marcar: os dias e os separadores vêm dos dados (a cinzento),
 *  e as linhas dos jogos. */
export function ScoreSkeleton() {
  const { t } = useTranslation()
  return (
    <SkeletonPage label={t('common.loading')} className="space-y-4">
      <div className="flex gap-2">{[0, 1, 2].map((i) => <SkPill key={i} w={72} h={36} />)}</div>
      <SkBlock h={44} rounded="rounded-full" />
      <SkLine size="label" w={44} />
      {[0, 1, 2].map((i) => (
        <SkCard key={i} className="space-y-2.5">
          <SkLine size="label" w="35%" />
          <SkLine size="text" w="70%" />
          <SkLine size="text" w="60%" />
          <SkBlock h={44} />
        </SkCard>
      ))}
    </SkeletonPage>
  )
}
