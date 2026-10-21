// Supabase Edge Function: os avisos do sino como notificações push nas apps
// das lojas. Desenho: docs/superpowers/specs/2026-10-20-push-notifications-design.md
//
// Quem chama: um Database Webhook (Supabase → Database → Webhooks) no INSERT
// da tabela notifications, com o cabeçalho x-push-secret. Não é chamada pela
// app nem pelo browser — sem o segredo, recusa.
//
// O que faz: lê os telemóveis da pessoa (push_devices, migration_push_dispositivos.sql),
// escreve o texto do aviso na língua do perfil e manda-o:
//   · Android → Firebase Cloud Messaging (API v1, conta de serviço)
//   · iPhone  → APNs da Apple (chave .p8)
// Um token que a Google ou a Apple dizem que já não existe é apagado.
// Falhar aqui nunca parte nada: o aviso continua no sino.
//
// Segredos (Supabase → Edge Functions → Secrets):
//   PUSH_WEBHOOK_SECRET   obrigatório (o mesmo do cabeçalho do webhook)
//   FCM_SERVICE_ACCOUNT   JSON da conta de serviço do Firebase (Android)
//   APNS_KEY_ID           Key ID da chave APNs (iPhone)
//   APNS_TEAM_ID          Team ID da conta Apple Developer
//   APNS_PRIVATE_KEY      conteúdo do .p8 (com as linhas BEGIN/END)
//   APNS_BUNDLE_ID        default: pt.alinho.app
//   APNS_HOST             default: api.push.apple.com (TestFlight e App Store)
//
// Deploy: sem verificação de JWT (o webhook traz o segredo, não um JWT):
//   npx supabase functions deploy send-push --no-verify-jwt --project-ref <ref>

import { createClient } from 'jsr:@supabase/supabase-js@2'

type Notice = {
  id: string
  user_id: string
  kind: string
  game_id?: string | null
  lesson_id?: string | null
  actor_id?: string | null
  actor_hidden?: boolean | null
  read_at?: string | null
  data?: Record<string, unknown> | null
}

type Lang = 'pt' | 'en'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// ─── O texto ────────────────────────────────────────────────────────────────
// Os mesmos textos do sino (src/locales/*.json, layout.mix_*). Os outros tipos
// (aulas, torneios, amigos, liga) levam um texto geral e abrem a página certa.

const MIX: Record<string, { pt: string; en: string }> = {
  mix_finished: { pt: '🏆 {title} terminou. Ganharam {winners}.', en: '🏆 {title} is over. Won by {winners}.' },
  mix_finished_one: { pt: '🏆 {title} terminou. Ganhou {winners}.', en: '🏆 {title} is over. Won by {winners}.' },
  mix_finished_plain: { pt: '🏆 {title} terminou.', en: '🏆 {title} is over.' },
  joined: { pt: 'Entraste no {title} ({when}).', en: "You're in {title} ({when})." },
  added_by: { pt: '{actor} inscreveu-te no {title} ({when}).', en: '{actor} signed you up for {title} ({when}).' },
  added_by_organizer: { pt: 'Quem organiza inscreveu-te no {title} ({when}).', en: 'The organiser signed you up for {title} ({when}).' },
  removed: { pt: 'Saíste do {title} ({when}).', en: "You're out of {title} ({when})." },
  removed_by: { pt: 'Quem organiza tirou-te do {title} ({when}). Já não estás na lista.', en: 'The organizer took you out of {title} ({when}). You are no longer on the list.' },
  partner_changed: { pt: 'A tua dupla mudou no {title} ({when}).', en: 'Your pair changed in {title} ({when}).' },
  partner: { pt: 'Jogas com {partner}.', en: 'You play with {partner}.' },
  no_partner: { pt: 'Ainda estás sem par.', en: "You don't have a partner yet." },
  mix_unpublished: { pt: 'O {title} ({when}) foi retirado por quem organiza.', en: '{title} ({when}) was withdrawn by the organizer.' },
  mix_not_finished: { pt: 'O {title} ainda não está terminado. Marca o que falta e fecha.', en: "{title} isn't finished yet. Enter what's missing and close it." },
  mix_cancelled: { pt: 'O {title} ({when}) foi cancelado. Não se joga.', en: "{title} ({when}) was cancelled. It won't be played." },
  mix_changed: { pt: 'O {title} ({when}) mudou. Toca para ver.', en: '{title} ({when}) changed. Tap to see.' },
  mix_promoted: { pt: 'Entraste no {title} ({when}): abriu uma vaga e deixaste de ser suplente.', en: "You're in {title} ({when}): a spot opened and you're off the waitlist." },
  mix_moved_to_waitlist: { pt: 'O {title} ({when}) ficou com menos campos e passaste a suplente. Se alguém sair, entras.', en: "{title} ({when}) now has fewer courts and you're on the waitlist. If someone leaves, you're in." },
  mix_not_filled: { pt: 'O {title} não encheu e voltou a rascunho. Tira campos para jogar com quem há, ou cancela.', en: "{title} didn't fill and is a draft again. Remove courts to play with who's there, or cancel." },
  mix_cancelled_not_filled: { pt: 'O {title} ({when}) foi cancelado porque não encheu.', en: "{title} ({when}) was cancelled because it didn't fill." },
  mix_slot_open: { pt: 'Saiu alguém do {title} ({when}) e não havia suplentes: falta 1 numa dupla. Troca-o para começar.', en: "Someone left {title} ({when}) and there was no waitlist: a pair is 1 short. Swap someone in to start." },
  mix_swapped_out: { pt: 'Quem organiza pôs outra pessoa no teu lugar no {title} ({when}). Já não estás na lista.', en: 'The organizer put someone else in your spot in {title} ({when}). You are no longer on the list.' },
  mix_join_request: { pt: '{name} pediu para entrar no {title}.', en: '{name} asked to join {title}.' },
  mix_request_accepted: { pt: 'Entraste no {title} ({when}): quem organiza aceitou o teu pedido.', en: "You're in {title} ({when}): the organizer accepted your request." },
  mix_request_accepted_waitlist: { pt: 'Quem organiza aceitou o teu pedido para o {title} ({when}). O mix está cheio: ficas suplente e, se alguém sair, entras.', en: "The organizer accepted your request for {title} ({when}). The mix is full: you're on the waitlist and get in if someone leaves." },
  mix_request_declined: { pt: 'O teu pedido para o {title} ({when}) não foi aceite.', en: "Your request for {title} ({when}) wasn't accepted." },
}

const GENERIC = { pt: 'Tens um aviso novo. Toca para ver.', en: 'You have a new notice. Tap to see.' }

const fill = (s: string, vars: Record<string, string>) =>
  s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '').replace(/\s\(\)/g, '')

function formatWhen(iso: unknown, lang: Lang): string {
  if (typeof iso !== 'string' || !iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(lang === 'en' ? 'en-GB' : 'pt-PT', {
    timeZone: 'Europe/Lisbon', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

/** O texto do aviso (como no sino) ou null quando não há push a mandar. */
export function noticeBody(n: Notice, lang: Lang): string {
  const d = (n.data || {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  if (!n.kind.startsWith('mix_')) return GENERIC[lang]
  const vars = {
    title: str(d.game_title) || str(d.title) || (lang === 'en' ? 'the mix' : 'mix'),
    when: formatWhen(d.game_date || d.date, lang),
    partner: str(d.partner_name),
    name: str(d.requester_name),
    actor: str(d.actor_name),
    winners: str(d.winners).replace(/\.+$/, ''),
  }
  const t = (key: string) => fill(MIX[key][lang], vars)
  const actorId = (d.actor_id as string | undefined) ?? n.actor_id
  const byOther = !!n.actor_hidden || (!!actorId && actorId !== n.user_id)
  switch (n.kind) {
    case 'mix_request_accepted': return t(d.status === 'waitlisted' ? 'mix_request_accepted_waitlist' : 'mix_request_accepted')
    case 'mix_removed': return t(vars.actor || byOther ? 'removed_by' : 'removed')
    case 'mix_finished': {
      if (!vars.winners) return t('mix_finished_plain')
      return t(/\s\/\s|\se\s|\sand\s|,/.test(vars.winners) ? 'mix_finished' : 'mix_finished_one')
    }
    case 'mix_joined':
    case 'mix_partner_changed': {
      const partnerLine = vars.partner ? t('partner') : t('no_partner')
      const head = n.kind === 'mix_partner_changed' ? 'partner_changed'
        : vars.actor ? 'added_by' : byOther ? 'added_by_organizer' : 'joined'
      return `${t(head)} ${partnerLine}`
    }
    default:
      return MIX[n.kind] ? t(n.kind) : GENERIC[lang]
  }
}

/** A página que o toque abre — a mesma do sino. */
export function noticePath(n: Notice): string {
  const d = (n.data || {}) as Record<string, unknown>
  const s = (v: unknown) => (typeof v === 'string' && /^[\w-]+$/.test(v) ? v : '')
  if (n.kind.startsWith('friend_') && s(d.match_id)) return `/jogos-privados/sessao/${s(d.match_id)}`
  if (n.kind.startsWith('tournament_') && n.kind !== 'tournament_unpublished' && (s(d.tournament_slug) || s(d.tournament_id))) {
    return `/torneio/${s(d.tournament_slug) || s(d.tournament_id)}`
  }
  if (n.kind.startsWith('league_') && s(d.league_slug)) {
    return s(d.encounter_id) ? `/liga/${s(d.league_slug)}/encontro/${s(d.encounter_id)}` : `/liga/${s(d.league_slug)}`
  }
  if (n.kind.startsWith('lesson_')) return n.lesson_id && s(n.lesson_id) ? `/aula/${n.lesson_id}` : '/perfil/aulas'
  if (n.game_id && s(n.game_id)) return `/jogo/${n.game_id}`
  return '/'
}

// ─── Assinaturas (JWT) ──────────────────────────────────────────────────────

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64urlText = (s: string) => b64url(new TextEncoder().encode(s))

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\\n/g, '').replace(/\s+/g, '')
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer
}

async function signJwt(header: object, payload: object, pem: string, alg: 'RS256' | 'ES256'): Promise<string> {
  const key = await crypto.subtle.importKey(
    'pkcs8', pemToDer(pem),
    alg === 'RS256' ? { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } : { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign'],
  )
  const input = `${b64urlText(JSON.stringify(header))}.${b64urlText(JSON.stringify(payload))}`
  const sig = await crypto.subtle.sign(
    alg === 'RS256' ? 'RSASSA-PKCS1-v1_5' : { name: 'ECDSA', hash: 'SHA-256' },
    key, new TextEncoder().encode(input),
  )
  return `${input}.${b64url(new Uint8Array(sig))}`
}

// ─── Android: Firebase Cloud Messaging ─────────────────────────────────────

let googleToken: { value: string; exp: number } | null = null

async function googleAccessToken(sa: { client_email: string; private_key: string; token_uri?: string }) {
  const now = Math.floor(Date.now() / 1000)
  if (googleToken && googleToken.exp - 60 > now) return googleToken.value
  const aud = sa.token_uri || 'https://oauth2.googleapis.com/token'
  const assertion = await signJwt({ alg: 'RS256', typ: 'JWT' }, {
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud, iat: now, exp: now + 3600,
  }, sa.private_key, 'RS256')
  const res = await fetch(aud, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  })
  if (!res.ok) throw new Error(`google token ${res.status}: ${await res.text()}`)
  const body = await res.json()
  googleToken = { value: body.access_token, exp: now + (body.expires_in || 3600) }
  return googleToken.value
}

/** true = enviado; false = o token já não existe (apagar); lança nos outros erros. */
async function sendFcm(token: string, title: string, body: string, data: Record<string, string>): Promise<boolean> {
  const sa = JSON.parse(Deno.env.get('FCM_SERVICE_ACCOUNT') || 'null')
  if (!sa) throw new Error('FCM_SERVICE_ACCOUNT not set')
  const access = await googleAccessToken(sa)
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { token, notification: { title, body }, data, android: { priority: 'HIGH' } } }),
  })
  if (res.ok) return true
  const text = await res.text()
  if (res.status === 404 || (res.status === 400 && /UNREGISTERED|registration token is not a valid/i.test(text))) return false
  throw new Error(`fcm ${res.status}: ${text}`)
}

// ─── iPhone: APNs ───────────────────────────────────────────────────────────

let apnsJwt: { value: string; iat: number } | null = null

async function apnsToken() {
  const now = Math.floor(Date.now() / 1000)
  // A Apple aceita o mesmo token até 1 h; renova-se aos 40 min.
  if (apnsJwt && now - apnsJwt.iat < 40 * 60) return apnsJwt.value
  const kid = Deno.env.get('APNS_KEY_ID'), iss = Deno.env.get('APNS_TEAM_ID'), pem = Deno.env.get('APNS_PRIVATE_KEY')
  if (!kid || !iss || !pem) throw new Error('APNS_KEY_ID / APNS_TEAM_ID / APNS_PRIVATE_KEY not set')
  apnsJwt = { value: await signJwt({ alg: 'ES256', kid }, { iss, iat: now }, pem, 'ES256'), iat: now }
  return apnsJwt.value
}

async function sendApns(token: string, title: string, body: string, data: Record<string, string>): Promise<boolean> {
  const host = Deno.env.get('APNS_HOST') || 'api.push.apple.com'
  const res = await fetch(`https://${host}/3/device/${token}`, {
    method: 'POST',
    headers: {
      authorization: `bearer ${await apnsToken()}`,
      'apns-topic': Deno.env.get('APNS_BUNDLE_ID') || 'pt.alinho.app',
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ aps: { alert: { title, body }, sound: 'default' }, ...data }),
  })
  if (res.ok) return true
  const text = await res.text()
  if (res.status === 410 || /BadDeviceToken|Unregistered|DeviceTokenNotForTopic/.test(text)) return false
  throw new Error(`apns ${res.status}: ${text}`)
}

// ─── Entrada ────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const secret = Deno.env.get('PUSH_WEBHOOK_SECRET')
  if (!secret || req.headers.get('x-push-secret') !== secret) return json({ error: 'forbidden' }, 403)

  let payload: { type?: string; table?: string; record?: Notice }
  try { payload = await req.json() } catch { return json({ error: 'bad json' }, 400) }
  const n = payload.record
  if (payload.type !== 'INSERT' || payload.table !== 'notifications' || !n?.user_id || !n.kind) return json({ skipped: 'not a new notice' })
  if (n.read_at) return json({ skipped: 'already read' })
  // O que a própria pessoa fez na app não precisa de push.
  const actorId = (n.data as Record<string, unknown> | null)?.actor_id ?? n.actor_id
  if (actorId && actorId === n.user_id && !n.actor_hidden) return json({ skipped: 'own action' })

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const [{ data: devices, error }, { data: profile }] = await Promise.all([
    db.from('push_devices').select('token, platform').eq('user_id', n.user_id),
    db.from('profiles').select('language').eq('id', n.user_id).maybeSingle(),
  ])
  if (error) return json({ error: error.message }, 500)
  if (!devices?.length) return json({ sent: 0 })

  const lang: Lang = profile?.language === 'en' ? 'en' : 'pt'
  const title = 'alinho'
  const body = noticeBody(n, lang)
  const data = { path: noticePath(n), notification_id: String(n.id) }

  let sent = 0
  const gone: string[] = []
  const errors: string[] = []
  await Promise.all(devices.map(async ({ token, platform }) => {
    try {
      const ok = platform === 'ios' ? await sendApns(token, title, body, data) : await sendFcm(token, title, body, data)
      if (ok) sent++
      else gone.push(token)
    } catch (e) {
      errors.push(String((e as Error).message || e))
    }
  }))
  if (gone.length) await db.from('push_devices').delete().in('token', gone)
  if (errors.length) console.error('send-push errors:', errors)
  return json({ sent, removed: gone.length, errors: errors.length })
})
