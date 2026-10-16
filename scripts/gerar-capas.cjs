// Gera as capas do alinho para clubes e grupos (public/topo/capa-*.webp).
// Desenhadas em SVG e passadas a WebP com o sharp, 1200×480 (2,5:1): o
// centro aguenta os recortes da app (3:1 no Gerir, ~2,6:1 na página do
// clube) e o canto de baixo à esquerda fica calmo, que é onde entra o
// logótipo. Correr: node scripts/gerar-capas.cjs
const sharp = require('sharp')
const path = require('path')

const W = 1200
const H = 480
const OUT = path.join(__dirname, '..', 'public', 'topo')

const ball = (cx, cy, r, fill = '#C5DD01') => `
  <g>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>
    <path d="M${cx - r * 0.95},${cy - r * 0.3} C${cx - r * 0.35},${cy - r * 0.05} ${cx - r * 0.35},${cy + r * 0.55} ${cx - r * 0.7},${cy + r * 0.75}" fill="none" stroke="#fff" stroke-width="${r * 0.12}" stroke-linecap="round" opacity=".9"/>
    <path d="M${cx + r * 0.95},${cy + r * 0.3} C${cx + r * 0.35},${cy + r * 0.05} ${cx + r * 0.35},${cy - r * 0.55} ${cx + r * 0.7},${cy - r * 0.75}" fill="none" stroke="#fff" stroke-width="${r * 0.12}" stroke-linecap="round" opacity=".9"/>
  </g>`

const racket = (x, y, rot, fill, holes = '#00000033') => {
  let dots = ''
  for (let i = -2; i <= 2; i++) for (let j = -3; j <= 3; j++) {
    if ((i * i) / 7 + (j * j) / 12 < 1) dots += `<circle cx="${i * 18}" cy="${j * 18 - 10}" r="4.5" fill="${holes}"/>`
  }
  return `<g transform="translate(${x} ${y}) rotate(${rot})">
    <rect x="-13" y="70" width="26" height="110" rx="10" fill="${fill}"/>
    <ellipse cx="0" cy="-10" rx="68" ry="86" fill="${fill}"/>
    ${dots}
  </g>`
}

const covers = {
  // Noite de jogo: o campo visto de cima em perspetiva, dois focos acesos e a
  // bola a cruzar o céu.
  'capa-noite': `
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#070b14"/><stop offset="1" stop-color="#1F2937"/></linearGradient>
      <radialGradient id="flood" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff7d6" stop-opacity=".9"/><stop offset=".35" stop-color="#fff2b0" stop-opacity=".25"/><stop offset="1" stop-color="#fff2b0" stop-opacity="0"/></radialGradient>
      <linearGradient id="court" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#173a6b"/><stop offset="1" stop-color="#1f5aa6"/></linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#sky)"/>
    <circle cx="230" cy="40" r="260" fill="url(#flood)"/>
    <circle cx="980" cy="40" r="260" fill="url(#flood)"/>
    <rect x="224" y="40" width="12" height="110" fill="#0f172a"/><rect x="974" y="40" width="12" height="110" fill="#0f172a"/>
    <polygon points="330,250 870,250 1120,${H} 80,${H}" fill="url(#court)"/>
    <g stroke="#fff" stroke-opacity=".85" stroke-width="4" fill="none">
      <polygon points="330,250 870,250 1120,${H} 80,${H}"/>
      <line x1="270" y1="330" x2="930" y2="330"/>
      <line x1="600" y1="250" x2="600" y2="330"/>
      <line x1="600" y1="400" x2="600" y2="${H}"/>
      <line x1="180" y1="400" x2="1020" y2="400" stroke-width="7" stroke-opacity="1"/>
    </g>
    <path d="M360,300 Q620,40 860,200" fill="none" stroke="#C5DD01" stroke-width="4" stroke-dasharray="2 16" stroke-linecap="round" opacity=".8"/>
    ${ball(880, 214, 26)}`,

  // Rede: a malha em diagonal, a fita branca e a bola a passar rente.
  'capa-rede': (() => {
    let mesh = ''
    for (let x = -480; x < W + 480; x += 34) {
      mesh += `<line x1="${x}" y1="0" x2="${x + 330}" y2="330"/><line x1="${x + 330}" y1="0" x2="${x}" y2="330"/>`
    }
    return `
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f3d2a"/><stop offset="1" stop-color="#1c6b45"/></linearGradient>
      <clipPath id="netclip"><rect x="0" y="0" width="${W}" height="330"/></clipPath>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>
    <rect y="330" width="${W}" height="${H - 330}" fill="#2f6fb0"/>
    <line x1="0" y1="430" x2="${W}" y2="430" stroke="#fff" stroke-width="6" opacity=".9"/>
    <g clip-path="url(#netclip)" stroke="#fff" stroke-opacity=".22" stroke-width="2">${mesh}</g>
    <rect y="80" width="${W}" height="26" fill="#f5f5f0"/>
    <rect y="104" width="${W}" height="4" fill="#00000022"/>
    <rect x="0" y="80" width="18" height="${H - 80}" fill="#0b0f14"/><rect x="${W - 18}" y="80" width="18" height="${H - 80}" fill="#0b0f14"/>
    <ellipse cx="820" cy="392" rx="58" ry="12" fill="#00000040"/>
    ${ball(840, 52, 34)}
    <path d="M520,190 Q680,10 806,48" fill="none" stroke="#C5DD01" stroke-width="5" stroke-linecap="round" opacity=".55"/>`
  })(),

  // Vidro: as paredes de vidro do court, com reflexos, e o chão azul.
  'capa-vidro': (() => {
    let panels = ''
    for (let i = 0; i < 6; i++) {
      const x = i * 200
      panels += `<rect x="${x + 8}" y="40" width="184" height="300" fill="url(#glass)"/>
        <polygon points="${x + 40},40 ${x + 90},40 ${x + 30},340 ${x - 20},340" fill="#fff" opacity=".10"/>
        <polygon points="${x + 120},40 ${x + 135},40 ${x + 75},340 ${x + 60},340" fill="#fff" opacity=".08"/>`
    }
    return `
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0e2a3b"/><stop offset="1" stop-color="#14465f"/></linearGradient>
      <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7fd3e6" stop-opacity=".35"/><stop offset="1" stop-color="#2b8fb0" stop-opacity=".18"/></linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    ${panels}
    <g fill="#0a1a24">${[0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="${i * 200 - 4}" y="30" width="12" height="320"/>`).join('')}</g>
    <rect y="30" width="${W}" height="12" fill="#0a1a24"/>
    <rect y="340" width="${W}" height="${H - 340}" fill="#2563a8"/>
    <line x1="0" y1="372" x2="${W}" y2="372" stroke="#fff" stroke-width="5" opacity=".85"/>
    <ellipse cx="900" cy="350" rx="50" ry="9" fill="#00000035"/>
    ${ball(905, 250, 30)}
    <circle cx="905" cy="250" r="54" fill="none" stroke="#C5DD01" stroke-opacity=".35" stroke-width="3"/>`
  })(),

  // Poente: o jogo das sete da tarde — sol grande, céu quente e duas raquetes
  // em silhueta.
  'capa-poente': `
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b2a5a"/><stop offset=".55" stop-color="#d9487a"/><stop offset="1" stop-color="#ff9a52"/></linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#sky)"/>
    <circle cx="760" cy="330" r="150" fill="#ffd27a"/>
    <circle cx="760" cy="330" r="200" fill="#ffd27a" opacity=".18"/>
    <g fill="#ffd27a" opacity=".5">${[0, 1, 2, 3].map((i) => `<rect x="560" y="${300 + i * 28}" width="400" height="${8 - i}"/>`).join('')}</g>
    <rect y="380" width="${W}" height="${H - 380}" fill="#2a1d40"/>
    <g stroke="#2a1d40" stroke-width="4" opacity=".55">${Array.from({ length: 25 }, (_, i) => `<line x1="${i * 50}" y1="300" x2="${i * 50}" y2="380"/>`).join('')}<line x1="0" y1="300" x2="${W}" y2="300"/></g>
    ${racket(980, 250, 24, '#2a1d40', '#ffffff22')}
    ${racket(1090, 270, -18, '#3a2858', '#ffffff1f')}
    ${ball(930, 120, 20)}`,

  // Bola: a bola em grande, a sair pela direita, com as linhas do efeito.
  'capa-bola': `
    <rect width="${W}" height="${H}" fill="#0b1220"/>
    <g fill="#C5DD01" opacity=".14">${Array.from({ length: 12 }, (_, r) => Array.from({ length: 30 }, (_, c) => `<circle cx="${c * 42 + (r % 2) * 21}" cy="${r * 42}" r="3.5"/>`).join('')).join('')}</g>
    <g fill="none" stroke="#C5DD01" stroke-width="10" stroke-linecap="round">
      <path d="M200,330 Q460,150 700,180"/>
      <path d="M270,400 Q500,260 720,270" opacity=".6"/>
      <path d="M360,450 Q560,350 740,350" opacity=".3"/>
    </g>
    <circle cx="1000" cy="230" r="250" fill="#1F2937"/>
    <circle cx="1000" cy="230" r="250" fill="none" stroke="#C5DD01" stroke-width="10" opacity=".7"/>`,

  // Campo: o court visto de cima, inclinado, com a rede e uma bola no saque.
  'capa-campo': `
    <rect width="${W}" height="${H}" fill="#163a66"/>
    <g transform="translate(600 240) rotate(-14)">
      <rect x="-560" y="-210" width="1120" height="420" rx="10" fill="#2f6fb0"/>
      <g fill="none" stroke="#fff" stroke-width="7" stroke-opacity=".95">
        <rect x="-520" y="-180" width="1040" height="360"/>
        <line x1="-300" y1="-180" x2="-300" y2="180"/><line x1="300" y1="-180" x2="300" y2="180"/>
        <line x1="-300" y1="0" x2="300" y2="0"/>
      </g>
      <rect x="-6" y="-200" width="12" height="400" fill="#0b1220"/>
      <g stroke="#fff" stroke-opacity=".35" stroke-width="2">${Array.from({ length: 20 }, (_, i) => `<line x1="-6" y1="${-200 + i * 20}" x2="6" y2="${-190 + i * 20}"/>`).join('')}</g>
      <rect x="-560" y="-210" width="1120" height="420" rx="10" fill="none" stroke="#0b1220" stroke-width="14"/>
    </g>
    <ellipse cx="855" cy="330" rx="26" ry="7" fill="#00000040"/>
    ${ball(840, 300, 22)}`,
}

// O Alino de cada capa (bonecos 3D com fundo transparente, public/alino):
// pose, se vira, e onde fica. Como no topo do clube, o Alino grande à
// direita, cortado pelo peito, e o cenário desfocado por trás.
const ALINO = {
  'capa-noite': { pose: 'pronto', flip: false },
  'capa-rede': { pose: 'ola', flip: false },
  'capa-vidro': { pose: 'a-pensar', flip: false },
  'capa-poente': { pose: 'festa', flip: false },
  'capa-bola': { pose: 'ola', flip: true },
  'capa-campo': { pose: 'pronto', flip: true },
}
const OW = 900
const OH = 360

;(async () => {
  for (const [name, body] of Object.entries(covers)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`
    // O cenário: desfocado (profundidade de campo), como uma foto atrás do boneco.
    const scene = await sharp(Buffer.from(svg)).resize(OW, OH).blur(5).toBuffer()
    // À esquerda funde para o azul-noite dos topos do clube — é onde entra o logótipo.
    const fade = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${OW}" height="${OH}"><defs><linearGradient id="f" x1="0" x2="1"><stop offset="0" stop-color="#1F2937" stop-opacity=".97"/><stop offset=".32" stop-color="#1F2937" stop-opacity=".9"/><stop offset=".55" stop-color="#1F2937" stop-opacity=".25"/><stop offset=".7" stop-color="#1F2937" stop-opacity="0"/></linearGradient></defs><rect width="${OW}" height="${OH}" fill="url(#f)"/></svg>`)
    const { pose, flip } = ALINO[name]
    let alino = sharp(path.join(__dirname, '..', 'public', 'alino', `alino-${pose}.webp`)).resize({ height: 470, kernel: 'lanczos3' })
    if (flip) alino = alino.flop()
    // O sharp só sobrepõe o que cabe: corta o boneco pelo fundo da capa.
    const full = await alino.toBuffer()
    const fm = await sharp(full).metadata()
    const alinoBuf = await sharp(full).extract({ left: 0, top: 0, width: fm.width, height: Math.min(fm.height, OH - 34) }).toBuffer()
    const meta = await sharp(alinoBuf).metadata()
    // Sombra suave no chão por baixo do boneco.
    const shadow = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${OW}" height="${OH}"><ellipse cx="${OW - 160}" cy="${OH - 8}" rx="170" ry="26" fill="#000" opacity=".28"/></svg>`)
    const shadowBlur = await sharp(shadow).blur(12).toBuffer()
    const file = path.join(OUT, `${name}.webp`)
    await sharp(scene)
      .composite([
        { input: fade },
        { input: shadowBlur },
        { input: alinoBuf, left: Math.round(OW - meta.width - 40), top: 34 },
      ])
      .webp({ quality: 84 })
      .toFile(file)
    console.log('ok', file)
  }
})()
