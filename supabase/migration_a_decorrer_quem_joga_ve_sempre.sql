-- ═════════════════════════════════════════════════════════════════════════
-- «A decorrer agora»: quem joga vê sempre o seu jogo entre amigos
--
-- PORQUÊ. QA, 13 out: com o «Mostrar a decorrer» desligado, nem quem joga
-- via o seu jogo entre amigos no «A decorrer agora» da Home. Decisão do PO:
-- quem joga vê sempre o seu próprio jogo lá; o interruptor só decide se os
-- OUTROS (membros do grupo ou quem segue os jogadores) o veem.
--
-- O QUE FAZ. No ramo dos jogos entre amigos do list_live_events:
--   · sai a condição «show_live» do filtro geral;
--   · entra quem está no jogo (convidado que não recusou, ou quem o criou)
--     OU o friend_match_live_visible de sempre (que continua a exigir o
--     show_live e as outras regras para os outros).
-- O resto fica igual: hoje, já com equipas, já começado e com algum jogo
-- por marcar. Corpo VIVO, 2 trocas literais («já estava»).
--
-- ORDEM. Depois de migration_a_decorrer_campos.sql.
--
-- Dev 3, 13 out 2026 · ecrã: Dev 2 (não muda)
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_onde_mau CONSTANT TEXT := 'WHERE pm.is_friend_session AND pm.show_live AND pm.teams_set_at IS NOT NULL';
  c_onde_bom CONSTANT TEXT := 'WHERE pm.is_friend_session AND pm.teams_set_at IS NOT NULL';
  c_vis_mau  CONSTANT TEXT := '              AND friend_match_live_visible(pm.id)';
  c_vis_bom  CONSTANT TEXT := E'              -- Quem joga vê sempre o seu; o «Mostrar a decorrer» só decide os outros (PO, 13 out).\n'
                           || E'              AND (pm.creator_id = auth.uid()\n'
                           || E'                   OR EXISTS (SELECT 1 FROM private_match_invitees me WHERE me.match_id = pm.id\n'
                           || E'                                AND me.user_id = auth.uid() AND me.status <> ''declined'')\n'
                           || E'                   OR friend_match_live_visible(pm.id))';
  v_def TEXT := pg_get_functiondef('public.list_live_events(uuid)'::regprocedure);
BEGIN
  IF v_def LIKE '%Quem joga vê sempre o seu%' THEN
    RAISE NOTICE 'list_live_events: já estava';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_onde_mau, ''))) / length(c_onde_mau) <> 1
     OR (length(v_def) - length(replace(v_def, c_vis_mau, ''))) / length(c_vis_mau) <> 1 THEN
    RAISE EXCEPTION 'list_live_events: um dos pedaços a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE replace(replace(v_def, c_onde_mau, c_onde_bom), c_vis_mau, c_vis_bom);
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.list_live_events(uuid)'::regprocedure) LIKE '%Quem joga vê sempre o seu%';  -- true
