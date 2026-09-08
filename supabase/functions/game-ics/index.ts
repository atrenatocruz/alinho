// Serves a single mix as a downloadable .ics file — GET /functions/v1/game-ics?id=<game_id>.
// Linked directly from the WhatsApp bot's roster message (see
// whatsapp-bot/src/roster.js) so a player can add the mix to their own
// calendar (Google/Apple/Outlook) with one tap, no app login needed.
//
// Deliberately public/unauthenticated (WhatsApp taps this cold, with no
// Authorization header at all) — deployed with --no-verify-jwt. It only
// ever returns a game's title/date/location/court time, the same info
// already sitting in plaintext in the WhatsApp message that links here, so
// there's nothing exposed beyond what's already shared in that chat. Uses
// the service-role key (bypasses RLS) since there's no user session to
// scope the query to — Trello #166.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function textResponse(body: string, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { ...corsHeaders, ...extraHeaders } })
}

// UTC "Z" form (YYYYMMDDTHHMMSSZ) — an absolute instant, so it renders
// correctly in every calendar app regardless of the viewer's own timezone,
// with no VTIMEZONE block needed.
function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

// RFC 5545 §3.3.11 escaping — backslash first so it doesn't double-escape
// the characters escaped after it.
function icsEscape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'GET') {
    return textResponse('Method not allowed', 405)
  }

  const gameId = new URL(req.url).searchParams.get('id')
  if (!gameId) {
    return textResponse('Missing id', 400)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set')
    return textResponse('Server misconfigured', 500)
  }
  const admin = createClient(supabaseUrl, serviceRoleKey)

  const { data: game, error } = await admin
    .from('games')
    .select('id, title, date, location, court_time_minutes')
    .eq('id', gameId)
    .maybeSingle()
  if (error) {
    console.error('Failed to load game for .ics:', error)
    return textResponse('Server error', 500)
  }
  if (!game) {
    return textResponse('Mix not found', 404)
  }

  const start = new Date(game.date)
  const durationMinutes = game.court_time_minutes || 90
  const end = new Date(start.getTime() + durationMinutes * 60_000)
  const appUrl = Deno.env.get('APP_URL') || 'https://alinho.pt'

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//alinho//game-ics//PT',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${game.id}@alinho.pt`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsEscape(game.title)}`,
    ...(game.location ? [`LOCATION:${icsEscape(game.location)}`] : []),
    `DESCRIPTION:${icsEscape(`${appUrl}/jogo/${game.id}`)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]

  return textResponse(lines.join('\r\n') + '\r\n', 200, {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': 'attachment; filename="mix.ics"',
  })
})
