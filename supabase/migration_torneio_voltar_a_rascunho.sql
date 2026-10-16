-- ═════════════════════════════════════════════════════════════════════════
-- Torneio: «Voltar a rascunho» com inscritos, igual ao mix
--
-- PORQUÊ. Francisco, 10 out: «Então porque não está igual aos mixes em modo
-- draft?» Decisão do PO a 13 out: voltar a rascunho com inscritos é um
-- cancelar que guarda o torneio no Gerir, e os inscritos recebem aviso na
-- app («retirado pela organização»), como o unpublish_mix (6 out). Hoje o
-- set_tournament_status deixava voltar a rascunho com inscritos sem avisar
-- ninguém, e as inscrições ficavam presas a um torneio escondido. Ecrã:
-- Dev 1.
--
-- O QUE FAZ. set_tournament_status(p_tournament_id, 'rascunho'), vindo de
-- 'inscricoes' ou 'fechado' (os únicos de onde se volta à mão, como antes):
--   · cada pessoa com conta numa inscrição que não desistiu (o 1.º, e o 2.º
--     mesmo por aceitar) recebe 'tournament_unpublished' {tournament_id,
--     tournament_slug, tournament_name} — «retirado», nunca «cancelado»;
--     quem muda não se avisa a si;
--   · os avisos do torneio por ler passam a lidos (como no cancelar);
--   · as inscrições saem todas (antes do sorteio não há jogos nem
--     resultados a guardar), e as categorias voltam a 'inscricoes';
--   · o torneio fica 'rascunho': só no Gerir, publica-se de novo como um
--     rascunho normal.
--   Sem inscrições, fica como antes. Corpo VIVO, 1 troca literal («já
--   estava»).
--
-- Dev 3, 13 out 2026 · ecrã: Dev 1
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_frag CONSTANT TEXT := '  UPDATE tournaments SET status = p_status WHERE id = p_tournament_id;';
  v_def  TEXT := pg_get_functiondef('public.set_tournament_status(uuid,text)'::regprocedure);
BEGIN
  IF v_def LIKE '%tournament_unpublished%' THEN
    RAISE NOTICE 'set_tournament_status: já estava';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_frag, ''))) / length(c_frag) <> 1 THEN
    RAISE EXCEPTION 'set_tournament_status: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE replace(v_def, c_frag, $b$  -- Voltar a rascunho com inscritos = um cancelar que guarda o torneio,
  -- como no mix (Francisco, 10 out): avisa e tira as inscrições.
  IF p_status = 'rascunho' AND v_current <> 'rascunho' THEN
    INSERT INTO notifications (user_id, kind, actor_id, data)
    SELECT DISTINCT u.uid, 'tournament_unpublished', auth.uid(),
           jsonb_build_object('tournament_id', t.id, 'tournament_slug', t.slug, 'tournament_name', t.name)
      FROM tournaments t
      JOIN tournament_categories c ON c.tournament_id = t.id
      JOIN tournament_entries e ON e.category_id = c.id AND e.status <> 'desistiu'
      CROSS JOIN LATERAL (VALUES (e.player1_id), (e.player2_id)) AS u(uid)
     WHERE t.id = p_tournament_id AND u.uid IS NOT NULL AND u.uid IS DISTINCT FROM auth.uid();
    UPDATE notifications SET read_at = NOW()
     WHERE read_at IS NULL AND kind <> 'tournament_unpublished' AND data->>'tournament_id' = p_tournament_id::text;
    DELETE FROM tournament_entries e
     USING tournament_categories c
     WHERE e.category_id = c.id AND c.tournament_id = p_tournament_id;
    UPDATE tournament_categories SET status = 'inscricoes'
     WHERE tournament_id = p_tournament_id AND status = 'fechada';
  END IF;

$b$ || c_frag);
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.set_tournament_status(uuid,text)'::regprocedure) LIKE '%tournament_unpublished%';  -- true
