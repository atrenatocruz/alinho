import { supabase } from './supabase'

/* «Escolhe a tua raquete» (docs/superpowers/specs/2026-10-27-escolher-raquete-design.md).
   As 11 perguntas, as regras das respostas, o pedido à Edge Function
   recomendar-raquete e o resultado guardado com o preço e o stock de hoje.
   Os rótulos vêm do i18n: raquete.q_<key> e raquete.opt_<key>_<opção>.
   As chaves têm de bater com REQUIRED/OPTIONAL em
   supabase/functions/recomendar-raquete/index.ts. */

export const QUESTIONS = [
  { key: 'frequency', multi: false, optional: false, options: ['menos1', '1_2', '3_4', '5mais'] },
  { key: 'style', multi: false, optional: false, options: ['defensivo', 'equilibrado', 'agressivo', 'tatico'] },
  { key: 'strengths', multi: true, optional: false, options: ['remates', 'voleios', 'bandejas', 'defesa', 'toque'] },
  { key: 'struggle', multi: false, optional: false, options: ['potencia', 'controlo', 'defender', 'centro', 'rede'] },
  { key: 'pain', multi: true, optional: false, exclusive: 'nao', options: ['nao', 'cotovelo', 'pulso', 'ombro', 'outra'] },
  { key: 'feel', multi: false, optional: false, options: ['leve', 'equilibrada', 'pesada', 'nao_sei'] },
  { key: 'center', multi: false, optional: false, options: ['quase_sempre', 'muitas_vezes', 'fora'] },
  { key: 'wants', multi: false, optional: false, options: ['controlo', 'equilibrio', 'potencia', 'conforto'] },
  { key: 'shape', multi: false, optional: false, options: ['redonda', 'lagrima', 'diamante', 'recomenda'] },
  { key: 'budget', multi: false, optional: false, options: ['lt80', '80_150', '150_220', '220_300', '300plus'] },
  { key: 'brands', multi: true, optional: true, text: true, options: ['bullpadel', 'nox', 'head', 'adidas', 'babolat', 'outra', 'sem_preferencia'] },
]

export function toggleAnswer(answers, question, option) {
  if (!question.multi) return { ...answers, [question.key]: option }
  const current = answers[question.key] ?? []
  let next
  if (current.includes(option)) next = current.filter((o) => o !== option)
  else if (question.exclusive && option === question.exclusive) next = [option]
  else next = [...current.filter((o) => o !== question.exclusive), option]
  return { ...answers, [question.key]: next }
}

export function isAnswered(answers, question) {
  if (question.optional) return true
  const v = answers[question.key]
  return question.multi ? Array.isArray(v) && v.length > 0 : Boolean(v)
}

// O código de erro do corpo da função (FunctionsHttpError traz a Response em `context`).
async function errorCode(error) {
  try {
    const body = await error?.context?.json?.()
    return body?.error ?? 'network'
  } catch {
    return 'network'
  }
}

// Nunca lança: { best_id, picks } ou { error: código }.
export async function requestPick(answers, lang) {
  try {
    const { data, error } = await supabase.functions.invoke('recomendar-raquete', {
      body: { answers, lang: String(lang ?? 'pt').slice(0, 2) },
    })
    if (error) return { error: await errorCode(error) }
    return data
  } catch {
    return { error: 'network' }
  }
}

// A minha última recomendação (a RLS só deixa ler a própria) e as raquetes dela.
export async function loadMyPick() {
  const { data: pick, error } = await supabase.from('racket_picks').select('best_id, picks, created_at').maybeSingle()
  if (error) throw error
  if (!pick) return null
  const ids = (pick.picks ?? []).map((p) => p.id)
  const { data: rackets, error: rErr } = await supabase
    .from('rackets')
    .select('store_id, name, brand, url, image_url, price, available, specs, description')
    .in('store_id', ids)
  if (rErr) throw rErr
  return { pick, rackets: rackets ?? [] }
}

// Preço, foto, stock e link de hoje; a melhor primeiro.
export function mergePickWithCatalog(pick, rackets) {
  const byId = new Map(rackets.map((r) => [r.store_id, r]))
  return (pick.picks ?? [])
    .map((p) => {
      const racket = byId.get(p.id) ?? null
      return { ...p, best: p.id === pick.best_id, racket, soldOut: !racket || !racket.available }
    })
    .sort((a, b) => Number(b.best) - Number(a.best))
}
