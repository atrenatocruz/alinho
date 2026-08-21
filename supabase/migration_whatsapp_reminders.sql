-- ════════════════════════════════════════════════════════════════════════
-- Migration: WhatsApp bot reminders — game-day reminder (X hours before a
-- mix, tagging its confirmed participants) and a daily digest of mixes
-- still open. Both are bot-side automations (whatsapp-bot/src/reminders.js)
-- using the service-role key, so no new RLS policies are needed — just the
-- two columns the bot reads/writes.
--
-- whatsapp_jid: cached opportunistically (see whatsapp-bot/src/phone.js)
-- whenever the bot resolves an incoming message's sender to a profile, so
-- reminders can @-mention that person by their real WhatsApp JID instead of
-- only listing their name in plain text. A profile that's never sent a
-- message in the group simply won't have one yet — reminders fall back to
-- their name in that case.
--
-- reminder_sent_at: dedupe flag for the "X hours before" reminder, so a
-- restart or a slow poll tick never double-sends it for the same mix.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE profiles ADD COLUMN whatsapp_jid TEXT;
ALTER TABLE games ADD COLUMN reminder_sent_at TIMESTAMPTZ;
