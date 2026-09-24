// A trave da regra dos separadores e filtros (Trello #528).
//
// Aprovado pelo Francisco a 24 set 2026: «Aprovado o separador. Mete em
// produção assim em todo lado. Certifica que fica assim e que toda a gente
// respeita a regra.» A regra está escrita no DESIGN.md; este teste é o que
// impede que se perca — um aviso lê-se e esquece-se, um teste vermelho não.
//
// O que falha:
//   1. a calha cinzenta ANTIGA (quadrada: `bg-ink-50` com folga pequena);
//   2. a calha do separador (cor #E7E9ED) desenhada fora de `ui.jsx`;
//   3. um `role="tablist"` fora de `ui.jsx` — quem faz um separador à mão
//      em vez de usar <Tabs>.
//
// Se este teste te falhou: usa <Tabs> (muda o que o ecrã mostra) ou <Chips>
// (filtro, ou escolha num formulário), de `src/components/ui.jsx`. Não copies
// as classes. A pergunta que decide: «mesma lista, só com menos coisas?»
// Sim → Chips. Não → Tabs.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const SRC = join(ROOT, 'src')
const UI = 'src/components/ui.jsx'

// Exceções conhecidas, cada uma com dono. Tira a linha quando estiver feita —
// o teste avisa se uma exceção deixar de ser precisa.
const EXCECOES = {
  oldTrack: {},
  tablist: {
    'src/pages/TournamentScorePage.jsx':
      'Dev 2 — os dias do marcador são filtro (o desenho já cumpre); o papel de separador está a mais',
  },
}

const files = (dir) => readdirSync(dir).flatMap((name) => {
  const p = join(dir, name)
  if (statSync(p).isDirectory()) return name === 'locales' ? [] : files(p)
  return /\.(jsx|js)$/.test(name) && !/\.test\.js$/.test(name) ? [p] : []
})

const rel = (p) => relative(ROOT, p).split(sep).join('/')
const SOURCES = files(SRC).map((p) => ({ path: rel(p), text: readFileSync(p, 'utf8') }))

// Todas as classes escritas num ficheiro: className="…" e className={`…`}.
const classLists = (text) => [...text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)]
  .map((m) => (m[1] ?? m[2]).split(/\s+/))

const SMALL_PAD = ['p-0.5', 'p-1', 'p-1.5', 'p-[2px]', 'p-[3px]']
const hasOldTrack = (text) => classLists(text)
  .some((cls) => cls.includes('bg-ink-50') && cls.some((c) => SMALL_PAD.includes(c)))

const offenders = (test, allowed) => SOURCES
  .filter((f) => f.path !== UI && !allowed[f.path] && test(f.text))
  .map((f) => f.path)

describe('separadores e filtros — uma forma só (#528)', () => {
  it('o separador e as pastilhas existem no sítio único', () => {
    const ui = SOURCES.find((f) => f.path === UI).text
    expect(ui).toMatch(/export function Tabs\(/)
    expect(ui).toMatch(/export function Chips\(/)
    expect(ui).toMatch(/#E7E9ED/i)
  })

  it('a calha cinzenta antiga (quadrada) não volta', () => {
    expect(offenders(hasOldTrack, EXCECOES.oldTrack)).toEqual([])
  })

  it('a calha do separador só se desenha em ui.jsx', () => {
    expect(offenders((t) => /#E7E9ED/i.test(t), {})).toEqual([])
  })

  it('não há separadores feitos à mão (role="tablist" fora de ui.jsx)', () => {
    expect(offenders((t) => /role="tablist"/.test(t), EXCECOES.tablist)).toEqual([])
  })

  it('cada exceção ainda é precisa — quando se corrige, tira-se daqui', () => {
    const stale = [
      ...Object.keys(EXCECOES.oldTrack).filter((p) => !hasOldTrack(SOURCES.find((f) => f.path === p)?.text || '')),
      ...Object.keys(EXCECOES.tablist).filter((p) => !/role="tablist"/.test(SOURCES.find((f) => f.path === p)?.text || '')),
    ]
    expect(stale).toEqual([])
  })
})
