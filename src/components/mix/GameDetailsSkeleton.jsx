// A página do jogo a carregar (SPEC 2026-10-12-esqueletos-app, «Página do
// jogo»): «‹» a sério (vem de quem chama, na moldura); «Editar» e «Mais» como
// pastilhas cinzentas; depois o cartão (etiqueta, título em 2 linhas, clube,
// hora grande, data, a caixa do sítio, 2 linhas de texto, as bolinhas) e o
// botão grande cinzento. Sem texto nem números.
import { SkLine, SkCircle, SkPill, SkBlock, SkCard } from '../Skeleton'

export default function GameDetailsSkeleton() {
  return (
    <div className="mt-3 space-y-3">
      <div className="flex gap-1.5">
        <SkPill w={78} h={44} />
        <SkPill w={74} h={44} />
      </div>
      <SkCard className="space-y-2.5 p-4">
        <SkLine size="label" w={90} />
        <SkLine size="title" w="78%" />
        <SkLine size="title" w="52%" />
        <SkLine size="text" w="40%" />
        <SkLine size="big" w={92} />
        <SkLine size="text" w="34%" />
        <SkBlock h={52} />
        <SkLine size="text" w="70%" />
        <SkLine size="text" w="55%" />
        <div className="flex items-center gap-1 pt-1">
          {[0, 1, 2, 3].map((i) => <SkCircle key={i} size={28} />)}
        </div>
      </SkCard>
      <SkBlock h={56} />
    </div>
  )
}
