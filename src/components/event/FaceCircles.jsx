// As caras e os lugares que faltam, em círculos sobrepostos (R1; regra em
// src/lib/faceCircles.js). Peça comum ao cartão da Home (28 px) e à faixa da
// página do evento (32 px). Cada círculo fica por baixo do anterior; só o
// tracejado «+N» fica por cima, para o número se ler inteiro. Os tracejados
// têm fundo branco e um anel branco de 2 px, para cada um tapar o anterior
// sem parecer partido (UX, 14 out).
import { Avatar } from '../ui'
import { faceCircles } from '../../lib/faceCircles'

const SIZES = {
  sm: { box: 'h-[28px] w-[28px]', avatar: 'w-7 h-7 text-[10px]' },
  md: { box: 'h-8 w-8', avatar: 'w-8 h-8 text-[11px]' },
}

/** people: [{ id, name, avatar_url }]; free: os lugares que faltam (duplas, no torneio). */
/** moreBg: o fundo do «+N» das pessoas (cinzento cheio; branco quando a faixa já é cinzenta). */
/** count: em vez de `people`, só quantos estão (sem caras — clube onde não se é membro). */
export default function FaceCircles({ people = [], count = null, free = 0, size = 'sm', moreBg = 'bg-[#F1F2EE]', className = '' }) {
  const s = SIZES[size] || SIZES.sm
  const anonymous = count != null
  const c = faceCircles(anonymous ? count : people.length, free, undefined, { anonymous })
  if (!c.faces && !c.morePeople && !c.dashes && !c.dashPlus) return null
  const shown = anonymous ? [] : people.slice(0, c.faces)
  let z = 20
  const ring = { boxShadow: '0 0 0 2px #fff' }
  return (
    // isolate: a ordem das camadas fica só dentro da fila — a primeira cara
    // aparecia por cima do topo preso da Home ao descer (Francisco, 13 out).
    <div className={`isolate flex shrink-0 items-center ${className}`}>
      {shown.map((p, i) => (
        <span key={p.id || i} className={`relative flex rounded-full ${i ? '-ml-2' : ''}`} style={{ ...ring, zIndex: z-- }}>
          <Avatar name={p.name} url={p.avatar_url} size={s.avatar} />
        </span>
      ))}
      {c.morePeople > 0 && (
        // pl-2: a cara de antes tapa 8 px à esquerda; o número centra-se no que se vê.
        <span className={`relative grid ${s.box} place-items-center rounded-full ${moreBg} ${shown.length ? '-ml-2 pl-2' : ''} font-display text-[10.5px] font-bold text-[#4F535A]`}
          style={{ ...ring, zIndex: z-- }}>{anonymous ? c.morePeople : `+${c.morePeople}`}</span>
      )}
      {Array.from({ length: c.dashes }, (_, i) => (
        <span key={`e${i}`} aria-hidden="true" style={{ ...ring, zIndex: z-- }}
          className={`relative ${s.box} rounded-full border-2 border-dashed border-[#C9CCD1] bg-white ${shown.length || c.morePeople || i ? '-ml-2' : ''}`} />
      ))}
      {c.dashPlus > 0 && (
        <span style={{ ...ring, zIndex: 30 }}
          className={`relative ${s.box} grid place-items-center rounded-full border-2 border-dashed border-[#C9CCD1] bg-white font-display text-[10.5px] font-bold text-[#4F535A] ${shown.length || c.morePeople || c.dashes ? '-ml-2' : ''}`}>
          +{c.dashPlus}
        </span>
      )}
    </div>
  )
}
