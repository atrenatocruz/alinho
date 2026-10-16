-- ═════════════════════════════════════════════════════════════════════════
-- Jogo entre amigos: o que vê quem abre o link sem ter sido convidado
--
-- PORQUÊ. SPEC design-handoff/2026-10-12-partilhar-link (Francisco, 12 out:
-- «Sim»): o link de um jogo entre amigos pode ser partilhado; quem o abre
-- sem convite vê «Este jogo é privado» com um cartão do jogo. Ecrã: Bugs.
--
-- O QUE FAZ. get_friend_match_preview(p_match_id) → jsonb, ou NULL se o
-- jogo não existir:
--   {match_id, scheduled_date, scheduled_time, location,
--    creator_short_name, people, is_member}
--   · Só estes dados: nada de nomes de jogadores, resultados nem rondas
--     (privado continua privado).
--   · people: quem foi convidado e não recusou (o mesmo número da lista).
--   · is_member: quem chama criou o jogo ou foi convidado (vê o jogo
--     normal). Sem sessão, false.
--   · Aceita o id da sessão ou de uma ronda dela.
--   Aberta também a anon: o SPEC mostra o cartão a quem ainda não entrou
--   («Entrar» e volta ao link). O id é um uuid que só existe no link.
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
  SELECT jsonb_build_object(
           'match_id', r.id,
           'scheduled_date', r.scheduled_date,
           'scheduled_time', r.scheduled_time,
           'location', r.location,
           'creator_short_name', (SELECT live_short_name(p.name) FROM profiles p WHERE p.id = r.creator_id),
           'people', (SELECT count(*) FROM private_match_invitees i WHERE i.match_id = r.id AND i.status <> 'declined'),
           'is_member', auth.uid() IS NOT NULL
                        AND (r.creator_id = auth.uid()
                             OR EXISTS (SELECT 1 FROM private_match_invitees i
                                         WHERE i.match_id = r.id AND i.user_id = auth.uid())))
    FROM r;
$function$;
REVOKE ALL ON FUNCTION public.get_friend_match_preview(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_friend_match_preview(UUID) TO anon, authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT has_function_privilege('anon', 'public.get_friend_match_preview(uuid)', 'EXECUTE');  -- true (de propósito)
--   SELECT get_friend_match_preview(gen_random_uuid());  -- NULL
