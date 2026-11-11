// As contas do visualizador com aproximação (PosterViewer, #809). A imagem é
// desenhada ajustada ao ecrã (largura w, altura h, dentro de uma caixa W x H) e
// por cima leva translate(x, y) scale(s), com a origem no centro. Tudo em
// pixéis a partir do centro da caixa.

export const MIN_SCALE = 1
export const MAX_SCALE = 5
// O toque duplo aproxima para este fator (ou volta a 1, se já estiver perto).
export const DOUBLE_TAP_SCALE = 2.5
// Dois toques contam como duplo se vierem até 300 ms e 30 px um do outro.
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_PX = 30

export const clampScale = (s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))

/** Não deixa a imagem sair da caixa: aproximada, as bordas não passam para
    dentro; ao tamanho normal (ou mais pequena do que a caixa), fica ao centro. */
export function clampPan({ x, y, s }, { w, h, W, H }) {
  const maxX = Math.max(0, (w * s - W) / 2)
  const maxY = Math.max(0, (h * s - H) / 2)
  // `|| 0`: sem folga, Math.max(-0, …) dava -0.
  return { x: Math.min(maxX, Math.max(-maxX, x)) || 0, y: Math.min(maxY, Math.max(-maxY, y)) || 0, s }
}

/** Muda a escala para `next` com o ponto `p` (a partir do centro) parado
    debaixo do dedo, e acerta as bordas. */
export function zoomAt(view, next, p, box) {
  const s = clampScale(next)
  const k = s / view.s
  return clampPan({ x: p.x - (p.x - view.x) * k, y: p.y - (p.y - view.y) * k, s }, box)
}

/** O toque duplo: aproxima no ponto tocado; se já está aproximada, volta ao
    tamanho normal, centrada. */
export function doubleTap(view, p, box) {
  if (view.s > 1.05) return { x: 0, y: 0, s: 1 }
  return zoomAt(view, DOUBLE_TAP_SCALE, p, box)
}

export function isDoubleTap(prev, cur) {
  if (!prev) return false
  return cur.t - prev.t <= DOUBLE_TAP_MS && Math.hypot(cur.x - prev.x, cur.y - prev.y) <= DOUBLE_TAP_PX
}
