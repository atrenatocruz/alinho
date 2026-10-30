// Os cartões de partilha do torneio, vertical 1080 × 1920 (histórias e
// estados) — design-handoff/2026-09-25-cartoes-partilha/torneio-partilha.png,
// aprovado pelo Francisco a 27 set. Como o ShareCard do mix: desenhado a
// 360 × 640 e exportado a 3× com o html-to-image.
//
// Safe areas do Instagram (Ruben, 30 out): 252 px livres em cima e 300 em
// baixo a 1080 (84/100 a 360) — é onde as Stories põem a câmara/perfil e a
// caixa de resposta. O conteúdo nunca lá entra; a foto de fundo pode. O QR
// saiu das partilhas a 30 out (Ruben: «não faz sentido»). Com foto, a foto
// ocupa a metade de cima e o cartão fica compacto em baixo. A foto chega já
// cortada à medida (canvas): o WebKit estraga fotos cortadas por CSS ao
// rasterizar (ver ShareCard.jsx).
//
// Vencedores em todos os jogos (#622, design-handoff/2026-10-11-vencedores-
// em-todos-os-jogos, aprovado pelo Francisco a 11 out): o mesmo cartão serve
// o mix, o americano, o jogo em aberto e os amigos. Por baixo do logótipo,
// o clube ou grupo onde se jogou (`org`); o miolo é o pódio, o resultado ou
// um corpo próprio (`children`). Sem `org` e sem `children`, o torneio fica
// exatamente como estava.
import { forwardRef, useImperativeHandle, useRef } from 'react'
import { toPng } from 'html-to-image'
import { useTranslation } from 'react-i18next'
import { Trophy } from 'lucide-react'
import logoWordmark from '../../logo/primary-dark-card.svg'
import iconMark from '../../logo/icon-mark.svg'

export const T_CARD_W = 360
export const T_CARD_H = 640
const RATIO = 3
const SAFE_TOP = 84     // 252 px a 1080 — câmara/perfil das Stories
const SAFE_BOTTOM = 100 // 300 px a 1080 — caixa de resposta das Stories
export const PHOTO_H = 330 // a metade de cima, com foto

const LIME = '#C5DD01'

/** A foto cortada ao tamanho da metade de cima (cover), já em píxeis de
 *  exportação — nada de object-fit para o WebKit estragar.
 *  `zoom` (1 = só cobrir; até 3) e `ox`/`oy` (0-1, posição da janela dentro
 *  da foto; 0.5 = centro) são o ajuste do utilizador (Ruben, 30 out) — a
 *  janela nunca sai de dentro da foto. */
export async function bakePhoto(dataUrl, { zoom = 1, ox = 0.5, oy = 0.5 } = {}) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = () => reject(new Error('photo_failed'))
    i.src = dataUrl
  })
  const w = T_CARD_W * RATIO
  const h = PHOTO_H * RATIO
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight) * Math.min(Math.max(zoom, 1), 3)
  const dw = img.naturalWidth * scale
  const dh = img.naturalHeight * scale
  const cx = Math.min(Math.max(ox, 0), 1)
  const cy = Math.min(Math.max(oy, 0), 1)
  ctx.drawImage(img, -(dw - w) * cx, -(dh - h) * cy, dw, dh)
  // Escurecido em cima E em baixo (Ruben, 30 out): em cima para o logótipo,
  // a data e o clube se lerem sobre qualquer foto; em baixo para a foto
  // fundir com o cartão.
  const gTop = ctx.createLinearGradient(0, 0, 0, h * 0.42)
  gTop.addColorStop(0, 'rgba(11,11,12,0.82)')
  gTop.addColorStop(1, 'rgba(11,11,12,0)')
  ctx.fillStyle = gTop
  ctx.fillRect(0, 0, w, h * 0.42)
  const g = ctx.createLinearGradient(0, h * 0.45, 0, h)
  g.addColorStop(0, 'rgba(11,11,12,0)')
  g.addColorStop(1, 'rgba(11,11,12,1)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  return canvas.toDataURL('image/jpeg', 0.9)
}

/** O logótipo do clube num círculo, já em píxeis (canvas): o WebKit estraga
 *  imagens cortadas em redondo por CSS ao rasterizar. null se não der (sem
 *  CORS, ou sem imagem) — aí ficam as iniciais. */
export async function bakeCircle(url, size = 64) {
  if (!url) return null
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image()
      i.crossOrigin = 'anonymous'
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('logo_failed'))
      i.src = url
    })
    const px = size * RATIO
    const canvas = document.createElement('canvas')
    canvas.width = px
    canvas.height = px
    const ctx = canvas.getContext('2d')
    ctx.beginPath()
    ctx.arc(px / 2, px / 2, px / 2, 0, Math.PI * 2)
    ctx.clip()
    const scale = Math.max(px / img.naturalWidth, px / img.naturalHeight)
    ctx.drawImage(img, (px - img.naturalWidth * scale) / 2, (px - img.naturalHeight * scale) / 2, img.naturalWidth * scale, img.naturalHeight * scale)
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

/** A imagem do mix como «foto» (sem foto escolhida): o mesmo corte da foto. */
export const bakeImageUrl = async (url) => {
  if (!url) return null
  try {
    const blob = await (await fetch(url, { mode: 'cors' })).blob()
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result)
      r.onerror = reject
      r.readAsDataURL(blob)
    })
    return await bakePhoto(dataUrl)
  } catch {
    return null
  }
}

const Mono = ({ children, className = '' }) => (
  <p className={`font-mono text-[8.5px] font-bold uppercase tracking-[0.12em] text-[#9CA3AF] ${className}`}>{children}</p>
)

function Header({ date }) {
  return (
    <div className="flex items-center justify-between">
      {/* «alinho.pt» em tudo o que sai da app (regra de 29 set; UX, 12 out):
          o logótipo de sempre com «.pt» logo a seguir, branco, da altura das letras. */}
      <span className="flex items-end gap-[1px]">
        <img src={logoWordmark} alt="alinho" className="h-[18px] w-auto" />
        <span className="font-sans text-[15px] font-medium leading-[14px] text-white">.pt</span>
      </span>
      <span className="font-mono text-[8.5px] font-bold uppercase tracking-[0.12em] text-white">{date}</span>
    </div>
  )
}

/** O clube ou grupo onde se jogou: o logótipo num círculo (ou as iniciais) e
 *  o nome; por baixo, pequeno, o evento e o tipo. Sem clube (amigos), «📍»
 *  e o sítio escrito no jogo. */
function OrgLine({ org }) {
  if (!org) return null
  const circle = org.place
    ? <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[#1A1A1D] text-[11px]">📍</span>
    // Sem clube (o Ranking geral): a bola lima da alinho no lugar da inicial.
    : org.mark ? <img src={iconMark} alt="" className="block h-[22px] w-[22px] shrink-0 rounded-full" />
    : org.logo
      ? <img src={org.logo} alt="" className="block h-[22px] w-[22px] shrink-0" />
      : <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border text-[8px] font-extrabold" style={{ borderColor: LIME, color: LIME }}>{org.initials}</span>
  return (
    <div className="mt-3 flex items-center gap-2">
      {circle}
      <div className="min-w-0">
        <p className="truncate text-[10px] font-extrabold leading-tight text-white">{org.place || org.name}</p>
        {org.sub && <p className="truncate text-[7.5px] leading-tight text-[#9CA3AF]">{org.sub}</p>}
      </div>
    </div>
  )
}

function Footer() {
  const { t } = useTranslation()
  // Sem o QR (30 out), o rodapé fica centrado, numa linha, com a bola do
  // alinho por cima a equilibrar o espaço.
  return (
    <div className="text-center">
      <img src={iconMark} alt="" className="mx-auto mb-1.5 block h-[20px] w-[20px] rounded-full" />
      <p className="text-[12px] font-extrabold leading-tight text-white">{t('share.play_padel')} {t('share.on_alinho')}</p>
      <p className="mt-1 text-[7.5px] text-[#9CA3AF]">alinho.pt · #alinhopadel</p>
    </div>
  )
}

function Record({ words }) {
  if (!words) return null
  const [lead, ...rest] = words.split(' ')
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#2A2A2E] px-2.5 py-1 text-[8.5px] font-bold text-white">
      <Trophy size={9} color={LIME} />
      <b style={{ color: LIME }}>{lead} {rest.slice(0, 2).join(' ')}</b> {rest.slice(2).join(' ')}
    </span>
  )
}

/** Resultado de um jogo. */
function ResultBody({ d, compact }) {
  const { t } = useTranslation()
  const mineBox = (
    <div className={`flex items-center justify-between gap-2 rounded-[10px] border-2 px-3 ${compact ? 'py-2' : 'py-3'}`} style={{ borderColor: LIME, background: compact ? 'rgba(11,11,12,0.6)' : '#0B0B0C' }}>
      <div className="min-w-0">
        {!compact && d.won && !d.wonBelow && <span className="mb-1 inline-block rounded-[4px] px-1.5 py-[1px] text-[7px] font-extrabold text-[#0B0B0C]" style={{ background: LIME }}>{t('tshare.won_tag')}</span>}
        <p className={`truncate font-extrabold text-white ${compact ? 'text-[11px]' : 'text-[12.5px]'}`}>
          {compact && d.won && <span style={{ color: LIME }}>✓ </span>}{d.mine}
        </p>
        {!compact && d.teamName && <p className="truncate text-[8px] text-[#9CA3AF]">{d.teamName}</p>}
        {d.won && d.wonBelow && <p className="text-[7.5px] font-extrabold uppercase" style={{ color: LIME }}>{d.wonBelow}</p>}
      </div>
      <b className={`font-display font-extrabold ${compact ? 'text-[16px]' : 'text-[24px]'}`} style={{ color: d.won ? LIME : '#FFFFFF' }}>{d.myScore}</b>
    </div>
  )
  return (
    <div>
      <Mono>{d.kicker}</Mono>
      <p className={`mt-1 font-display font-extrabold leading-none text-white ${compact ? 'text-[20px]' : 'text-[28px]'}`}>{d.heading || t('tshare.result')}</p>
      <div className={`${compact ? 'mt-2 space-y-1.5' : 'mt-3 space-y-2'}`}>
        {mineBox}
        <div className={`flex items-center justify-between gap-2 rounded-[10px] bg-[#1A1A1D] px-3 ${compact ? 'py-2' : 'py-3'}`}>
          <p className={`min-w-0 truncate text-[#9CA3AF] ${compact ? 'text-[11px]' : 'text-[12px]'}`}>{d.theirs}</p>
          <b className={`font-display font-extrabold text-[#9CA3AF] ${compact ? 'text-[16px]' : 'text-[22px]'}`}>{d.theirScore}</b>
        </div>
      </div>
      {d.sets && <p className="mt-2 text-center font-mono text-[9px] font-bold tracking-[0.1em] text-[#9CA3AF]">{d.sets}</p>}
      <div className="mt-2"><Record words={d.record} /></div>
    </div>
  )
}

/** Pódio da categoria (ou o lugar, do 4.º para baixo). */
function PodiumBody({ d, compact }) {
  const { t } = useTranslation()
  return (
    <div>
      <Mono>{d.kicker}</Mono>
      <p className={`mt-1 font-display font-extrabold leading-none text-white ${compact ? 'text-[22px]' : 'text-[30px]'}`} style={d.title ? { color: LIME } : undefined}>{d.title || t('tshare.place', { n: d.place })}</p>
      <div className={`${compact ? 'mt-2 space-y-1.5' : 'mt-3 space-y-2'}`}>
        {d.rows.map((r) => (
          <div key={r.place} className={`flex items-center gap-3 rounded-[10px] px-3 ${compact ? 'py-1.5' : 'py-2.5'} ${r.mine ? 'border-2' : 'bg-[#1A1A1D]'}`}
            style={r.mine ? { borderColor: LIME, background: compact ? 'rgba(11,11,12,0.6)' : '#0B0B0C' } : undefined}>
            <b className="w-4 text-[14px] font-extrabold text-white">{r.place}</b>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11.5px] font-extrabold text-white">{r.pair}</p>
              {r.title && <p className="truncate text-[8px] font-bold" style={{ color: r.mine ? LIME : '#9CA3AF' }}>{r.title}</p>}
            </div>
            {/* Americano: os pontos de cada um, à direita (#622). */}
            {r.score != null && <b className="shrink-0 font-display text-[13px] font-extrabold" style={{ color: r.mine ? LIME : '#FFFFFF' }}>{r.score}</b>}
          </div>
        ))}
      </div>
      <div className="mt-2"><Record words={d.record} /></div>
    </div>
  )
}

/**
 * variant: 'result' | 'podium'
 * data (result): { kicker, date, mine, teamName, theirs, myScore, theirScore, won, sets, record }
 * data (podium): { kicker, date, place, rows: [{ place, pair, title, mine }], record }
 * photo: data URL já cortado (bakePhoto), ou null
 * org (#622, opcional): { name, logo (bakeCircle), initials, sub, place, mark (a bola da alinho) }
 * children (#622, opcional): um miolo próprio no lugar do pódio/resultado;
 *   como função, recebe { compact } (com foto, o miolo encolhe)
 */
const TournamentShareCard = forwardRef(function TournamentShareCard({ variant, data, photo, org = null, children = null }, ref) {
  const nodeRef = useRef(null)
  useImperativeHandle(ref, () => ({
    exportPng: async () => {
      const node = nodeRef.current
      if (!node) throw new Error('Card not ready')
      const opts = { width: T_CARD_W, height: T_CARD_H, pixelRatio: RATIO, cacheBust: true }
      // No iPhone (WebKit), a foto grande saía preta: o html-to-image desenha
      // antes de ela estar descodificada (QA, 11 out). Espera-se pela
      // descodificação de todas as imagens e faz-se uma primeira passagem
      // que se deita fora; a segunda já leva a foto.
      await Promise.all([...node.querySelectorAll('img')].map((img) => (img.decode ? img.decode().catch(() => {}) : null)))
      await toPng(node, opts).catch(() => {})
      const dataUrl = await toPng(node, opts)
      return (await fetch(dataUrl)).blob()
    },
  }))
  const compact = !!photo
  const Body = variant === 'podium' ? PodiumBody : ResultBody
  return (
    <div ref={nodeRef} className="relative overflow-hidden bg-[#0B0B0C] font-sans" style={{ width: T_CARD_W, height: T_CARD_H }}>
      {photo && <img src={photo} alt="" className="absolute left-0 top-0 block" style={{ width: T_CARD_W, height: PHOTO_H }} />}
      {/* O cabeçalho vive sempre no topo (sobre a faixa escura da foto). */}
      <div className="absolute inset-x-0 px-[18px]" style={{ top: SAFE_TOP }}>
        <Header date={data.date} />
        <OrgLine org={org} />
      </div>
      {/* O corpo centra-se no espaço que sobra — por baixo da foto quando a
          há (Ruben, 30 out: sem o QR, o preto empoçava todo em baixo) — e o
          rodapé fecha no limite da safe area. */}
      <div className="absolute inset-x-0 flex flex-col px-[18px]" style={{ top: compact ? PHOTO_H + 8 : 170, bottom: SAFE_BOTTOM }}>
        <div className="flex flex-1 flex-col justify-center">{children ? (typeof children === 'function' ? children({ compact }) : children) : <Body d={data} compact={compact} />}</div>
        <div className="mt-3"><Footer /></div>
      </div>
    </div>
  )
})

export default TournamentShareCard
