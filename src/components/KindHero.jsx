// O topo com a imagem do Alino de um tipo (ou a foto do clube): a cor forte
// do tipo por baixo, e a imagem por cima só quando aparece. Se a imagem não
// carregar, fica a cor — nunca um buraco branco (R0, 13 out).
// <KindHero kind="mix" className="h-40" />
// <KindHero kind="club" src={club.photo_url || CLUB_HERO} />   (ou kind="group")
// Fora dos tipos de evento (clube, grupo) a cor por baixo é o azul-noite
// dos topos do clube e do grupo; `color` troca-a, se for preciso.
import { useState } from 'react'
import { KIND_COLORS, KIND_HERO } from '../lib/kindColors'

// O fundo escuro dos topos do clube e do grupo (topo-clube-alino.webp).
const NIGHT = '#1F2937'

export default function KindHero({ kind, src = null, color = null, alt = '', className = '', imgClassName = '', children = null }) {
  const [failed, setFailed] = useState(false)
  const url = src || KIND_HERO[kind]
  return (
    <div className={`relative overflow-hidden ${className}`} style={{ background: color || KIND_COLORS[kind]?.strong || NIGHT }}>
      {url && !failed && (
        <img src={url} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)}
          className={`absolute inset-0 h-full w-full object-cover ${imgClassName}`} />
      )}
      {children}
    </div>
  )
}
