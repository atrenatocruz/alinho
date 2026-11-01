// O cartão de partilha, um desenho só para todas as partilhas (#743,
// design-handoff/2026-10-30-partilha-cartoes-acerto, aprovado pelo Francisco
// a 30 out sobre proposta-todas.png): os vencedores do mix, do americano e do
// jogo em aberto, o torneio, o jogo entre amigos, o pódio do mês e a
// conquista (AchievementShareCard usa a mesma moldura, ShareFrame).
//
// Desenhado a 360 × 640 e exportado a 3× com o html-to-image. De cima para
// baixo:
//   · a foto, limpa (sem texto nem sombra no topo). Ao alto enche o cartão;
//     deitada (ou quadrada) aparece inteira a toda a largura. Sem foto, a
//     imagem do tipo de evento (/topo/topo-<tipo>.webp) ou um desenho próprio
//     (`hero`: o pódio do mês, a medalha);
//   · a faixa do título (y 326): a lima, o que se partilha; à direita, a data
//     e o clube ou grupo;
//   · o miolo (pódio, resultado ou um corpo próprio, `children`);
//   · em baixo, a bola do alinho, «alinho.pt» e «E tu, alinhas?», acima da
//     caixa de resposta das Stories (100 px do fundo).
// O fundo nunca é preto: um tom escuro tirado da foto ou, sem foto, a cor do
// tipo de evento. A foto e o logótipo chegam já cortados (canvas): o WebKit
// estraga imagens cortadas por CSS ao rasterizar (ver ShareCard.jsx).
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import { useTranslation } from 'react-i18next'
import iconMark from '../../logo/icon-mark.svg'

export const T_CARD_W = 360
export const T_CARD_H = 640
const RATIO = 3
const SAFE_BOTTOM = 100 // 300 px a 1080: a caixa de resposta das Stories
export const PHOTO_H = 376 // a zona da foto (ou da imagem do evento)
const STRIP_BOTTOM = 352 // a faixa do título acaba aqui (começa em ~326)
const BODY_TOP = 362

const LIME = '#C5DD01'

/** A cor de cada tipo de evento, escurecida, para o fundo sem foto (SPEC 2). */
export const KIND_BG = {
  mix: [16, 38, 110],
  aberto: [72, 26, 10], // o laranja do jogo em aberto (#C2410C, kindColors), escurecido (UX, 30 out)
  torneio: [46, 22, 92],
  amigos: [30, 36, 48],
  podio: [20, 22, 27],
}
/** A imagem de cada tipo, no lugar da foto quando não há foto. */
const KIND_TOP = {
  mix: '/topo/topo-mix.webp',
  aberto: '/topo/topo-aberto.webp',
  torneio: '/topo/topo-torneio.webp',
  amigos: '/topo/topo-amigos.webp',
}

export const rgb = (c) => `rgb(${c.join(',')})`

const loadImage = (src) => new Promise((resolve, reject) => {
  const i = new Image()
  i.onload = () => resolve(i)
  i.onerror = () => reject(new Error('photo_failed'))
  i.src = src
})

/** Um tom escuro tirado da foto, para o fundo: a média das cores do terço de
 *  baixo (é aí que a foto se funde com o fundo), um pouco mais viva (senão dá
 *  quase sempre cinzento) e escurecida até o texto branco se ler sempre. */
export function darkTone(img) {
  const c = document.createElement('canvas')
  c.width = 16
  c.height = 16
  const x = c.getContext('2d')
  const h = img.naturalHeight
  x.drawImage(img, 0, h * 0.66, img.naturalWidth, h * 0.34, 0, 0, 16, 16)
  const px = x.getImageData(0, 0, 16, 16).data
  let r = 0, g = 0, b = 0
  for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; b += px[i + 2] }
  const n = px.length / 4
  const avg = [r / n, g / n, b / n]
  const grey = (avg[0] + avg[1] + avg[2]) / 3
  const vivid = avg.map((v) => Math.max(0, grey + (v - grey) * 1.8))
  const lum = 0.2126 * vivid[0] + 0.7152 * vivid[1] + 0.0722 * vivid[2]
  const k = Math.min(0.45, 32 / Math.max(lum, 1))
  return vivid.map((v) => Math.min(255, Math.round(v * k)))
}

/** Ao alto ou deitada: uma foto mais alta do que larga (a partir de 1,15)
 *  enche o cartão; a quadrada e a deitada aparecem inteiras, sem cortar as
 *  pessoas das pontas. */
export const photoMode = (width, height) => (height / width >= 1.15 ? 'alto' : 'deitada')

/** A foto pronta para o cartão, já em píxeis de exportação: { src, mode, tone }.
 *  `zoom` (1 a 3) e `ox`/`oy` (0-1; 0.5 = centro) são o ajuste do
 *  utilizador (Ruben, 30 out). Ao alto, a foto cobre os 360 × 640 e escurece
 *  a partir de ~36% da altura, sem a tapar; deitada, cabe à largura nos 376 de
 *  cima e funde-se em baixo com o fundo, sem sombra no topo. */
export async function bakePhoto(dataUrl, { zoom = 1, ox = 0.5, oy = 0.5, mode = null } = {}) {
  const img = await loadImage(dataUrl)
  const m = mode || photoMode(img.naturalWidth, img.naturalHeight)
  const tone = darkTone(img)
  const w = T_CARD_W * RATIO
  const h = (m === 'alto' ? T_CARD_H : PHOTO_H) * RATIO
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = rgb(tone)
  ctx.fillRect(0, 0, w, h)
  const fit = m === 'alto'
    ? Math.max(w / img.naturalWidth, h / img.naturalHeight)
    : w / img.naturalWidth
  const scale = fit * Math.min(Math.max(zoom, 1), 3)
  const dw = img.naturalWidth * scale
  const dh = img.naturalHeight * scale
  // Com folga (deitada, mais baixa do que a zona), oy põe-na mais acima ou
  // mais abaixo; com sobra, escolhe o pedaço que se vê.
  ctx.drawImage(img, -(dw - w) * Math.min(Math.max(ox, 0), 1), -(dh - h) * Math.min(Math.max(oy, 0), 1), dw, dh)
  fade(ctx, w, h, tone, m === 'alto' ? [0.36, [[0.25, 0.66], [1, 0.88]]] : [0.66, [[0.6, 0.85], [1, 1]]])
  return { src: canvas.toDataURL('image/jpeg', 0.9), mode: m, tone }
}

function fade(ctx, w, h, c, [from, stops]) {
  const g = ctx.createLinearGradient(0, h * from, 0, h)
  g.addColorStop(0, `rgba(${c.join(',')},0)`)
  stops.forEach(([p, a]) => g.addColorStop(p, `rgba(${c.join(',')},${a})`))
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
}

/** A imagem do evento (sem foto) na zona da foto, a fundir-se em baixo com a
 *  cor do tipo. null se não der. */
export async function bakeEventImage(url, color) {
  if (!url) return null
  try {
    const blob = await (await fetch(url, { mode: 'cors' })).blob()
    const img = await loadImage(URL.createObjectURL(blob))
    const w = T_CARD_W * RATIO
    const h = PHOTO_H * RATIO
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight)
    const dw = img.naturalWidth * scale
    const dh = img.naturalHeight * scale
    ctx.drawImage(img, -(dw - w) / 2, -(dh - h) / 2, dw, dh)
    URL.revokeObjectURL(img.src)
    fade(ctx, w, h, color, [0.55, [[0.6, 0.85], [1, 1]]])
    return canvas.toDataURL('image/jpeg', 0.9)
  } catch {
    return null
  }
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

/** O export de todos os cartões: espera a descodificação das imagens e deita
 *  fora a primeira passagem — no iPhone (WebKit) a foto grande saía preta
 *  (QA, 11 out). */
export async function exportCard(node, width, height) {
  if (!node) throw new Error('Card not ready')
  const opts = { width, height, pixelRatio: RATIO, cacheBust: true }
  await Promise.all([...node.querySelectorAll('img')].map((img) => (img.decode ? img.decode().catch(() => {}) : null)))
  await toPng(node, opts).catch(() => {})
  const dataUrl = await toPng(node, opts)
  return (await fetch(dataUrl)).blob()
}

/** O círculo à direita da data: o logótipo do clube (ou as iniciais), «📍»
 *  num jogo entre amigos, a bola do alinho no ranking geral, a pessoa numa
 *  conquista. */
function OrgCircle({ org }) {
  if (org.place) return <span className="text-[10px] leading-none">📍</span>
  if (org.mark) return <img src={iconMark} alt="" className="block h-[16px] w-[16px] shrink-0 rounded-full" />
  if (org.logo) return <img src={org.logo} alt="" className="block h-[16px] w-[16px] shrink-0" />
  return (
    <span className="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full border text-[6.5px] font-extrabold"
      style={org.solid ? { background: '#FFFFFF', borderColor: '#FFFFFF', color: '#111111' } : { borderColor: LIME, color: LIME }}>
      {org.initials || '•'}
    </span>
  )
}

function Footer() {
  const { t } = useTranslation()
  return (
    <div className="text-center">
      <div className="flex items-center justify-center gap-1.5">
        <img src={iconMark} alt="" className="block h-[18px] w-[18px] rounded-full" />
        <span className="text-[14px] font-extrabold leading-none text-white">alinho.pt</span>
      </div>
      <p className="mt-1 text-[11px] font-semibold text-[#D1D5DB]">{t('share.tagline')}</p>
    </div>
  )
}

/**
 * A moldura comum. top: o que vai na zona de cima (a foto, a imagem do
 * evento, o pódio desenhado, a medalha). label: o que se partilha, a lima.
 * date e org ({ name, place, logo, initials, mark, solid }) à direita.
 */
export function ShareFrame({ nodeRef, bg, top, label, date, org, children }) {
  return (
    <div ref={nodeRef} className="relative overflow-hidden font-sans text-white" style={{ width: T_CARD_W, height: T_CARD_H, background: rgb(bg) }}>
      {top}
      {/* Presa por baixo: um título comprido («Pódio do ranking ·
          Masculino», em espanhol) passa a duas linhas para cima, sem cortar. */}
      <div className="absolute inset-x-0 px-[18px]" style={{ bottom: T_CARD_H - STRIP_BOTTOM }}>
        <div className="flex items-end justify-between gap-3">
          <p className="line-clamp-2 min-w-0 font-mono text-[11.5px] font-bold uppercase leading-[1.35] tracking-[0.16em]" style={{ color: LIME }}>{label}</p>
          <div className="shrink-0 text-right">
            <p className="font-mono text-[8.5px] font-bold uppercase tracking-[0.12em] text-white">{date}</p>
            {org && (
              <span className="mt-1.5 flex items-center justify-end gap-1.5">
                <span className="max-w-[150px] truncate font-mono text-[8.5px] font-bold uppercase tracking-[0.12em] text-[#D1D5DB]">{org.place || org.name}</span>
                <OrgCircle org={org} />
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="absolute inset-x-0 flex flex-col px-[18px]" style={{ top: BODY_TOP, bottom: SAFE_BOTTOM }}>
        {children}
        <div className="mt-auto pt-2"><Footer /></div>
      </div>
    </div>
  )
}

/** A linha grande (o 1.º lugar, quem ganhou): fundo preto a 40%, o lugar ou
 *  o resultado a lima, os nomes e a taça. */
export function TopRow({ lead, name, right = null, trophy = true, tight = false }) {
  return (
    <div className={`flex items-center gap-3.5 rounded-[16px] px-4 ${tight ? 'mt-1 py-1' : 'mt-1.5 py-2'}`} style={{ background: 'rgba(0,0,0,.4)' }}>
      <p className="shrink-0 font-display text-[26px] font-black leading-none" style={{ color: LIME }}>{lead}</p>
      <p className="min-w-0 flex-1 truncate text-[15.5px] font-extrabold leading-tight">{name}</p>
      {right != null && <span className="shrink-0 text-[12px] font-extrabold text-white/75">{right}</span>}
      {trophy && <span className="shrink-0 text-[17px] leading-none">🏆</span>}
    </div>
  )
}

/** As linhas pequenas (2.º, 3.º, quem perdeu): fundo preto a 28%. */
export function Row({ lead, name, right = null, mine = false, dim = false, tight = false }) {
  return (
    <div className={`flex items-center gap-3.5 rounded-[12px] px-4 ${tight ? 'mt-1 py-1' : 'mt-1.5 py-1.5'}`} style={{ background: 'rgba(0,0,0,.28)' }}>
      <p className="w-7 shrink-0 font-display text-[16px] font-black leading-none text-white/55">{lead}</p>
      <p className={`min-w-0 flex-1 truncate text-[12.5px] font-extrabold ${dim ? 'text-white/70' : ''}`} style={mine ? { color: LIME } : undefined}>{name}</p>
      {right != null && <span className="shrink-0 text-[12px] font-extrabold text-white/75">{right}</span>}
    </div>
  )
}

/** A linha em mono por baixo do resultado: «1 RONDA A 0 · SET 6-3». */
export const ScoreLine = ({ children }) => (
  <p className="mt-2.5 text-center font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-[#D1D5DB]">{children}</p>
)

/** Resultado de um jogo: quem ganhou em grande, quem perdeu em pequeno. */
function ResultBody({ d }) {
  const [winner, wScore, loser, lScore] = d.won ? [d.mine, d.myScore, d.theirs, d.theirScore] : [d.theirs, d.theirScore, d.mine, d.myScore]
  return (
    <div>
      <TopRow lead={wScore} name={winner} />
      {loser && <Row lead={lScore} name={loser} dim />}
      {d.sets && <ScoreLine>{d.sets}</ScoreLine>}
    </div>
  )
}

/** O pódio: o 1.º em grande com a taça, o 2.º e o 3.º (e, do 4.º para
 *  baixo, a linha de quem partilha) em pequeno. Sem a risca lima de lado
 *  (regra de 27 out). */
function PodiumBody({ d }) {
  const rows = d.rows || []
  // Com a 4.ª linha (a de quem partilha), as linhas apertam para o rodapé
  // não descer para a caixa de resposta das Stories.
  const tight = rows.length > 3
  return (
    <div>
      {rows.map((r, i) => (i === 0 && r.place === 1
        ? <TopRow key={`${r.place}-${i}`} lead={`${r.place}.º`} name={r.pair} right={r.score ?? null} tight={tight} />
        : <Row key={`${r.place}-${i}`} lead={`${r.place}.º`} name={r.pair} right={r.score ?? null} mine={r.mine} tight={tight} />))}
    </div>
  )
}

/** A imagem do evento na zona de cima, cozida para fundir com a cor. */
function useEventImage(url, color) {
  const [src, setSrc] = useState(null)
  const key = color.join(',')
  useEffect(() => {
    let alive = true
    setSrc(null)
    bakeEventImage(url, color).then((v) => { if (alive) setSrc(v) })
    return () => { alive = false }
  }, [url, key])
  return src
}

/**
 * variant: 'result' | 'podium' (ou um miolo próprio em `children`)
 * kind: 'mix' | 'aberto' | 'torneio' | 'amigos' | 'podio' — a cor e a imagem sem foto
 * data (result): { label, date, mine, theirs, myScore, theirScore, won, sets }
 * data (podium): { label, date, rows: [{ place, pair, mine, score }] }
 * photo: { src, mode, tone } (bakePhoto), ou null
 * heroImage: a imagem do evento quando não há foto (por omissão, a do tipo)
 * hero: um desenho próprio na zona de cima quando não há foto (o pódio do mês)
 * org: { name, logo (bakeCircle), initials, place, mark (a bola do alinho) }
 * children: um miolo próprio no lugar do pódio/resultado
 */
const TournamentShareCard = forwardRef(function TournamentShareCard({ variant, kind = 'torneio', data, photo, heroImage = null, hero = null, org = null, children = null }, ref) {
  const nodeRef = useRef(null)
  useImperativeHandle(ref, () => ({ exportPng: () => exportCard(nodeRef.current, T_CARD_W, T_CARD_H) }))
  const color = KIND_BG[kind] || KIND_BG.torneio
  const eventImage = useEventImage(!photo && !hero ? (heroImage || KIND_TOP[kind]) : null, color)
  const Body = variant === 'podium' ? PodiumBody : ResultBody
  const top = photo
    ? <img src={photo.src} alt="" className="absolute left-0 top-0 block" style={{ width: T_CARD_W, height: photo.mode === 'alto' ? T_CARD_H : PHOTO_H }} />
    : hero || (eventImage && <img src={eventImage} alt="" className="absolute left-0 top-0 block" style={{ width: T_CARD_W, height: PHOTO_H }} />)
  return (
    <ShareFrame nodeRef={nodeRef} bg={photo ? photo.tone : color} top={top}
      label={data.label ?? data.kicker} date={data.date} org={org}>
      {children || <Body d={data} />}
    </ShareFrame>
  )
})

export default TournamentShareCard
