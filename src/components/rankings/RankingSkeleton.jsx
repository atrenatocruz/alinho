// Os Rankings a carregar: a forma da lista em vez da roda (SPEC
// 2026-10-12-esqueletos-app: «tudo o que está em cima a sério; o título, o
// pódio e as linhas a cinzento — número, foto, nome, linha pequena e
// pontos»). Os cartões brancos são a sério; só o que vem dos dados é cinzento.
import { SkCircle, SkLine, SkPill } from '../Skeleton'

// O pódio: 1.º à esquerda e maior, como o RankPodium.
function PodiumSpot({ big }) {
  return (
    <div className={`flex flex-col items-center gap-2 ${big ? 'pt-6' : 'pt-9'}`}>
      <SkCircle size={big ? 70 : 58} />
      <SkLine size="text" w="70%" />
      <SkLine size="text" w="40%" />
    </div>
  )
}

function Row() {
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5">
      <span aria-hidden className="sk relative block h-8 w-8 shrink-0 overflow-hidden rounded-ctrl bg-[#ECECE7]" />
      <SkCircle size={36} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <SkLine size="text" w="55%" />
        <SkLine size="label" w="30%" />
      </div>
      <SkPill w={44} h={20} />
    </div>
  )
}

/** title: o título do separador e a contagem («39 jogadores»), a cinzento. */
export default function RankingSkeleton({ title = true, rows = 6 }) {
  return (
    <div className="space-y-3">
      {title && (
        <div className="space-y-1.5">
          <SkLine size="big" w="52%" />
          <SkLine size="text" w="34%" />
        </div>
      )}
      <div className="rounded-card border border-line bg-white overflow-hidden">
        <div className="grid grid-cols-3 gap-2 px-3 pt-3 pb-4">
          <PodiumSpot big />
          <PodiumSpot />
          <PodiumSpot />
        </div>
      </div>
      <div className="rounded-card border border-line bg-white overflow-hidden divide-y divide-line">
        {Array.from({ length: rows }, (_, i) => <Row key={i} />)}
      </div>
    </div>
  )
}
