import { describe, it, expect } from 'vitest'
import { signUpBackLink, safeInternalPath } from './loginLinks'

const back = (link) => decodeURIComponent(new URLSearchParams(link.split('?').slice(1).join('?')).get('redirect'))
const BARRA = '/' + String.fromCharCode(92)

describe('signUpBackLink — quem chega do WhatsApp sem conta (#454)', () => {
  it('abre no separador de criar conta, nao no de entrar', () => {
    expect(signUpBackLink({ pathname: '/torneio/smash-cup' })).toContain('mode=signup')
  })

  it('traz a pessoa de volta a pagina do torneio', () => {
    expect(back(signUpBackLink({ pathname: '/torneio/smash-cup' }))).toBe('/torneio/smash-cup')
  })

  it('guarda a categoria que ela estava a ver, mesmo sem estar no endereco', () => {
    expect(back(signUpBackLink({ pathname: '/torneio/smash-cup', categoryCode: 'M3' }))).toBe('/torneio/smash-cup?cat=M3')
  })

  it('substitui a categoria do endereco pela que esta a ver', () => {
    expect(back(signUpBackLink({ pathname: '/torneio/smash-cup', search: '?cat=M1', categoryCode: 'F2' })))
      .toBe('/torneio/smash-cup?cat=F2')
  })

  it('nao perde o resto do endereco (ex.: o separador)', () => {
    expect(back(signUpBackLink({ pathname: '/torneio/smash-cup', search: '?tab=all_games', categoryCode: 'M3' })))
      .toBe('/torneio/smash-cup?tab=all_games&cat=M3')
  })

  it('o redirect vai codificado — o ?cat= nao se solta para o /login', () => {
    const link = signUpBackLink({ pathname: '/torneio/smash-cup', categoryCode: 'M3' })
    expect(new URLSearchParams(link.split('?')[1]).get('cat')).toBe(null)
  })

  it('serve tambem o convite de parceiro, que nao tem categoria', () => {
    expect(back(signUpBackLink({ pathname: '/convite-torneio/abc123' }))).toBe('/convite-torneio/abc123')
  })

  it('o que sai e sempre um caminho que a trava aceita', () => {
    const r = back(signUpBackLink({ pathname: '/torneio/smash-cup', categoryCode: 'M3' }))
    expect(safeInternalPath(r)).toBe(r)
  })
})

describe('safeInternalPath — a trava do ?redirect= (#378)', () => {
  it('deixa passar uma pagina da app', () => {
    expect(safeInternalPath('/torneio/smash-cup?cat=M3')).toBe('/torneio/smash-cup?cat=M3')
  })

  it('recusa um site de fora escrito como caminho', () => {
    expect(safeInternalPath('//exemplo-mau.pt')).toBe('/')
    expect(safeInternalPath(BARRA + 'exemplo-mau.pt')).toBe('/')
  })

  it('recusa um endereco completo', () => {
    expect(safeInternalPath('https://exemplo-mau.pt')).toBe('/')
  })

  it('recusa um caminho sem barra a frente', () => {
    expect(safeInternalPath('torneio/smash-cup')).toBe('/')
  })

  it('sem pedido nenhum, vai para a Home', () => {
    expect(safeInternalPath(null)).toBe('/')
    expect(safeInternalPath('')).toBe('/')
    expect(safeInternalPath(undefined)).toBe('/')
  })

  it('aceita outro destino de recurso quando quem chama o indica', () => {
    expect(safeInternalPath('//mau', '/entrar')).toBe('/entrar')
  })
})
