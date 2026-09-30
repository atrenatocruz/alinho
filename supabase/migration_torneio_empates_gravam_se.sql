-- ═════════════════════════════════════════════════════════════════════════
-- Torneio: um resultado empatado grava-se; o passo seguinte é que recusa
--
-- PORQUÊ. Francisco, 30 set (design-handoff/2026-09-28-amigos-regras-
-- francisco/REGRAS.md, ponto 4): «Temos de deixar gravar um empate… não
-- bloqueamos. Simplesmente avisamos. E salvamos e depois dizemos que não
-- podemos avançar porque temos um empate.» Substitui «Um jogo não pode
-- acabar empatado» (Renato, fa39e61). Para o Smash Cup. Ecrã: Dev 1 (pedido
-- dele, 30 set). Os mixes estão na 588 e no save_mix_match_result.
--
-- O QUE FAZ (trocas no corpo VIVO, cada uma 1 vez; «já estava»)
--   1. save_match_result: grava o empate como 'terminado' e sem vencedor
--      (winner_entry_id null). Numa categoria já terminada, recusa.
--      Corrigir para empate um jogo do quadro que já tinha vencedor tira
--      esse vencedor do jogo seguinte (e o vencido da meia do 3.º/4.º
--      lugar) — se esse jogo já foi jogado, recusa como hoje («Corrige
--      primeiro esse resultado»). Isto está em tournament_clear_advanced.
--   2. tournament_matches_result_guard: um resultado empatado passa (até 8-8
--      num pro set a 9, 1-1 em sets). O resto das regras do formato fica igual.
--   3. finish_category e fill_bracket_from_groups recusam enquanto houver
--      um jogo empatado: «Há um jogo empatado: desempata-o para continuar.»
--   A classificação dos grupos já conta um empate como jogo sem vitória; o
--   nível e os pontos só contam jogos com vencedor.
--
-- Dev 3, 30 set 2026 · ecrã: Dev 1
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1a. Tirar do quadro o vencedor de um jogo que passou a empatado ─────
CREATE OR REPLACE FUNCTION public.tournament_clear_advanced(p_match_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  m       tournament_matches;
  nm      tournament_matches;
  v_next  TEXT;
  v_slot  INTEGER;
  v_loser UUID;
  v_held  UUID;
BEGIN
  SELECT * INTO m FROM tournament_matches WHERE id = p_match_id;
  IF m.id IS NULL OR m.winner_entry_id IS NULL OR m.bracket_slot IS NULL
     OR m.stage NOT IN ('principal', 'secundario') THEN
    RETURN;
  END IF;
  v_next := CASE m.round WHEN 'R32' THEN 'R16' WHEN 'R16' THEN 'QF'
                         WHEN 'QF' THEN 'SF' WHEN 'SF' THEN 'F' ELSE NULL END;
  IF v_next IS NULL THEN RETURN; END IF;

  v_slot := ceil(m.bracket_slot / 2.0);
  SELECT * INTO nm FROM tournament_matches
   WHERE category_id = m.category_id AND stage = m.stage AND round = v_next AND bracket_slot = v_slot;
  IF nm.id IS NOT NULL THEN
    v_held := CASE WHEN m.bracket_slot % 2 = 1 THEN nm.entry_a_id ELSE nm.entry_b_id END;
    IF v_held IS NOT DISTINCT FROM m.winner_entry_id THEN
      IF nm.status IN ('terminado', 'falta', 'desistencia') THEN
        RAISE EXCEPTION 'O jogo seguinte (%) já foi jogado. Corrige primeiro esse resultado.', v_next;
      END IF;
      IF m.bracket_slot % 2 = 1 THEN
        UPDATE tournament_matches SET entry_a_id = NULL WHERE id = nm.id;
      ELSE
        UPDATE tournament_matches SET entry_b_id = NULL WHERE id = nm.id;
      END IF;
    END IF;
  END IF;

  IF m.round = 'SF' THEN
    v_loser := CASE WHEN m.winner_entry_id = m.entry_a_id THEN m.entry_b_id ELSE m.entry_a_id END;
    SELECT * INTO nm FROM tournament_matches WHERE category_id = m.category_id AND stage = '3lugar' LIMIT 1;
    IF nm.id IS NOT NULL THEN
      v_held := CASE WHEN m.bracket_slot % 2 = 1 THEN nm.entry_a_id ELSE nm.entry_b_id END;
      IF v_held IS NOT DISTINCT FROM v_loser THEN
        IF nm.status IN ('terminado', 'falta', 'desistencia') THEN
          RAISE EXCEPTION 'O jogo do 3.º e 4.º lugar já foi jogado. Corrige primeiro esse resultado.';
        END IF;
        IF m.bracket_slot % 2 = 1 THEN
          UPDATE tournament_matches SET entry_a_id = NULL WHERE id = nm.id;
        ELSE
          UPDATE tournament_matches SET entry_b_id = NULL WHERE id = nm.id;
        END IF;
      END IF;
    END IF;
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.tournament_clear_advanced(UUID) FROM PUBLIC, anon, authenticated;

-- ── Trocas no corpo vivo ────────────────────────────────────────────────
DO $$
DECLARE
  c_empate CONSTANT TEXT := 'Há um jogo empatado: desempata-o para continuar.';
  f        RECORD;
  v_def    TEXT;
BEGIN
  FOR f IN SELECT * FROM (VALUES
      -- 1. save_match_result: deixa de recusar o empate…
      ('public.save_match_result(uuid, integer, integer, jsonb)',
       'IF p_score_a = p_score_b THEN\s+RAISE EXCEPTION ''Um jogo não pode acabar empatado'';\s+END IF;',
       '-- Empates gravam-se (Francisco, 30 set): sem vencedor; o passo seguinte
  -- é que recusa. Numa categoria terminada não; no quadro, sai do jogo
  -- seguinte quem tinha passado.
  IF p_score_a = p_score_b THEN
    IF (SELECT status FROM tournament_categories WHERE id = m.category_id) = ''terminada'' THEN
      RAISE EXCEPTION ''' || c_empate || ''';
    END IF;
    PERFORM tournament_clear_advanced(p_match_id);
  END IF;',
       'tournament_clear_advanced'),
      -- …e grava-o sem vencedor.
      ('public.save_match_result(uuid, integer, integer, jsonb)',
       'v_winner := CASE WHEN p_score_a > p_score_b THEN m\.entry_a_id ELSE m\.entry_b_id END;',
       'v_winner := CASE WHEN p_score_a > p_score_b THEN m.entry_a_id
                    WHEN p_score_b > p_score_a THEN m.entry_b_id END;',
       'WHEN p_score_b > p_score_a THEN m.entry_b_id'),
      -- 2. A trava do formato deixa passar o empate que o formato permite
      --    (até 8-8 num pro set a 9; 0-0 ou 1-1 em sets).
      ('public.tournament_matches_result_guard()',
       'IF v_hi <> v_n OR v_lo > v_n - 1 THEN',
       'IF (v_hi <> v_n OR v_lo > v_n - 1) AND NOT (v_hi = v_lo AND v_hi < v_n) THEN',
       'NOT (v_hi = v_lo AND v_hi < v_n)'),
      ('public.tournament_matches_result_guard()',
       'IF v_hi <> 2 OR v_lo > 1 THEN',
       'IF (v_hi <> 2 OR v_lo > 1) AND NOT (v_hi = v_lo AND v_hi <= 1) THEN',
       'NOT (v_hi = v_lo AND v_hi <= 1)'),
      -- 3. Terminar a categoria…
      ('public.finish_category(uuid, uuid, uuid, uuid)',
       '(SELECT \* INTO v_final FROM tournament_matches)',
       'IF EXISTS (SELECT 1 FROM tournament_matches
              WHERE category_id = p_category_id AND status = ''terminado''
                AND winner_entry_id IS NULL AND score_a = score_b) THEN
    RAISE EXCEPTION ''' || c_empate || ''';
  END IF;

  \1',
       'desempata-o'),
      -- …e passar os grupos ao quadro.
      ('public.fill_bracket_from_groups(uuid, jsonb)',
       '(RAISE EXCEPTION ''Ainda há jogos de grupo por acabar'';\s+END IF;)',
       '\1
  IF EXISTS (SELECT 1 FROM tournament_matches
              WHERE category_id = p_category_id AND stage = ''grupo'' AND status = ''terminado''
                AND winner_entry_id IS NULL AND score_a = score_b) THEN
    RAISE EXCEPTION ''' || c_empate || ''';
  END IF;',
       'desempata-o')
    ) AS t(sig, mau, bom, marca) LOOP
    v_def := pg_get_functiondef(f.sig::regprocedure);
    IF v_def LIKE '%' || f.marca || '%' THEN
      RAISE NOTICE '%: já estava (%)', f.sig, left(f.marca, 30);
      CONTINUE;
    END IF;
    IF (SELECT count(*) FROM regexp_matches(v_def, f.mau, 'g')) <> 1 THEN
      RAISE EXCEPTION '%: o pedaço a trocar não aparece 1 vez. Parar e ler.', f.sig;
    END IF;
    EXECUTE regexp_replace(v_def, f.mau, f.bom);
  END LOOP;
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.save_match_result(uuid,integer,integer,jsonb)'::regprocedure) LIKE '%não pode acabar empatado%';  -- false
--   SELECT count(*) FROM pg_proc WHERE proname IN ('finish_category', 'fill_bracket_from_groups')
--      AND pg_get_functiondef(oid) LIKE '%desempata-o%';  -- 2
