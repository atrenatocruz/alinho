-- ═════════════════════════════════════════════════════════════════════════
-- Jogos entre amigos: o jogo aceite continua na Home antes das equipas
--
-- PORQUÊ. QA, 13 out (para sexta): a t2 aceitou («Vou») um jogo entre amigos
-- ainda sem equipas e o jogo desapareceu da Home toda. A Home junta dois
-- caminhos: os convites por responder (list_my_friend_match_invites) e os
-- jogos com equipas onde a pessoa está (get_my_private_matches). Um convite
-- aceite antes de haver equipas não estava em nenhum.
--
-- O QUE FAZ. list_my_friend_match_invites passa a trazer também as sessões
-- em que a pessoa disse «Vou» e que ainda não têm equipas nem acabaram. Cada
-- linha ganha:
--   · my_status: 'pending' (por responder, como antes) ou 'accepted';
--   · is_creator: quem criou também tem a sua linha 'accepted' até haver
--     equipas.
-- Quando as equipas ficam formadas, a sessão sai daqui e entra pelo
-- get_my_private_matches, como hoje. Corpo VIVO, 2 trocas literais («já
-- estava»); devolve jsonb na mesma.
--
-- Dev 3, 13 out 2026 · ecrã: Dev 2 (o cartão tem de tratar 'accepted' como
-- «Vais», sem «Vou/Não vou»; os dois lados vão juntos)
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_where_mau CONSTANT TEXT := $a$   WHERE (i.user_id = auth.uid() AND i.status = 'pending')$a$;
  c_where_bom CONSTANT TEXT := $a$   WHERE (i.user_id = auth.uid() AND (i.status = 'pending'
                                     -- Já disse «Vou», mas ainda não há equipas (QA, 13 out).
                                     OR (i.status = 'accepted' AND m.teams_set_at IS NULL AND m.finished_at IS NULL)))$a$;
  c_campo     CONSTANT TEXT := $a$'teams_set', m.teams_set_at IS NOT NULL,$a$;
  v_def TEXT := pg_get_functiondef('public.list_my_friend_match_invites()'::regprocedure);
BEGIN
  IF v_def LIKE '%''my_status''%' THEN
    RAISE NOTICE 'list_my_friend_match_invites: já estava';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_where_mau, ''))) / length(c_where_mau) <> 1
     OR (length(v_def) - length(replace(v_def, c_campo, ''))) / length(c_campo) <> 1 THEN
    RAISE EXCEPTION 'list_my_friend_match_invites: um dos pedaços a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  v_def := replace(v_def, c_where_mau, c_where_bom);
  v_def := replace(v_def, c_campo, c_campo
    || $b$ 'my_status', CASE WHEN i.user_id IS NULL THEN 'pending' ELSE i.status END, 'is_creator', m.creator_id = auth.uid(),$b$);
  EXECUTE v_def;
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.list_my_friend_match_invites()'::regprocedure) LIKE '%''my_status''%';  -- true
