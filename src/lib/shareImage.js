import { withMyRef, refInText } from './myRef'
// A base para partilhar nas redes os jogos do torneio (pedido do Francisco,
// antes do Smash Cup; o aspeto dos cartões é do designer). Três peças, sem
// nada de fora da app:
//   · a foto de quem partilha, da galeria ou da câmara — fica só no
//     telemóvel, nunca sobe para a app;
//   · o QR com o link, gerado aqui (biblioteca qrcode, já usada no voucher);
//   · partilhar a imagem pelo telemóvel ou, sem isso, guardá-la.
import QRCode from 'qrcode'

/** A foto escolhida, pronta para pôr num cartão: lida no telemóvel,
 *  reduzida (até `maxSide` px) e devolvida como data URL — o html-to-image
 *  rasteriza data URLs sem problemas de CORS nem de URLs que expiram.
 *  Não sai do aparelho. */
export async function readLocalPhoto(file, { maxSide = 1600, quality = 0.9 } = {}) {
  if (!file || !/^image\//.test(file.type || '')) throw new Error('not_an_image')
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()
  return { dataUrl: canvas.toDataURL('image/jpeg', quality), width, height }
}

/** O QR do link, como imagem (data URL), gerado no próprio telemóvel. */
export function qrDataUrl(text, { size = 320, dark = '#0B0B0C', light = '#FFFFFF' } = {}) {
  return QRCode.toDataURL(text, { margin: 1, width: size, color: { dark, light }, errorCorrectionLevel: 'M' })
}

/** Partilhar a imagem pela folha de partilha do telemóvel; onde isso não
 *  existe (computador, alguns navegadores), guardá-la. Devolve 'shared',
 *  'cancelled' ou 'saved'. */
export async function shareOrSaveImage(blob, { filename = 'alinho.png', title = '', text = '' } = {}) {
  const file = new File([blob], filename, { type: blob.type || 'image/png' })
  if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text })
      return 'shared'
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled'
      // Alguns telemóveis recusam a partilha com ficheiro: guarda-se.
    }
  }
  return saveBlob(blob, filename)
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return 'saved'
}

/** Guardar no telemóvel a foto tirada na hora, sem o cartão (#742,
 *  Francisco 29 out). No iPhone só a folha de partilha chega às Fotos
 *  («Guardar imagem»); nos outros transfere-se e aparece na galeria.
 *  Devolve 'shared', 'cancelled' ou 'saved'. */
export async function saveOriginalPhoto(file, filename) {
  const nav = typeof navigator !== 'undefined' ? navigator : {}
  const ios = /iPad|iPhone|iPod/.test(nav.userAgent || '') || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)
  return ios ? shareOrSaveImage(file, { filename }) : saveBlob(file, filename)
}

/** O nome da foto: «alinho-clube-mix-de-quinta-foto.jpg». */
export function photoFilename(file, ...parts) {
  const ext = String(file?.type || '').split('/')[1]?.replace('jpeg', 'jpg') || 'jpg'
  return shareFilename(...parts, 'foto').replace(/\.png$/, `.${ext}`)
}

/** O nome do ficheiro: «alinho-smash-cup-m5-final.png». */
export function shareFilename(...parts) {
  const slug = parts.filter(Boolean).join('-').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `alinho-${slug || 'torneio'}.png`
}

/** Partilhar o link de uma página (o botão redondo do BackBar): a folha de
 *  partilha do telemóvel; sem ela, o WhatsApp com o nome e o link. */
/** Partilhar só um link (partilhar-link, 12 out): a partilha do telemóvel
 *  com a frase (que já leva o link); sem ela, copia o link e devolve
 *  'copied' para quem chama mostrar «✓ Link copiado». */
export async function shareLinkOrCopy({ title = '', text: rawText, url: rawUrl }) {
  // O ?ref= de quem partilha em todos os nossos links (origem da conta, 19 out).
  const url = withMyRef(rawUrl)
  const text = refInText(rawText)
  if (typeof navigator !== 'undefined' && navigator.share) {
    try { await navigator.share({ title, text }) } catch { /* fechou a folha */ }
    return 'shared'
  }
  try {
    await navigator.clipboard.writeText(url)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = url
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
  return 'copied'
}

export function sharePageLink({ title = '', text: rawText = '', url: rawUrl }) {
  const url = withMyRef(rawUrl)
  const text = refInText(rawText)
  if (typeof navigator !== 'undefined' && navigator.share) {
    navigator.share({ title, text: text || title, url }).catch(() => {})
    return
  }
  window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent([text || title, url].filter(Boolean).join(' '))}`, '_blank')
}
