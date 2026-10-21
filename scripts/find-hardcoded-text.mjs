// Encontra texto escrito direto nos ecrãs (fora do pt.json/en.json).
// Uso: node scripts/find-hardcoded-text.mjs [pasta|ficheiro ...] [--list]
// Sem argumentos olha para src/. Conta texto JSX, atributos de texto
// (placeholder, title, aria-label, alt, label) e frases em strings de JS
// que não são chaves de t(). Os comentários não contam.
import fs from 'node:fs'
import path from 'node:path'
import { parse } from '@babel/parser'
import traverseMod from '@babel/traverse'

const traverse = traverseMod.default || traverseMod
const args = process.argv.slice(2)
const list = args.includes('--list')
const roots = args.filter((a) => !a.startsWith('--'))
if (!roots.length) roots.push('src')

const TEXT_ATTRS = new Set(['placeholder', 'title', 'aria-label', 'alt', 'label', 'subtitle', 'hint', 'description', 'emptyText', 'confirmLabel', 'cancelLabel'])
const SKIP_ATTRS = new Set(['className', 'to', 'href', 'src', 'type', 'name', 'id', 'key', 'role', 'inputMode', 'autoComplete', 'pattern', 'style', 'd', 'viewBox', 'fill', 'stroke', 'pose', 'kind', 'variant', 'size', 'tone', 'icon', 'rel', 'target', 'method', 'accept', 'lang', 'dir', 'enterKeyHint', 'colorClass', 'surface', 'tierKey'])
const ACC = /[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ«»]/
const WORDS = /\b(a|e|de|do|da|dos|das|o|os|as|um|uma|para|com|não|no|na|nos|nas|que|em|se|ao|à|já|mais|por|teu|tua|teus|tuas|é|está|são|foi|ainda|sem|até|quando|como|aqui|isto|esse|essa)\b/i
const CSSISH = /(^|\s)(-?[a-z]+-[\w[\]#.%/:-]+|flex|grid|hidden|block|inline|relative|absolute|fixed|sticky|truncate|uppercase|italic)(\s|$)/

function phrase(s) {
  const v = s.replace(/\s+/g, ' ').trim()
  if (v.length < 2 || !/[A-Za-zÀ-ÿ]{2}/.test(v)) return false
  if (/^(https?:|mailto:|tel:|\/|#|\.|data:|rgb|var\(|calc\()/.test(v)) return false
  if (/^[\w.-]+$/.test(v) && !ACC.test(v) && !/^[A-Z][a-z]{2,}$/.test(v)) return false // ids, chaves, nomes de campos
  if (CSSISH.test(v) && !ACC.test(v)) return false
  if (/^[a-z0-9_.]+(\.[a-z0-9_]+)+$/.test(v)) return false // chave i18n
  return ACC.test(v) || (v.includes(' ') && WORDS.test(v)) || /^[A-ZÁÉÍÓÚ][a-zà-ÿ]{2,}$/.test(v)
}

function isTCall(p) {
  const c = p.parentPath
  if (!c || !c.isCallExpression()) return false
  const callee = c.node.callee
  const name = callee.type === 'Identifier' ? callee.name : callee.type === 'MemberExpression' ? callee.property.name : ''
  return ['t', 'tt', 'i18nT', 'exists'].includes(name)
}

function skipString(p) {
  // dentro de t(...), import, console, require, chaves de objetos, comparações
  if (isTCall(p)) return true
  let q = p
  for (let i = 0; i < 6 && q; i++, q = q.parentPath) {
    if (q.isImportDeclaration() || q.isExportNamedDeclaration() && q.node.source) return true
    if (q.isCallExpression()) {
      const cal = q.node.callee
      const obj = cal.type === 'MemberExpression' ? cal.object : null
      const nm = cal.type === 'Identifier' ? cal.name : cal.type === 'MemberExpression' ? cal.property.name : ''
      if (obj && obj.type === 'Identifier' && ['console', 'supabase', 'localStorage', 'sessionStorage', 'document', 'Object'].includes(obj.name)) return true
      if (['require', 'rpc', 'from', 'select', 'eq', 'channel', 'navigate', 'querySelector', 'addEventListener', 'setItem', 'getItem', 'includes', 'startsWith', 'endsWith', 'test', 'match', 'replace', 'split', 'useFeatureFlag', 'toLocaleDateString', 'toLocaleTimeString', 'Intl'].includes(nm)) return true
    }
    if (q.isJSXAttribute()) return SKIP_ATTRS.has(q.node.name.name) || !TEXT_ATTRS.has(q.node.name.name) && !q.findParent(() => false) && false
    if (q.isBinaryExpression() && ['===', '!==', '==', '!='].includes(q.node.operator)) return true
    if (q.isSwitchCase()) return true
  }
  const par = p.parentPath
  if (par.isObjectProperty() && par.node.key === p.node) return true
  if (par.isMemberExpression() && par.node.property === p.node) return true
  return false
}

const files = []
function walk(f) {
  const st = fs.statSync(f)
  if (st.isDirectory()) { for (const x of fs.readdirSync(f)) walk(path.join(f, x)) }
  else if (/\.jsx?$/.test(f) && !/\.test\.|devMock|locales/.test(f)) files.push(f)
}
roots.forEach(walk)

let total = 0
const per = []
for (const f of files) {
  const code = fs.readFileSync(f, 'utf8')
  let ast
  try { ast = parse(code, { sourceType: 'module', plugins: ['jsx'] }) } catch (e) { console.error('não li', f, e.message); continue }
  const hits = []
  traverse(ast, {
    JSXText(p) { if (phrase(p.node.value)) hits.push([p.node.loc.start.line, p.node.value.replace(/\s+/g, ' ').trim()]) },
    JSXAttribute(p) {
      const v = p.node.value
      if (v && v.type === 'StringLiteral' && TEXT_ATTRS.has(p.node.name.name) && phrase(v.value)) hits.push([v.loc.start.line, v.value])
    },
    StringLiteral(p) {
      if (p.parentPath.isJSXAttribute()) return
      if (skipString(p)) return
      if (phrase(p.node.value)) hits.push([p.node.loc.start.line, p.node.value])
    },
    TemplateLiteral(p) {
      if (skipString(p)) return
      const txt = p.node.quasis.map((q) => q.value.cooked).join('…')
      if (ACC.test(txt) && phrase(txt.replace(/…/g, ' '))) hits.push([p.node.loc.start.line, txt])
    },
  })
  if (hits.length) { per.push([f.replace(/\\/g, '/'), hits]); total += hits.length }
}
per.sort((a, b) => b[1].length - a[1].length)
for (const [f, h] of per) {
  console.log(String(h.length).padStart(4), f)
  if (list) for (const [l, s] of h) console.log('      ', l, '|', s.slice(0, 110))
}
console.log('TOTAL', total, 'frases em', per.length, 'ficheiros')
