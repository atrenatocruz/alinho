// A imagem para partilhar uma conquista (design-handoff/2026-10-13-partilhar-
// conquistas, versão B, aprovada pelo Francisco a 13 out): o fundo na cor da
// raridade com raios atrás da medalha, a medalha 3D grande, o nome e a frase,
// «Só X% dos jogadores a têm», quem a ganhou e desde quando, «Joga padel no
// alinho.pt». Como os outros cartões de partilha: desenhado a 360 ×
// 640 (stories) ou 360 × 360 (quadrado, sem a pessoa) e exportado
// a 3× com o html-to-image.
//
// #743 (um desenho só para todas as partilhas, Francisco 30 out): nas
// stories, a moldura comum (ShareFrame) — a medalha no lugar da foto, o fundo
// liso na cor da raridade, «Conquista nova · Épica» a lima e, à direita, a
// data e a pessoa; por baixo, o nome, a frase e «Só X%…». O quadrado fica
// como estava.
import { forwardRef, useImperativeHandle, useRef } from 'react'
import logoWordmark from '../../logo/primary-dark-card.svg'
import { ShareFrame, exportCard } from '../tournament/TournamentShareCard'
import { shortName } from '../tournament/shareData'

export const A_CARD_W = 360
export const A_STORY_H = 640
export const A_SQUARE_H = 360
const RATIO = 3

// Versão B: o degradé radial de cada raridade, claro atrás da medalha e
// escuro em baixo (SPEC, ponto 2).
export const RARITY_BG = {
  comum: ['#0F9D8A', '#073F38'],
  raro: ['#2563EB', '#0B2A6B'],
  epico: ['#6D28D9', '#2E1065'],
  lendario: ['#B8860B', '#4A3300'],
}

/** O fundo liso das stories: a meio caminho entre o claro e o escuro da raridade. */
const flatBg = (rarity) => {
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const [a, b] = (RARITY_BG[rarity] || RARITY_BG.comum).map(hex)
  return a.map((v, i) => Math.round((v + b[i]) / 2))
}

function Background({ rarity, cy }) {
  const [light, dark] = RARITY_BG[rarity] || RARITY_BG.comum
  return (
    <>
      <div className="absolute inset-0" style={{ background: `radial-gradient(circle at 50% ${cy}, ${light} 0%, ${dark} 78%)` }} />
      {/* Raios claros e suaves a sair do centro, a apagar-se para fora. */}
      <div className="absolute inset-0" style={{
        background: `repeating-conic-gradient(from 0deg at 50% ${cy}, rgba(255,255,255,.10) 0deg 7deg, rgba(255,255,255,0) 7deg 18deg)`,
        WebkitMaskImage: `radial-gradient(circle at 50% ${cy}, #000 0%, rgba(0,0,0,.6) 32%, transparent 62%)`,
        maskImage: `radial-gradient(circle at 50% ${cy}, #000 0%, rgba(0,0,0,.6) 32%, transparent 62%)`,
      }} />
    </>
  )
}

function Logo() {
  // «alinho.pt» em tudo o que sai da app (regra de 29 set): o logótipo com
  // «.pt» logo a seguir, branco, da altura das letras.
  return (
    <span className="flex items-end gap-[1px]">
      <img src={logoWordmark} alt="alinho" className="h-[18px] w-auto" />
      <span className="font-sans text-[15px] font-medium leading-[14px] text-white">.pt</span>
    </span>
  )
}

/**
 * data: { name, desc, medal (url ou null), kicker («CONQUISTA NOVA · ÉPICA»),
 *         date («SÁB 27 SET»), pctLine («Só 13,1% dos jogadores a têm» ou null),
 *         person: { name, photo (bakeCircle) ou null, initials, sub («Desde 1 jul 2026») } }
 * format: 'stories' | 'square'
 */
const AchievementShareCard = forwardRef(function AchievementShareCard({ rarity, data, format = 'stories' }, ref) {
  const nodeRef = useRef(null)
  const square = format === 'square'
  const H = square ? A_SQUARE_H : A_STORY_H
  useImperativeHandle(ref, () => ({ exportPng: () => exportCard(nodeRef.current, A_CARD_W, H) }))

  if (!square) {
    const person = data.person
    return (
      <ShareFrame nodeRef={nodeRef} bg={flatBg(rarity)} label={data.kicker} date={data.date}
        org={person ? { name: shortName(person.name), logo: person.photo, initials: person.initials, solid: true } : null}
        top={(
          <div className="absolute left-0 right-0 flex justify-center" style={{ top: 96 }}>
            {data.medal
              ? <img src={data.medal} alt="" className="block" style={{ width: 220, height: 220, filter: 'drop-shadow(0 14px 18px rgba(0,0,0,.45))' }} />
              : <span className="mt-6 block rounded-full" style={{ width: 160, height: 160, background: 'rgba(255,255,255,.14)' }} />}
          </div>
        )}>
        <p className="font-display text-[34px] font-black leading-none tracking-[-.01em]">{data.name}</p>
        <p className="mt-1.5 text-[12px] leading-snug text-white/85">{data.desc}</p>
        {data.pctLine && (
          <span className="mt-2.5 self-start rounded-full px-2.5 py-1 text-[10px] font-bold" style={{ background: 'rgba(255,255,255,.14)' }}>{data.pctLine}</span>
        )}
      </ShareFrame>
    )
  }

  // O quadrado (360 × 360, sem a pessoa), como estava.
  const medal = data.medal
    ? <img src={data.medal} alt="" className="block" style={{ width: 150, height: 150, filter: 'drop-shadow(0 14px 18px rgba(0,0,0,.45))' }} />
    // Sem medalha, fica só a cor, sem buraco (SPEC).
    : <span className="block rounded-full" style={{ width: 105, height: 105, background: 'rgba(255,255,255,.14)' }} />

  return (
    <div ref={nodeRef} className="relative overflow-hidden font-sans text-white" style={{ width: A_CARD_W, height: H }}>
      <Background rarity={rarity} cy="42%" />
      <div className="absolute inset-x-0 flex flex-col items-center px-[18px]" style={{ top: 18, bottom: 18 }}>
        <div className="flex w-full items-center justify-between">
          <Logo />
          <span className="font-mono text-[8.5px] font-bold uppercase tracking-[0.12em]">{data.date}</span>
        </div>
        <p className="mt-2 font-mono text-[8.5px] font-bold uppercase tracking-[0.16em] text-white/85">{data.kicker}</p>
        <div className="mt-1">{medal}</div>
        <p className="mt-1 text-center font-display text-[22px] font-black leading-[1.05] tracking-[-.01em]">{data.name}</p>
        <p className="mt-1.5 max-w-[280px] text-center text-[11px] leading-snug text-white/85">{data.desc}</p>
        {data.pctLine && (
          <span className="mt-2.5 rounded-full px-3 py-1 text-[9.5px] font-extrabold" style={{ background: 'rgba(255,255,255,.18)' }}>{data.pctLine}</span>
        )}
      </div>
    </div>
  )
})

export default AchievementShareCard
