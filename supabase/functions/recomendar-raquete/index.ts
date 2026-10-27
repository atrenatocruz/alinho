// Supabase Edge Function: recomenda 3 raquetes a quem respondeu ao questionário.
//
// PORQUÊ: «Escolhe a tua raquete» (docs/superpowers/specs/2026-10-27-escolher-raquete-design.md).
// A IA (Gemini Flash, plano gratuito) só escolhe de uma lista curta de raquetes
// reais, em stock e dentro do orçamento — o filtro é feito aqui, no código, e
// validatePicks recusa qualquer id que não esteja nessa lista.
//
// Pedido: POST {answers, lang: 'pt'|'en'|'es'} com o JWT do utilizador.
// Respostas: 200 {best_id, picks} (e grava em racket_picks) ·
//   401 unauthorized · 400 bad_answers · 503 catalog_empty (sem raquetes: o sync não correu) ·
//   422 no_candidates · 429 daily_limit ·
//   503 ai_unavailable (Gemini sem quota, em baixo ou lento) · 502 ai_failed
//   (duas respostas inválidas). Sempre {error: código}.
// O limite (3 por dia de Lisboa, take_racket_run) só se gasta quando há raquetes
// para recomendar, logo antes de chamar a IA.
//
// Ao Gemini nunca vão nome, email nem id do jogador. As respostas e o prompt nunca
// vão para os logs (há respostas sobre dores): nos erros, só o código.
//
// Secrets: GEMINI_API_KEY (Google AI Studio), GEMINI_MODEL (um ou mais modelos separados por
// vírgulas; por omissão gemini-flash-latest,gemini-flash-lite-latest). SUPABASE_URL, SUPABASE_ANON_KEY e
// SUPABASE_SERVICE_ROLE_KEY são injetados pela plataforma.
//
// Deploy (Renato, projeto dev primeiro):
//   npx supabase functions deploy recomendar-raquete --project-ref <dev>
// Verificar à mão: ver docs/raquete.md.

import { createClient } from 'jsr:@supabase/supabase-js@2.117.3'
import { BUDGETS, RESPONSE_SCHEMA, buildPrompt, shortlist, validatePicks } from '../_shared/raquetes.js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// As perguntas de src/lib/raquete.js (QUESTIONS). Só estas chaves passam para a IA.
const REQUIRED = ['frequency', 'style', 'strengths', 'struggle', 'pain', 'feel', 'center', 'wants', 'shape', 'budget']
const OPTIONAL = ['brands']
const LANGS = ['pt', 'en', 'es']

type Answers = Record<string, string | string[]>

// Respostas limpas, ou null se faltar alguma obrigatória.
function cleanAnswers(raw: unknown): Answers | null {
  if (!raw || typeof raw !== 'object') return null
  const a = raw as Record<string, unknown>
  const ok = (v: unknown) => (typeof v === 'string' && v.length <= 40)
    || (Array.isArray(v) && v.length <= 10 && v.every((x) => typeof x === 'string' && x.length <= 40))
  const out: Answers = {}
  for (const k of REQUIRED) {
    const v = a[k]
    if (!ok(v) || (Array.isArray(v) && !v.length)) return null
    out[k] = v as string | string[]
  }
  if (!(String(out.budget) in BUDGETS)) return null
  for (const k of OPTIONAL) if (ok(a[k])) out[k] = a[k] as string | string[]
  if (typeof a.current_racket === 'string' && a.current_racket.trim()) {
    out.current_racket = a.current_racket.trim().slice(0, 300)
  }
  return out
}

class AiUnavailable extends Error {}

// GEMINI_MODEL pode ter vários modelos separados por vírgulas: se um está
// sobrecarregado (503) ou sem quota (429), tenta o seguinte. No teste de 27 out o
// gemini-flash-latest do plano gratuito deu 503 «high demand» quatro vezes seguidas.
const DEFAULT_MODELS = 'gemini-flash-latest,gemini-flash-lite-latest'

async function askGemini(prompt: string): Promise<unknown> {
  const key = Deno.env.get('GEMINI_API_KEY')
  if (!key) throw new AiUnavailable('no key')
  const models = (Deno.env.get('GEMINI_MODEL') || DEFAULT_MODELS).split(',').map((m) => m.trim()).filter(Boolean)
  let last = 'no model'
  for (const model of models) {
    let res: Response
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA, temperature: 0.4 },
        }),
        signal: AbortSignal.timeout(25000),
      })
    } catch {
      last = `${model} timeout`
      continue
    }
    if (res.status === 429 || res.status >= 500) {
      last = `${model} ${res.status}`
      continue
    }
    if (!res.ok) throw new AiUnavailable(`${model} ${res.status}`)
    const body = await res.json()
    const text = body?.candidates?.[0]?.content?.parts?.[0]?.text
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  }
  throw new AiUnavailable(last)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return jsonResponse({ error: 'unauthorized' }, 401)

  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: userData, error: userError } = await userClient.auth.getUser()
    if (userError || !userData?.user) return jsonResponse({ error: 'unauthorized' }, 401)
    const userId = userData.user.id

    const body = await req.json().catch(() => null)
    const answers = cleanAnswers(body?.answers)
    if (!answers) return jsonResponse({ error: 'bad_answers' }, 400)
    const lang = LANGS.includes(body?.lang) ? body.lang : 'pt'

    const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const [{ data: prof }, { data: mems }, { data: rackets, error: rErr }] = await Promise.all([
      db.from('profiles').select('preferred_side, dominant_hand').eq('id', userId).maybeSingle(),
      db.from('memberships').select('level').eq('user_id', userId),
      db.from('rackets').select('store_id, name, brand, price, available, description, specs').eq('available', true),
    ])
    if (rErr) return jsonResponse({ error: 'server_error' }, 500)

    // Catálogo vazio (o sync ainda não correu, ou falhou): não é culpa do orçamento.
    if (!rackets?.length) {
      console.error('recomendar-raquete: catalog empty')
      return jsonResponse({ error: 'catalog_empty' }, 503)
    }
    const candidates = shortlist(rackets, answers)
    if (!candidates.length) return jsonResponse({ error: 'no_candidates' }, 422)

    const { data: allowed, error: runErr } = await db.rpc('take_racket_run', { p_user: userId })
    if (runErr) return jsonResponse({ error: 'server_error' }, 500)
    if (!allowed) return jsonResponse({ error: 'daily_limit' }, 429)

    const profile = {
      side: prof?.preferred_side ?? null,
      hand: prof?.dominant_hand ?? null,
      levels: [...new Set((mems ?? []).map((m: { level: string }) => m.level))],
    }
    const prompt = buildPrompt({ answers, profile, candidates, lang })
    const ids = candidates.map((r: { store_id: string }) => r.store_id)
    const descriptions = Object.fromEntries(
      candidates.map((r: { store_id: string; description: string | null }) => [r.store_id, r.description ?? '']),
    )
    const brands = Object.fromEntries(
      candidates.map((r: { store_id: string; brand: string | null }) => [r.store_id, r.brand ?? '']),
    )

    // Uma tentativa falhada não conta para o limite: só se gasta com resultado.
    const refund = () => db.rpc('refund_racket_run', { p_user: userId })
    let result
    try {
      result = validatePicks(await askGemini(prompt), ids, descriptions, brands)
      if (!result.ok) result = validatePicks(await askGemini(prompt), ids, descriptions, brands)
    } catch (e) {
      await refund()
      throw e
    }
    if (!result.ok) {
      await refund()
      console.error('recomendar-raquete: invalid AI answer', result.reason)
      return jsonResponse({ error: 'ai_failed' }, 502)
    }

    const { error: saveErr } = await db.from('racket_picks').upsert({
      user_id: userId, answers, lang, best_id: result.best, picks: result.picks, created_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    if (saveErr) return jsonResponse({ error: 'server_error' }, 500)

    return jsonResponse({ best_id: result.best, picks: result.picks })
  } catch (e) {
    if (e instanceof AiUnavailable) {
      console.error('recomendar-raquete: AI unavailable', e.message)
      return jsonResponse({ error: 'ai_unavailable' }, 503)
    }
    console.error('recomendar-raquete: server error')
    return jsonResponse({ error: 'server_error' }, 500)
  }
})
