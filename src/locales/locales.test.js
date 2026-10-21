import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import pt from './pt.json'

/* Todas as línguas têm as mesmas frases (plano das línguas, passo 6:
   design-handoff/2026-10-18-linguas). Se este teste falhar, acrescenta a
   frase que falta no ficheiro dessa língua. O pt.json é a referência.

   Os plurais contam pela raiz: cada língua usa as formas que precisa
   (o português tem _zero, o espanhol _many), por isso «x_one»/«x_other»
   num ficheiro e «x_zero»/«x_one»/«x_other» noutro é a mesma frase. */
const PLURAL = /_(zero|one|two|few|many|other)$/
const roots = (dict) => new Set(Object.keys(dict).map((k) => k.replace(PLURAL, '')))
// As variáveis que a frase usa (uma vez cada: «{{count}} ronda a {{count}}» conta como uma).
const vars = (s) => [...new Set([...String(s).matchAll(/\{\{\s*([\w.]+)[^}]*\}\}/g)].map((m) => m[1]))].sort()

const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const others = fs.readdirSync(dir).filter((f) => /^[a-z]{2}\.json$/.test(f) && f !== 'pt.json')

describe('as línguas têm as mesmas frases', () => {
  const ptRoots = roots(pt)
  for (const file of others) {
    const other = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
    const otherRoots = roots(other)

    it(`${file}: não falta nenhuma frase do pt.json`, () => {
      expect([...ptRoots].filter((k) => !otherRoots.has(k))).toEqual([])
    })

    it(`${file}: não tem frases que o pt.json já não usa`, () => {
      expect([...otherRoots].filter((k) => !ptRoots.has(k))).toEqual([])
    })

    it(`${file}: cada frase leva as mesmas {{variáveis}} que no pt.json`, () => {
      const wrong = Object.keys(other)
        .filter((k) => k in pt && vars(pt[k]).join() !== vars(other[k]).join())
      expect(wrong).toEqual([])
    })
  }
})
