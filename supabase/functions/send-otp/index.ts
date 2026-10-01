// Supabase Edge Function: associa o número ao perfil e envia o código de
// verificação por SMS (Twilio) — OTP clássico (decisão Ruben, 1 out 2026),
// em vez do fluxo invertido do #537 (mandar o código ao robô).
//
// É a ÚNICA peça que vê o número cru neste fluxo (como a hash-phone): o
// número nunca é guardado — grava-se só o HMAC em profiles.phone_hash — e o
// código nunca passa pelo browser: é gerado pelo start_phone_verification
// (validade 15 min, limite 5/h — reutilizado tal-e-qual do #537) chamado
// AQUI com o JWT do utilizador, e segue direto no SMS.
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
  const twilioSid = Deno.env.get('TWILIO_ACCOUNT_SID')
  const twilioToken = Deno.env.get('TWILIO_AUTH_TOKEN')
  const twilioFrom = Deno.env.get('TWILIO_FROM')
  if (!secret || !twilioSid || !twilioToken || !twilioFrom) {
    console.error('send-otp misconfigured: faltam secrets', {
      PHONE_HASH_SECRET: !secret, TWILIO_ACCOUNT_SID: !twilioSid,
      TWILIO_AUTH_TOKEN: !twilioToken, TWILIO_FROM: !twilioFrom,
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
  const { error: updateError } = await supabase
    .from('profiles')
    .update({ phone_hash: hash })
    .eq('id', userData.user.id)
  if (updateError) {
    console.error('send-otp: falha a gravar phone_hash:', updateError)
    return jsonResponse({ error: 'profile_update_failed' }, 500)
  }

  const { data: ver, error: verError } = await supabase.rpc('start_phone_verification')
  if (verError) {
    // Ex.: o limite de 5/h — a mensagem do RPC é legível e vai para a app.
    console.error('send-otp: start_phone_verification falhou:', verError)
    return jsonResponse({ error: verError.message || 'verification_failed' }, 429)
  }
  const code = ver?.[0]?.code
  const expiresAt = ver?.[0]?.expires_at ?? null
  if (!code) {
    return jsonResponse({ error: 'verification_failed' }, 500)
  }

  // SMS via Twilio Messages API (form-encoded, Basic auth).
  const smsBody = `${code} é o teu código alinho. Expira em 15 minutos.`
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
