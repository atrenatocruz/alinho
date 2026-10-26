// Supabase Edge Function: dá ao Apple Watch uma sessão PRÓPRIA.
//
// PORQUÊ: o relógio precisa de falar com o Supabase sozinho, mas o refresh
// token do iPhone não pode ser partilhado — a rotação de refresh tokens faz
// cair a sessão de um dos dois assim que um deles renova. Por isso a app do
// iPhone chama esta função (com o JWT do utilizador) e reencaminha o
// resultado para o relógio: uma sessão nova tem o seu próprio refresh token
// e a do iPhone fica intacta.
//
// Como funciona: valida o JWT do pedido (getUser) → com o cliente de serviço
// gera um magic link (auth.admin.generateLink) SEM enviar email, só para
// obter o hashed_token → com o cliente anon troca-o por sessão
// (auth.verifyOtp type 'magiclink'). Devolve só
// {access_token, refresh_token, expires_at (segundos desde epoch), user_id}.
// Erros: 401 unauthorized · 422 no_email · 500 server_error. Nunca se
// registam nem se devolvem tokens ou mensagens internas.
//
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY são
// injetados pela plataforma — não é preciso configurar nada.
//
// Deploy (feito pelo Renato, projeto dev primeiro):
//   npx supabase functions deploy watch-session --project-ref <dev>
//
// Verificar à mão (JWT de uma conta de teste copiado da app em dev):
//   curl -X POST -H "Authorization: Bearer $JWT" -H "apikey: $ANON" \
//     https://<dev>.supabase.co/functions/v1/watch-session
//   -> 200 com refresh_token DIFERENTE do da app;
//   com uma conta sem email -> 422 {"error":"no_email"};
//   sem/com JWT inválido -> 401 {"error":"unauthorized"};
//   e a sessão da app continua válida (recarregar a página).

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'unauthorized' }, 401)
  }

  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Cliente com o JWT do utilizador: só serve para saber quem é.
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: userData, error: userError } = await userClient.auth.getUser()
    if (userError || !userData?.user) {
      return jsonResponse({ error: 'unauthorized' }, 401)
    }
    const user = userData.user
    if (!user.email) {
      return jsonResponse({ error: 'no_email' }, 422)
    }

    // Não envia email: só gera o hashed_token.
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: user.email,
    })
    const tokenHash = linkData?.properties?.hashed_token
    if (linkError || !tokenHash) {
      console.error('watch-session: generateLink falhou:', linkError?.message)
      return jsonResponse({ error: 'server_error' }, 500)
    }

    // Cliente anon limpo (sem JWT do utilizador) para criar a sessão nova.
    const anon = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: otpData, error: otpError } = await anon.auth.verifyOtp({
      token_hash: tokenHash,
      type: 'magiclink',
    })
    const session = otpData?.session
    if (otpError || !session) {
      console.error('watch-session: verifyOtp falhou:', otpError?.message)
      return jsonResponse({ error: 'server_error' }, 500)
    }

    return jsonResponse({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at,
      user_id: user.id,
    })
  } catch (err) {
    console.error('watch-session: erro inesperado:', err instanceof Error ? err.message : 'desconhecido')
    return jsonResponse({ error: 'server_error' }, 500)
  }
})
