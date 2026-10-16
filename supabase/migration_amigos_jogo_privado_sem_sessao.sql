-- ═════════════════════════════════════════════════════════════════════════
-- Jogo privado: sem sessão iniciada, nada do jogo
--
-- PORQUÊ. Nota do SI e decisão do PO (12 out, opção B): sem sessão iniciada,
-- quem tivesse o link via o sítio e a hora de um jogo privado. Agora, sem
-- sessão, só «Este jogo é privado» e «Entrar»; o cartão com o dia, a hora,
-- o sítio e quem criou aparece depois de entrar.
--
-- O QUE FAZ. get_friend_match_preview, sem sessão: {match_id, is_member:
-- false, signed_in: false} e mais nada. Com sessão, como antes, e
-- signed_in: true. NULL se o jogo não existir.
--
-- ORDEM. Depois de migration_amigos_jogo_privado.sql.
--
-- Dev 3, 12 out 2026 · ecrã: Bugs
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.get_friend_match_preview(p_match_id UUID)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH r AS (
    SELECT root.*
      FROM private_matches x
      JOIN private_matches root ON root.id = COALESCE(x.session_id, x.id)
     WHERE x.id = p_match_id AND root.is_friend_session
  )
  SELECT CASE
    -- Sem sessão: só se sabe que o jogo existe (PO, 12 out, opção B).
    WHEN auth.uid() IS NULL THEN jsonb_build_object('match_id', r.id, 'is_member', FALSE, 'signed_in', FALSE)
    ELSE jsonb_build_object(
           'match_id', r.id,
           'signed_in', TRUE,
           'scheduled_date', r.scheduled_date,
           'scheduled_time', r.scheduled_time,
           'location', r.location,
           'creator_short_name', (SELECT live_short_name(p.name) FROM profiles p WHERE p.id = r.creator_id),
           'people', (SELECT count(*) FROM private_match_invitees i WHERE i.match_id = r.id AND i.status <> 'declined'),
           'is_member', r.creator_id = auth.uid()
                        OR EXISTS (SELECT 1 FROM private_match_invitees i
                                    WHERE i.match_id = r.id AND i.user_id = auth.uid())) END
    FROM r;
$function$;
REVOKE ALL ON FUNCTION public.get_friend_match_preview(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_friend_match_preview(UUID) TO anon, authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.get_friend_match_preview(uuid)'::regprocedure) LIKE '%signed_in%';  -- true
