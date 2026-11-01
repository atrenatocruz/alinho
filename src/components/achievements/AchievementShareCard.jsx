// A imagem para partilhar uma conquista (design-handoff/2026-10-13-partilhar-
// conquistas, versão B, aprovada pelo Francisco a 13 out): o fundo na cor da
// raridade com raios atrás da medalha, a medalha 3D grande, o nome e a frase,
// «Só X% dos jogadores a têm», quem a ganhou e desde quando, «Joga padel no
// alinho.pt». Como os outros cartões de partilha: desenhado a 360 ×
// 640 (stories) ou 360 × 360 (quadrado, sem a pessoa) e exportado
// a 3× com o html-to-image.
import { forwardRef, useImperativeHandle, useRef } from 'react'
import { toPng } from 'html-to-image'
import { useTranslation } from 'react-i18next'
import logoWordmark from '../../logo/primary-dark-card.svg'

export const A_CARD_W = 360
export const A_STORY_H = 640
export const A_SQUARE_H = 360
const RATIO = 3
const SAFE = 73 // zona livre em cima e em baixo das stories (Instagram)

// Versão B: o degradé radial de cada raridade, claro atrás da medalha e
// escuro em baixo (SPEC, ponto 2).
export const RARITY_BG = {
  comum: ['#0F9D8A', '#073F38'],
  raro: ['#2563EB', '#0B2A6B'],
  epico: ['#6D28D9', '#2E1065'],
  lendario: ['#B8860B', '#4A3300'],
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
  const { t } = useTranslation()
  const nodeRef = useRef(null)
  const square = format === 'square'
  const H = square ? A_SQUARE_H : A_STORY_H
  useImperativeHandle(ref, () => ({
    exportPng: async () => {
      const node = nodeRef.current
      if (!node) throw new Error('Card not ready')
      const opts = { width: A_CARD_W, height: H, pixelRatio: RATIO, cacheBust: true }
      // No iPhone, a primeira passagem do html-to-image pode sair sem as
      // imagens: espera-se pela descodificação e deita-se a primeira fora.
      await Promise.all([...node.querySelectorAll('img')].map((img) => (img.decode ? img.decode().catch(() => {}) : null)))
      await toPng(node, opts).catch(() => {})
      const dataUrl = await toPng(node, opts)
      return (await fetch(dataUrl)).blob()
    },
  }))

  const medalW = square ? 150 : 223 // ~670 px na imagem das stories
  const medal = data.medal
    ? <img src={data.medal} alt="" className="block" style={{ width: medalW, height: medalW, filter: 'drop-shadow(0 14px 18px rgba(0,0,0,.45))' }} />
    // Sem medalha, fica só a cor, sem buraco (SPEC).
    : <span className="block rounded-full" style={{ width: medalW * 0.7, height: medalW * 0.7, background: 'rgba(255,255,255,.14)' }} />

  return (
    <div ref={nodeRef} className="relative overflow-hidden font-sans text-white" style={{ width: A_CARD_W, height: H }}>
      <Background rarity={rarity} cy={square ? '42%' : '38%'} />
      <div className="absolute inset-x-0 flex flex-col items-center px-[18px]" style={square ? { top: 18, bottom: 18 } : { top: SAFE, bottom: SAFE }}>
        <div className="flex w-full items-center justify-between">
          <Logo />
          <span className="font-mono text-[8.5px] font-bold uppercase tracking-[0.12em]">{data.date}</span>
        </div>
        <p className={`${square ? 'mt-2' : 'mt-4'} font-mono text-[8.5px] font-bold uppercase tracking-[0.16em] text-white/85`}>{data.kicker}</p>
        <div className={square ? 'mt-1' : 'mt-3'}>{medal}</div>
        <p className={`${square ? 'mt-1 text-[22px]' : 'mt-3 text-[28px]'} text-center font-display font-black leading-[1.05] tracking-[-.01em]`}>{data.name}</p>
        <p className="mt-1.5 max-w-[280px] text-center text-[11px] leading-snug text-white/85">{data.desc}</p>
        {data.pctLine && (
          <span className="mt-2.5 rounded-full px-3 py-1 text-[9.5px] font-extrabold" style={{ background: 'rgba(255,255,255,.18)' }}>{data.pctLine}</span>
        )}
        {!square && data.person && (
          <div className="mt-4 flex items-center gap-2">
            {data.person.photo
              ? <img src={data.person.photo} alt="" className="block h-[28px] w-[28px] shrink-0" />
              // Sem foto: as iniciais, brancas sobre #1F2937, como os avatares da app (SPEC).
              : <span className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-full bg-[#1F2937] font-display text-[10px] font-extrabold text-white">{data.person.initials}</span>}
            <span className="min-w-0">
              <span className="block truncate text-[11px] font-extrabold leading-tight">{data.person.name}</span>
              {data.person.sub && <span className="block truncate text-[9px] leading-tight text-white/80">{data.person.sub}</span>}
            </span>
          </div>
        )}
        {!square && (
          <div className="mb-[14px] mt-auto flex w-full items-end justify-between gap-3">
            <div>
              <p className="text-[12px] font-extrabold leading-tight">{t('share.play_padel')}<br />{t('share.on_alinho')}</p>
              <p className="mt-0.5 text-[7.5px] text-white/70">alinho.pt · #alinhopadel</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
})

export default AchievementShareCard
