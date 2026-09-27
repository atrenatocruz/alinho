// O alarme das rondas (design-handoff/2026-09-27-alarmes-das-rondas, aprovado
// pelo Francisco a 27 set). A técnica do teste que funcionou com o ecrã
// desligado (https://claude.ai/artifact/DMpVZ45Kh3L2pddac5YYyQ): uma faixa de
// áudio com a duração que falta da ronda — fundo em silêncio, o aviso antes do
// fim e o alarme no fim DENTRO da própria faixa. Para o telemóvel é música, e
// continua com o ecrã bloqueado.
//
// Peça partilhada: o mix (Bugs) e o jogo entre amigos a rodar (Dev 2) usam a
// mesma (components/RoundAlarm.jsx). Nos mixes vem LIGADO; no resto (jogo
// entre amigos) vem desligado (Francisco, 27 set: «Mete por defeito sempre
// ativo… Mixs principalmente no resto fica desativado» — muda o «desligado
// por omissão» do SPEC). Quem mexer no interruptor fica com a sua escolha,
// neste telemóvel (localStorage), em todos os jogos.

const PREFS_KEY = 'alinho.roundAlarm'
export const WARN_OPTIONS = [30, 60, 120]
const RATE = 8000 // 8 kHz, 8 bits, mono: 30 min ≈ 14 MB
export const ALARM_SECONDS = 6

/** `defaultOn`: como vem enquanto a pessoa não mexeu no interruptor. */
export function loadAlarmPrefs(defaultOn = false) {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')
    return { on: typeof v.on === 'boolean' ? v.on : defaultOn, warn: WARN_OPTIONS.includes(v.warn) ? v.warn : 60 }
  } catch {
    return { on: defaultOn, warn: 60 }
  }
}

export function saveAlarmPrefs(prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* sem armazenamento: vale só nesta visita */ }
}

/** As amostras da faixa (8 bits, 128 = silêncio): `total` s em silêncio, beeps
 *  de aviso a `warn` s do fim, e o alarme no fim. Sem I/O, para testar. */
export function buildRoundSamples(total, warn, rate = RATE) {
  const n = Math.ceil((total + ALARM_SECONDS) * rate)
  const data = new Uint8Array(n).fill(128)
  const warnAt = total - warn
  for (let i = 0; i < n; i++) {
    const t = i / rate
    let v = 0
    if (warn < total && t >= warnAt && t < warnAt + 1.2 && (t - warnAt) % 0.4 < 0.18) {
      v = 0.35 * Math.sin(2 * Math.PI * 880 * t)
    }
    if (t >= total) {
      const k = (t - total) % 0.5
      if (k < 0.3) v = 0.8 * Math.sin(2 * Math.PI * (k < 0.15 ? 1200 : 900) * t)
    }
    if (v) data[i] = Math.max(0, Math.min(255, Math.round(128 + v * 127)))
  }
  return data
}

function wavBlob(samples, rate = RATE) {
  const header = new ArrayBuffer(44)
  const dv = new DataView(header)
  const str = (o, x) => { for (let j = 0; j < x.length; j++) dv.setUint8(o + j, x.charCodeAt(j)) }
  str(0, 'RIFF'); dv.setUint32(4, 36 + samples.length, true); str(8, 'WAVE'); str(12, 'fmt ')
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true)
  dv.setUint32(24, rate, true); dv.setUint32(28, rate, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true)
  str(36, 'data'); dv.setUint32(40, samples.length, true)
  return new Blob([header, samples], { type: 'audio/wav' })
}

// Um só leitor para a app toda: uma vez desbloqueado por um toque, o
// telemóvel deixa-o tocar a faixa seguinte sem outro toque.
let audio = null
let currentUrl = null
let currentKey = null

function getAudio() {
  if (!audio) {
    audio = new Audio()
    audio.preload = 'auto'
    audio.setAttribute('playsinline', '')
  }
  return audio
}

/** Chamar num toque (o de quem organiza, que começa a ronda): desbloqueia o
 *  leitor para a faixa da ronda arrancar sozinha quando a ronda começar. */
export function unlockRoundAlarm() {
  if (typeof Audio === 'undefined') return
  const a = getAudio()
  if (currentKey && !a.paused) return
  if (currentUrl) URL.revokeObjectURL(currentUrl)
  currentUrl = URL.createObjectURL(wavBlob(new Uint8Array(800).fill(128)))
  a.src = currentUrl
  a.play().catch(() => {})
}

/** A ronda cuja faixa está a tocar neste telemóvel (ou null). */
export const playingRoundKey = () => (currentKey && audio && !audio.paused ? currentKey : null)

/** Põe a tocar a faixa da ronda `key`, com o tempo que falta até `endsAt`.
 *  Lança se o telemóvel recusar (falta um toque). */
export async function playRoundTrack({ key, endsAt, warn, title, subtitle }) {
  const remaining = (endsAt - Date.now()) / 1000
  if (remaining <= 1) return false
  const a = getAudio()
  const url = URL.createObjectURL(wavBlob(buildRoundSamples(remaining, warn)))
  const old = currentUrl
  currentUrl = url
  currentKey = key
  a.src = url
  if (typeof navigator !== 'undefined' && 'mediaSession' in navigator && typeof MediaMetadata !== 'undefined') {
    navigator.mediaSession.metadata = new MediaMetadata({ title, artist: subtitle })
  }
  try {
    await a.play()
  } catch (err) {
    currentKey = null
    throw err
  } finally {
    if (old && old !== url) URL.revokeObjectURL(old)
  }
  return true
}

/** Cala o alarme (recomeçar, ronda terminada antes do tempo, mix terminado, desligar). */
export function stopRoundTrack() {
  currentKey = null
  if (!audio) return
  audio.pause()
  audio.removeAttribute('src')
  audio.load()
  if (currentUrl) { URL.revokeObjectURL(currentUrl); currentUrl = null }
}
