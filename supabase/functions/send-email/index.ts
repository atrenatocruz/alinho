// Supabase Edge Function: the app's only path for transactional email
// (everything that isn't a Supabase Auth email — those go out over the SMTP
// configured in the dashboard, see DEPLOYMENT.md → "Email (SMTP)").
//
// Deliberately NOT a generic mailer. The body is `{ type, ...ids }` — never
// a recipient, subject or content. Each handler below re-derives all three
// server-side from rows the caller is provably entitled to act on, so a
// logged-in user calling this directly can't turn it into a relay for
// arbitrary mail from @alinho.pt. Adding a new kind of email means adding a
// handler here, with its own authorization and its own "only once" guard.
//
// Email is always an extra on top of the in-app notification, never the
// only channel — every failure mode here degrades to "no email was sent".
//
// Secrets (Supabase → Edge Functions → Secrets):
//   RESEND_API_KEY   required
//   EMAIL_FROM       default: alinho <noreply@alinho.pt>
//   EMAIL_REPLY_TO   optional
//   APP_URL          default: https://alinho.pt

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

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

function decodeJwt(authHeader: string | null): { role: string | null; sub: string | null } {
  if (!authHeader?.startsWith('Bearer ')) return { role: null, sub: null }
  const token = authHeader.slice('Bearer '.length)
  const parts = token.split('.')
  if (parts.length !== 3) return { role: null, sub: null }
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1]))
    return {
      role: typeof payload.role === 'string' ? payload.role : null,
      sub: typeof payload.sub === 'string' ? payload.sub : null,
    }
  } catch {
    return { role: null, sub: null }
  }
}

// Test players (admin-create-test-user, admin-bulk-create-participants),
// WhatsApp guests (whatsapp-bot/src/phone.js) and anonymized accounts
// (migration_account_deletion.sql) are real Auth users with made-up
// addresses — nobody reads those inboxes, and sending to them only earns
// bounces against the domain's reputation.
function isDeliverable(email: string | undefined): email is string {
  if (!email) return false
  const lower = email.toLowerCase()
  return !lower.endsWith('@padelapp.test')
    && !lower.endsWith('@whatsapp.alinho.pt')
    && !lower.endsWith('@alinho.invalid')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Same look as supabase/templates/*.pt.html, so Auth emails and these read
// as one product. `paragraphs` and `footnote` are trusted HTML — escape any
// user-provided value (names, club names) before it gets in here.
function renderLayout(opts: {
  heading: string
  paragraphs: string[]
  ctaLabel: string
  ctaUrl: string
  footnote: string
}): string {
  const paragraphs = opts.paragraphs
    .map((p) => `<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#1F2937;">${p}</p>`)
    .join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFFFF;border-radius:16px;overflow:hidden;">
        <tr>
          <td style="background:#040404;padding:28px 32px;">
            <img src="https://www.alinho.pt/email-logo.png" width="140" height="35" alt="alinho" style="display:block;border:0;outline:none;text-decoration:none;width:140px;height:35px;">
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#040404;">${opts.heading}</h1>
            ${paragraphs}
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td style="border-radius:12px;background:#C5DD01;">
                  <a href="${opts.ctaUrl}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:#040404;text-decoration:none;">${opts.ctaLabel}</a>
                </td>
              </tr>
            </table>
            <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#4B5563;">${opts.footnote}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`
}

type Outgoing = { to: string; subject: string; html: string }

// A handler returns the email to send plus how to undo its "only once" mark
// if the send then fails, or a reason why there's nothing to send.
type HandlerResult =
  | { email: Outgoing; release: () => Promise<void> }
  | { skip: string }

type Handler = (ctx: {
  admin: SupabaseClient
  callerId: string
  appUrl: string
  body: Record<string, unknown>
}) => Promise<HandlerResult>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Club invite (GerirClube → Membros → convidar por pesquisa). Authorization
// and the once-per-invite guard both live in claim_organization_invite_email
// (supabase/migration_organization_invite_email.sql): it only returns a row
// when the caller is the one who sent this still-pending invite and no email
// has gone out for it yet.
const organizationInvite: Handler = async ({ admin, callerId, appUrl, body }) => {
  const organizationId = body.organization_id
  const userId = body.user_id
  if (typeof organizationId !== 'string' || !UUID_RE.test(organizationId) ||
      typeof userId !== 'string' || !UUID_RE.test(userId)) {
    return { skip: 'invalid_request' }
  }

  const { data, error } = await admin.rpc('claim_organization_invite_email', {
    p_organization_id: organizationId,
    p_invited_user_id: userId,
    p_caller_id: callerId,
  })
  if (error) throw error
  const invite = data?.[0]
  if (!invite) return { skip: 'nothing_to_send' }

  const release = async () => {
    const { error: releaseError } = await admin
      .from('organization_invites')
      .update({ emailed_at: null })
      .eq('organization_id', organizationId)
      .eq('invited_user_id', userId)
    if (releaseError) console.error('Failed to release invite email claim:', releaseError)
  }

  const { data: authUser, error: userError } = await admin.auth.admin.getUserById(userId)
  if (userError) {
    await release()
    throw userError
  }
  const to = authUser?.user?.email
  // Claim stays in place: a synthetic address won't become real on a retry.
  if (!isDeliverable(to)) return { skip: 'no_deliverable_address' }

  const club = escapeHtml(invite.organization_name)
  const inviter = escapeHtml(invite.invited_by_name)
  const en = invite.invited_language === 'en'
  const asAdmin = invite.as_admin === true

  const email: Outgoing = en
    ? {
        to,
        subject: `${invite.invited_by_name} invited you to ${invite.organization_name} on alinho`,
        html: renderLayout({
          heading: `You've been invited to ${club}`,
          paragraphs: [
            asAdmin
              ? `<strong>${inviter}</strong> invited you to join <strong>${club}</strong> as an admin. Open the app to accept or decline.`
              : `<strong>${inviter}</strong> invited you to join <strong>${club}</strong>. Open the app to accept or decline.`,
          ],
          ctaLabel: 'See invite',
          ctaUrl: `${appUrl}/perfil?tab=convites`,
          footnote: `You're getting this email because you have an alinho account and someone invited you to a club. If you don't know this club, just ignore it — nothing happens until you accept.`,
        }),
      }
    : {
        to,
        subject: `${invite.invited_by_name} convidou-te para ${invite.organization_name} no alinho`,
        html: renderLayout({
          heading: `Tens um convite para ${club}`,
          paragraphs: [
            asAdmin
              ? `<strong>${inviter}</strong> convidou-te para entrares em <strong>${club}</strong> como admin. Abre a app para aceitares ou recusares.`
              : `<strong>${inviter}</strong> convidou-te para entrares em <strong>${club}</strong>. Abre a app para aceitares ou recusares.`,
          ],
          ctaLabel: 'Ver convite',
          ctaUrl: `${appUrl}/perfil?tab=convites`,
          footnote: `Recebes este email porque tens conta no alinho e alguém te convidou para um clube. Se não conheces este clube, podes ignorar — nada acontece enquanto não aceitares.`,
        }),
      }

  return { email, release }
}

// Welcome email, once per account, fired by AuthContext on the first session
// (after email confirmation for email+password signups, first login for
// Google). Only ever goes to the caller themself — the body carries no ids.
// claim_welcome_email (supabase/migration_welcome_email.sql) is the
// once-only guard, and marks pre-existing accounts as already sent.
const welcome: Handler = async ({ admin, callerId, appUrl }) => {
  const { data, error } = await admin.rpc('claim_welcome_email', { p_user_id: callerId })
  if (error) throw error
  const profile = data?.[0]
  if (!profile) return { skip: 'nothing_to_send' }

  const release = async () => {
    const { error: releaseError } = await admin
      .from('profiles')
      .update({ welcome_emailed_at: null })
      .eq('id', callerId)
    if (releaseError) console.error('Failed to release welcome email claim:', releaseError)
  }

  const { data: authUser, error: userError } = await admin.auth.admin.getUserById(callerId)
  if (userError) {
    await release()
    throw userError
  }
  const to = authUser?.user?.email
  if (!isDeliverable(to)) return { skip: 'no_deliverable_address' }

  // First name only — "Olá Rui" reads better than the full name.
  const firstName = escapeHtml((profile.name || '').trim().split(/\s+/)[0] || '')
  const greeting = (hello: string) => (firstName ? `${hello} ${firstName}!` : `${hello}!`)
  const en = profile.language === 'en'

  const email: Outgoing = en
    ? {
        to,
        subject: 'Welcome to alinho',
        html: renderLayout({
          heading: greeting('Hi'),
          paragraphs: [
            `Your alinho account is ready. This is where your club's games live: see what's coming up, join with one tap, and follow the results and rankings.`,
            `If your club already uses alinho, ask an admin for the invite link — it puts you straight into the club. If you can't find a game yet, the games on the app tab <strong>Comunidade</strong> are open to everyone.`,
          ],
          ctaLabel: 'Open alinho',
          ctaUrl: appUrl,
          footnote: `You're getting this email because you just created an alinho account. This mailbox isn't monitored — there's no need to reply.`,
        }),
      }
    : {
        to,
        subject: 'Bem-vindo ao alinho',
        html: renderLayout({
          heading: greeting('Olá'),
          paragraphs: [
            `A tua conta no alinho está pronta. É aqui que vivem os jogos do teu clube: vês o que vem aí, entras com um toque e acompanhas os resultados e o ranking.`,
            `Se o teu clube já usa o alinho, pede o link de convite a um admin — leva-te direto para o clube. Se ainda não encontras jogos, os da aba <strong>Comunidade</strong> estão abertos a toda a gente.`,
          ],
          ctaLabel: 'Abrir o alinho',
          ctaUrl: appUrl,
          footnote: `Recebes este email porque acabaste de criar conta no alinho. Este endereço não é lido — não é preciso responder.`,
        }),
      }

  return { email, release }
}

// ── Aulas: pedidos (Trello #392; migration_lessons_4_teacher_responds.sql) ──
// Tipos, dias e horas em Lisboa, iguais ao sino.
const LESSON_TYPE_PT: Record<string, string> = { private: 'aula privada', duo: 'aula a 2', trio: 'aula a 3', quad: 'aula a 4' }
const LESSON_TYPE_EN: Record<string, string> = { private: 'private lesson', duo: 'lesson for 2', trio: 'lesson for 3', quad: 'lesson for 4' }

function lessonWhen(startsAt: string, minutes: number, en: boolean): string {
  const start = new Date(startsAt)
  const end = new Date(start.getTime() + minutes * 60000)
  const locale = en ? 'en-GB' : 'pt-PT'
  const day = new Intl.DateTimeFormat(locale, { timeZone: 'Europe/Lisbon', weekday: 'long', day: 'numeric', month: 'long' }).format(start)
  const hm = (d: Date) => new Intl.DateTimeFormat(locale, { timeZone: 'Europe/Lisbon', hour: '2-digit', minute: '2-digit' }).format(d)
  return `${day}, ${hm(start)}–${hm(end)}`
}

// Ao professor, quando chega um pedido. Quem chama é o aluno que acabou de o
// enviar; claim_lesson_request_email só devolve a linha uma vez. O botão de
// contacto é o que o aluno escolheu — WhatsApp (wa.me) ou email (mailto) —
// sem o número escrito no texto.
const lessonRequest: Handler = async ({ admin, callerId, appUrl, body }) => {
  const requestId = body.request_id
  if (typeof requestId !== 'string' || !UUID_RE.test(requestId)) return { skip: 'invalid_request' }

  const { data, error } = await admin.rpc('claim_lesson_request_email', { p_request_id: requestId, p_caller_id: callerId })
  if (error) throw error
  const req = data?.[0]
  if (!req) return { skip: 'nothing_to_send' }

  const release = async () => {
    const { error: releaseError } = await admin.from('lesson_requests').update({ teacher_emailed_at: null }).eq('id', requestId)
    if (releaseError) console.error('Failed to release lesson request email claim:', releaseError)
  }

  const [{ data: teacher, error: tErr }, { data: student, error: sErr }] = await Promise.all([
    admin.auth.admin.getUserById(req.teacher_user_id),
    admin.auth.admin.getUserById(req.student_user_id),
  ])
  if (tErr || sErr) { await release(); throw tErr || sErr }
  const to = teacher?.user?.email
  if (!isDeliverable(to)) return { skip: 'no_deliverable_address' }

  const en = req.teacher_language === 'en'
  const name = escapeHtml(req.student_name || '')
  const when = escapeHtml(lessonWhen(req.starts_at, req.duration_minutes, en))
  const type = escapeHtml((en ? LESSON_TYPE_EN : LESSON_TYPE_PT)[req.lesson_type] || req.lesson_type)
  const club = req.org_name ? escapeHtml(req.org_name) : ''
  const price = req.price_per_person != null ? `${Number(req.price_per_person)} €` : ''
  const contactUrl = req.contact_via === 'whatsapp' && req.contact_phone
    ? `https://wa.me/${req.contact_phone}`
    : (isDeliverable(student?.user?.email) ? `mailto:${student.user.email}` : '')
  const contactLabel = req.contact_via === 'whatsapp'
    ? (en ? 'Chat on WhatsApp' : 'Falar no WhatsApp')
    : (en ? 'Send email' : 'Mandar email')
  const details = [when, `${type}${price ? ` · ${price} ${en ? 'per person' : 'por pessoa'}` : ''}`, club].filter(Boolean).join('<br>')
  const contact = contactUrl ? `<a href="${escapeHtml(contactUrl)}" style="color:#040404;font-weight:700;">${contactLabel}</a>` : ''

  const email: Outgoing = {
    to,
    subject: en ? `New lesson request · ${req.student_name}` : `Novo pedido de aula · ${req.student_name}`,
    html: renderLayout({
      heading: en ? `${name} asked you for a lesson` : `${name} pediu-te uma aula`,
      paragraphs: [details, ...(contact ? [contact] : [])],
      ctaLabel: en ? 'See request' : 'Ver pedido',
      ctaUrl: `${appUrl}/perfil/aulas`,
      footnote: en
        ? 'You get this email because you are a coach on alinho. The student chose how you contact them; the contact is deleted when the request closes.'
        : 'Recebes este email porque és professor no alinho. O aluno escolheu como falas com ele; o contacto apaga-se quando o pedido fecha.',
    }),
  }
  return { email, release }
}

// Ao aluno, quando o professor responde, se o aluno escolheu «Por email».
// Quem chama é o professor desse pedido; uma vez por estado.
const lessonRequestStudent: Handler = async ({ admin, callerId, appUrl, body }) => {
  const requestId = body.request_id
  if (typeof requestId !== 'string' || !UUID_RE.test(requestId)) return { skip: 'invalid_request' }

  const { data, error } = await admin.rpc('claim_lesson_request_student_email', { p_request_id: requestId, p_caller_id: callerId })
  if (error) throw error
  const req = data?.[0]
  if (!req) return { skip: 'nothing_to_send' }

  const release = async () => {
    const { error: releaseError } = await admin.from('lesson_requests').update({ student_emailed_for: null }).eq('id', requestId)
    if (releaseError) console.error('Failed to release student lesson email claim:', releaseError)
  }

  const { data: student, error: sErr } = await admin.auth.admin.getUserById(req.student_user_id)
  if (sErr) { await release(); throw sErr }
  const to = student?.user?.email
  if (!isDeliverable(to)) return { skip: 'no_deliverable_address' }

  const en = req.student_language === 'en'
  const teacher = escapeHtml(req.teacher_name || '')
  const when = escapeHtml(lessonWhen(req.starts_at, req.duration_minutes, en))
  const club = req.org_name ? ` · ${escapeHtml(req.org_name)}` : ''
  const accepted = req.status === 'accepted'

  const email: Outgoing = {
    to,
    subject: accepted
      ? (en ? `${req.teacher_name} accepted your lesson` : `${req.teacher_name} aceitou a tua aula`)
      : (en ? `${req.teacher_name} can't give that lesson` : `${req.teacher_name} não pode dar essa aula`),
    html: renderLayout({
      heading: accepted
        ? (en ? `Your lesson with ${teacher} is booked` : `A tua aula com ${teacher} está marcada`)
        : (en ? `${teacher} can't give that lesson` : `${teacher} não pode dar essa aula`),
      paragraphs: [`${when}${club}`, accepted
        ? (en ? 'The coach books the court with the club. You don’t need to.' : 'O campo é marcado pelo professor com o clube: não precisas de reservar.')
        : (en ? 'You can ask for another time.' : 'Podes pedir outra hora.')],
      ctaLabel: accepted ? (en ? 'See lesson' : 'Ver a aula') : (en ? 'Open alinho' : 'Abrir o alinho'),
      ctaUrl: accepted && req.lesson_id ? `${appUrl}/aula/${req.lesson_id}` : appUrl,
      footnote: en
        ? 'You get this email because you asked for a lesson on alinho and chose to be contacted by email.'
        : 'Recebes este email porque pediste uma aula no alinho e escolheste ser contactado por email.',
    }),
  }
  return { email, release }
}

const handlers: Record<string, Handler> = {
  organization_invite: organizationInvite,
  welcome,
  lesson_request: lessonRequest,
  lesson_request_student: lessonRequestStudent,
}

async function sendWithResend(apiKey: string, email: Outgoing): Promise<void> {
  const replyTo = Deno.env.get('EMAIL_REPLY_TO')
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: Deno.env.get('EMAIL_FROM') || 'alinho <noreply@alinho.pt>',
      to: [email.to],
      subject: email.subject,
      html: email.html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  })
  if (!response.ok) {
    throw new Error(`Resend responded ${response.status}: ${await response.text()}`)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const { role, sub: callerId } = decodeJwt(req.headers.get('Authorization'))
  if (role !== 'authenticated' || !callerId) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const handler = typeof body?.type === 'string' ? handlers[body.type] : undefined
  if (!handler) {
    return jsonResponse({ error: 'Unknown email type' }, 400)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  if (!supabaseUrl || !serviceRoleKey || !resendApiKey) {
    console.error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or RESEND_API_KEY is not set')
    return jsonResponse({ error: 'Server misconfigured' }, 500)
  }
  const admin = createClient(supabaseUrl, serviceRoleKey)
  const appUrl = (Deno.env.get('APP_URL') || 'https://alinho.pt').replace(/\/+$/, '')

  let result: HandlerResult
  try {
    result = await handler({ admin, callerId, appUrl, body })
  } catch (error) {
    console.error(`send-email (${body.type}) failed before sending:`, error)
    return jsonResponse({ error: 'Server error' }, 500)
  }

  // One undifferentiated "not sent" for every skip reason a caller could
  // probe (not their invite / already emailed / synthetic address) — the
  // specific reason only goes to the function logs.
  if ('skip' in result) {
    if (result.skip === 'invalid_request') return jsonResponse({ error: 'Invalid request' }, 400)
    console.log(`send-email (${body.type}) skipped: ${result.skip}`)
    return jsonResponse({ sent: false })
  }

  try {
    await sendWithResend(resendApiKey, result.email)
  } catch (error) {
    console.error(`send-email (${body.type}) failed to send:`, error)
    await result.release()
    return jsonResponse({ error: 'Failed to send email' }, 502)
  }

  return jsonResponse({ sent: true })
})
