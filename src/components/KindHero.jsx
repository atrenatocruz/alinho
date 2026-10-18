// O topo com a imagem do Alino de um tipo (ou a foto do clube): a cor forte
// do tipo por baixo, e a imagem por cima só quando aparece. Se a imagem não
// carregar, fica a cor — nunca um buraco branco (R0, 13 out).
// <KindHero kind="mix" className="h-40" />
// <KindHero kind="club" src={club.photo_url || CLUB_HERO} />   (ou kind="group")
// Fora dos tipos de evento (clube, grupo) a cor por baixo é o azul-noite
// dos topos do clube e do grupo; `color` troca-a, se for preciso.
import { useState } from 'react'
import { CLUB_HERO, GROUP_HERO, KIND_COLORS, KIND_HERO } from '../lib/kindColors'

// O fundo escuro dos topos do clube e do grupo (topo-clube-alino.webp).
const NIGHT = '#1F2937'

// `poster`: a imagem é um cartaz (torneio): aparece inteira, centrada, e por
// trás a mesma imagem a cobrir, desfocada e escurecida — um cartaz com texto
// cortado a cobrir perdia as bordas (UX, 16 out). Por baixo, a cor do tipo.
export default function KindHero({ kind, src = null, color = null, alt = '', className = '', imgClassName = '', poster = false, children = null }) {
  const [failed, setFailed] = useState(false)
  const url = src || KIND_HERO[kind]
  // O topo do clube e do grupo enquadrado nas caras (≈ 70 % 30 %), para não
  // cortar as cabeças nos cartões largos (SPEC avatares-clube-grupo, 14 out).
  const framed = url === CLUB_HERO || url === GROUP_HERO
  return (
    <div className={`relative overflow-hidden ${className}`} style={{ background: color || KIND_COLORS[kind]?.strong || NIGHT }}>
      {url && !failed && poster && (
        <>
          <img src={url} alt="" aria-hidden="true" loading="lazy" decoding="async"
            className="absolute inset-0 h-full w-full scale-110 object-cover blur-[24px]" />
          <span aria-hidden="true" className="absolute inset-0 bg-black/35" />
          {/* O cartaz acaba 48 px acima do fundo da capa: por baixo ficam a
              folha branca (sobe 20 px) e a pastilha do tipo, na faixa
              desfocada — nada tapa o cartaz (UX, 16 out). */}
          <img src={url} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)}
            className={`absolute inset-x-0 top-0 h-[calc(100%-3rem)] w-full object-contain ${imgClassName}`} />
        </>
      )}
      {url && !failed && !poster && (
        <img src={url} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)}
          className={`absolute inset-0 h-full w-full object-cover ${framed ? 'object-[70%_30%]' : ''} ${imgClassName}`} />
      )}
      {children}
    </div>
  )
}
