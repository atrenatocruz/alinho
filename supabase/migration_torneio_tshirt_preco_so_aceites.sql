-- ═════════════════════════════════════════════════════════════════════════
-- Torneio: t-shirts e preço especial contam só quem aceitou
--
-- PORQUÊ. Revisão do PO, 13 out, ponto 6: quem foi convidado para uma dupla
-- e ainda não aceitou contava nas t-shirts (totais e lista de quem organiza)
-- e na lista de preços do evento. Decisão do PO: a mesma regra do #630 —
-- convite por aceitar não conta. As t-shirts vão no main de sexta 16, por
-- isso esta regra também.
--
-- O QUE FAZ. Numa inscrição em 'convite', o jogador 1 (quem convidou) conta;
-- o jogador 2 (o convidado) só conta depois de aceitar.
--   · tournament_tshirt_rows: o lugar 2 de uma inscrição em 'convite' sai
--     (daí os totais, a lista de pessoas e o «por escolher»);
--   · tournament_person_tshirt: o tamanho de uma pessoa não vem de um
--     convite que ela ainda não aceitou;
--   · event_price_roster: o convidado ainda por aceitar não entra na lista
--     de preços da categoria.
-- O bloqueio da categoria (tournament_person_in_category) fica igual: é para
-- depois de sexta. Corpos VIVOS, 1 troca literal em cada («já estava»).
--
-- ORDEM. Depois de migration_torneio_t_shirts.sql,
-- migration_torneio_t_shirt_por_pessoa.sql e migration_preco_especial.sql.
--
-- Dev 3, 13 out 2026 · ecrãs: Dev 1 (não mudam)
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_marca CONSTANT TEXT := 'convite por aceitar não conta (PO, 13 out)';
  v_def TEXT;
  v_mau TEXT;
  v_bom TEXT;
  r RECORD;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.tournament_tshirt_rows(uuid)',
       'AND (e.player2_id IS NOT NULL OR e.guest_name IS NOT NULL);',
       'AND (e.player2_id IS NOT NULL OR e.guest_name IS NOT NULL)'
         || ' AND e.status <> ''convite'';  -- ' || c_marca),
      ('public.tournament_person_tshirt(uuid,uuid,uuid)',
       'AND e.id IS DISTINCT FROM p_skip AND p_user IN (e.player1_id, e.player2_id)',
       'AND e.id IS DISTINCT FROM p_skip'
         || ' AND (e.player1_id = p_user OR (e.player2_id = p_user AND e.status <> ''convite''))  -- ' || c_marca || E'\n      '),
      ('public.event_price_roster(text,uuid)',
       'CROSS JOIN LATERAL (VALUES (te.player1_id), (te.player2_id)) AS who(u)',
       'CROSS JOIN LATERAL (VALUES (te.player1_id), (CASE WHEN te.status <> ''convite'' THEN te.player2_id END)) AS who(u)  -- ' || c_marca || E'\n      ')
    ) AS t(sig, mau, bom)
  LOOP
    v_def := pg_get_functiondef(r.sig::regprocedure);
    IF position(c_marca IN v_def) > 0 THEN
      RAISE NOTICE '%: já estava', r.sig;
      CONTINUE;
    END IF;
    IF (length(v_def) - length(replace(v_def, r.mau, ''))) / length(r.mau) <> 1 THEN
      RAISE EXCEPTION '%: o pedaço a trocar não aparece 1 vez. Parar e ler.', r.sig;
    END IF;
    EXECUTE replace(v_def, r.mau, r.bom);
  END LOOP;
END $$;

COMMIT;

-- Verificar depois de correr (3):
--   SELECT count(*) FROM pg_proc WHERE proname IN ('tournament_tshirt_rows', 'tournament_person_tshirt', 'event_price_roster')
--      AND pg_get_functiondef(oid) LIKE '%convite por aceitar não conta (PO, 13 out)%';
