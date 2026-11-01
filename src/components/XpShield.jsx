import { useState } from 'react'
import { XP_TIERS } from '../lib/xp'

/* Escudos dos 10 níveis de XP (design-handoff/2026-10-16-escudos-niveis-xp,
   aprovado pelo Francisco a 16 out; refeitos sobre magenta a 21 out). Imagens
   de 256 px em public/xp e as de 512 (@2x) para os tamanhos acima de 64 px,
   como o topo da página do XP (104 px), para ficarem nítidas no telemóvel.
   O nome do nível está sempre ao lado, por isso alt vazio.
   Se a imagem falhar, fica a bola de cor de sempre (dotClass), sem buraco.
   `dim`: nível que ainda não tens — cinzento e meio apagado. */
export default function XpShield({ tierKey, size = 32, dim = false, className = '', style }) {
  const [failed, setFailed] = useState(false)
  const tier = XP_TIERS.find((x) => x.key === tierKey)
  if (!tier) return null
  const dimStyle = dim ? { filter: 'grayscale(1)', opacity: 0.45 } : null
  if (failed) {
    const dot = Math.max(10, Math.round(size * 0.55))
    return (
      <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center ${className}`} style={{ width: size, height: size, ...dimStyle, ...style }}>
        <span className={`rounded-full ${tier.dotClass}`} style={{ width: dot, height: dot }} />
      </span>
    )
  }
  return (
    <img src={`/xp/escudo-${tier.key}.webp`} srcSet={size > 64 ? `/xp/escudo-${tier.key}.webp 1x, /xp/escudo-${tier.key}@2x.webp 2x` : undefined}
      alt="" width={size} height={size} loading="lazy" draggable="false"
      onError={() => setFailed(true)} className={`shrink-0 select-none object-contain ${className}`}
      style={{ width: size, height: size, ...dimStyle, ...style }} />
  )
}
