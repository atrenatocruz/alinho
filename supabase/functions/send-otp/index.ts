// Supabase Edge Function: envia o código de verificação do número por SMS
// — OTP clássico (decisão Ruben, 1 out 2026), em vez do fluxo invertido do
// #537 (mandar o código ao robô). SEM estado «associado»: o perfil não é
// tocado aqui — o número só entra na conta na confirmação, quando a posse
// fica provada (migration_numero_numa_conta_so.sql).
//
// É a ÚNICA peça que vê o número cru neste fluxo (como a hash-phone): o
// que segue para a base de dados é só o HMAC, guardado na linha de
// phone_verifications pelo start_phone_verification_for_hash (validade 15
// min, limite 5/h, recusa números de outra conta real) chamado AQUI com o
// JWT do utilizador — o código nunca passa pelo browser e segue no SMS.
//
// Secrets necessários (por ambiente): PHONE_HASH_SECRET (o MESMO da
// hash-phone e do robô), TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
// TWILIO_FROM (número E.164 ou sender alfanumérico, ex. "Alinho").
// SUPABASE_URL/SUPABASE_ANON_KEY são injetados pela plataforma.

import { createClient } from 'jsr:@supabase/supabase-js@2'

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

function base64UrlDecode(input: string): string {
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4) base64 += '='
  return atob(base64)
}

function getJwtRole(authHeader: string | null): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice('Bearer '.length)
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1]))
    return typeof payload.role === 'string' ? payload.role : null
  } catch {
    return null
  }
}

// O MESMO esquema da hash-phone/robô — divergir partia o matching por
// número em silêncio: só dígitos, sem o "00" inicial, últimos 9.
function normalizePhone(raw: string): string {
  let digits = raw.replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  return digits.slice(-9)
}

// Para o SMS é preciso o número COMPLETO (E.164). Sem indicativo assume-se
// Portugal (+351) — a mesma suposição dos 9 dígitos do normalizePhone.
function toE164(raw: string): string {
  let digits = raw.replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.length === 9) digits = `351${digits}`
  return `+${digits}`
}

async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  // Só utilizadores com sessão — nunca o anon (mesma regra da hash-phone).
  const authHeader = req.headers.get('Authorization')
  if (getJwtRole(authHeader) !== 'authenticated') {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  let body: { phone?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const normalized = normalizePhone(body.phone || '')
  if (normalized.length < 9) {
    return jsonResponse({ error: 'invalid_phone' }, 400)
  }

  const secret = Deno.env.get('PHONE_HASH_SECRET')
  // Modo de teste (SÓ para ambientes sem utilizadores reais, ex. dev): com
  // OTP_DEV_MODE=true não se envia SMS nenhum — o código volta na resposta
  // e o cartão preenche-o sozinho. Devolver o código ao browser anula a
  // prova de posse do número, por isso isto NUNCA se liga em produção.
  const devMode = Deno.env.get('OTP_DEV_MODE') === 'true'
  // Fornecedor escolhido pelos secrets presentes: Vonage (trial com texto
  // livre — €2 de crédito, 5 números whitelisted) ou Twilio (produção).
  const vonageKey = Deno.env.get('VONAGE_API_KEY')
  const vonageSecret = Deno.env.get('VONAGE_API_SECRET')
  const vonageFrom = Deno.env.get('VONAGE_FROM') || 'Alinho'
  const useVonage = Boolean(vonageKey && vonageSecret)
  const twilioSid = Deno.env.get('TWILIO_ACCOUNT_SID')
  const twilioToken = Deno.env.get('TWILIO_AUTH_TOKEN')
  const twilioFrom = Deno.env.get('TWILIO_FROM')
  if (!secret || (!devMode && !useVonage && (!twilioSid || !twilioToken || !twilioFrom))) {
    console.error('send-otp misconfigured: faltam secrets', {
      PHONE_HASH_SECRET: !secret, OTP_DEV_MODE: devMode, VONAGE: useVonage,
      TWILIO_ACCOUNT_SID: !twilioSid, TWILIO_AUTH_TOKEN: !twilioToken, TWILIO_FROM: !twilioFrom,
    })
    return jsonResponse({ error: 'server_misconfigured' }, 500)
  }

  // Cliente COM O JWT do utilizador: o UPDATE do perfil passa pela RLS
  // (linha própria, coluna phone_hash com grant) e o start_phone_verification
  // corre com o auth.uid() dele — o rate-limit do #537 aplica-se tal-e-qual.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader! } } }
  )

  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData?.user) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  const hash = await hmacSha256Hex(normalized, secret)

  // Sem estado «associado» (Ruben, 1 out): o perfil NÃO é tocado aqui — o
  // número só entra na conta quando a posse fica provada (confirmação). O
  // RPC guarda o alvo na linha de verificação, aplica o rate-limit de 5/h
  // e recusa números já confirmados noutra conta real (phone_taken).
  const { data: ver, error: verError } = await supabase.rpc('start_phone_verification_for_hash', { p_hash: hash })
  if (verError) {
    console.error('send-otp: start_phone_verification_for_hash falhou:', verError)
    const message = verError.message || 'verification_failed'
    if (message.includes('phone_taken')) return jsonResponse({ error: 'phone_taken' }, 409)
    // Ex.: o limite de 5/h — a mensagem do RPC é legível e vai para a app.
    return jsonResponse({ error: message }, 429)
  }
  const code = ver?.[0]?.code
  const expiresAt = ver?.[0]?.expires_at ?? null
  if (!code) {
    return jsonResponse({ error: 'verification_failed' }, 500)
  }

  if (devMode) {
    console.warn(`send-otp em OTP_DEV_MODE: código devolvido na resposta (sem SMS) para ${userData.user.id}`)
    return jsonResponse({ ok: true, expires_at: expiresAt, dev_code: code })
  }

  const smsBody = `${code} é o teu código alinho. Expira em 15 minutos.`

  if (useVonage) {
    // Vonage SMS API (JSON; `to` em dígitos E.164 SEM o +). No trial o
    // destino tem de estar na lista de test numbers e a mensagem leva o
    // sufixo «[FREE SMS DEMO, TEST MESSAGE]» — cosmético.
    const vonageResponse = await fetch('https://rest.nexmo.com/sms/json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: vonageKey,
        api_secret: vonageSecret,
        from: vonageFrom,
        to: toE164(body.phone || '').slice(1),
        text: smsBody,
      }),
    })
    const result = await vonageResponse.json().catch(() => null)
    const status = result?.messages?.[0]?.status
    if (!vonageResponse.ok || status !== '0') {
      console.error('send-otp: Vonage falhou:', vonageResponse.status, JSON.stringify(result)?.slice(0, 300))
      return jsonResponse({ error: 'sms_failed' }, 502)
    }
    return jsonResponse({ ok: true, expires_at: expiresAt })
  }

  // SMS via Twilio Messages API (form-encoded, Basic auth).
  const twilioResponse = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${twilioSid}:${twilioToken}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: toE164(body.phone || ''), From: twilioFrom, Body: smsBody }),
    }
  )
  if (!twilioResponse.ok) {
    const detail = await twilioResponse.text().catch(() => '')
    console.error('send-otp: Twilio falhou:', twilioResponse.status, detail.slice(0, 300))
    return jsonResponse({ error: 'sms_failed' }, 502)
  }

  return jsonResponse({ ok: true, expires_at: expiresAt })
})
