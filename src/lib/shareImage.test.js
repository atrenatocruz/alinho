import { afterEach, describe, expect, it, vi } from 'vitest'
import { photoFilename, qrDataUrl, saveOriginalPhoto, shareFilename, shareOrSaveImage } from './shareImage'

describe('shareImage', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('o QR é gerado na app, como imagem', async () => {
    const url = await qrDataUrl('https://alinho.pt/torneio/smash-cup-by-wfit')
    expect(url.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('o nome do ficheiro, sem acentos', () => {
    expect(shareFilename('Smash Cup by WFit', 'M5', 'Final')).toBe('alinho-smash-cup-by-wfit-m5-final.png')
    expect(shareFilename()).toBe('alinho-torneio.png')
  })

  it('partilha com ficheiro quando o telemóvel deixa', async () => {
    const share = vi.fn().mockResolvedValue()
    vi.stubGlobal('navigator', { canShare: () => true, share })
    const out = await shareOrSaveImage(new Blob(['x'], { type: 'image/png' }), { filename: 'a.png' })
    expect(out).toBe('shared')
    expect(share.mock.calls[0][0].files[0].name).toBe('a.png')
  })

  it('cancelar a partilha não guarda nada', async () => {
    vi.stubGlobal('navigator', { canShare: () => true, share: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'AbortError' })) })
    expect(await shareOrSaveImage(new Blob(['x']))).toBe('cancelled')
  })

  it('sem partilha, guarda a imagem', async () => {
    vi.stubGlobal('navigator', {})
    const a = { click: vi.fn(), remove: vi.fn() }
    vi.stubGlobal('document', { createElement: () => a, body: { appendChild: vi.fn() } })
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    expect(await shareOrSaveImage(new Blob(['x']), { filename: 'b.png' })).toBe('saved')
    expect(a.download).toBe('b.png')
    expect(a.click).toHaveBeenCalled()
  })

  it('a foto sem o cartão leva o nome do jogo e a extensão dela (#742)', () => {
    expect(photoFilename({ type: 'image/jpeg' }, 'Clube Exemplo', 'Mix de quinta')).toBe('alinho-clube-exemplo-mix-de-quinta-foto.jpg')
    expect(photoFilename({ type: 'image/png' })).toBe('alinho-foto.png')
  })

  it('no iPhone, a foto sem o cartão vai pela folha de partilha (Guardar imagem)', async () => {
    const share = vi.fn().mockResolvedValue()
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', canShare: () => true, share })
    expect(await saveOriginalPhoto(new Blob(['x'], { type: 'image/jpeg' }), 'f.jpg')).toBe('shared')
    expect(share.mock.calls[0][0].files[0].name).toBe('f.jpg')
  })

  it('no Android, a foto sem o cartão transfere-se logo, sem a folha de partilha', async () => {
    const share = vi.fn()
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 14)', canShare: () => true, share })
    const a = { click: vi.fn(), remove: vi.fn() }
    vi.stubGlobal('document', { createElement: () => a, body: { appendChild: vi.fn() } })
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    expect(await saveOriginalPhoto(new Blob(['x'], { type: 'image/jpeg' }), 'f.jpg')).toBe('saved')
    expect(share).not.toHaveBeenCalled()
    expect(a.download).toBe('f.jpg')
  })
})
