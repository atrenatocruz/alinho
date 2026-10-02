-- ═════════════════════════════════════════════════════════════════════════
-- Terminar o mix com convidados sem conta na dupla vencedora
--
-- PORQUÊ. Francisco, 2 out, 15h34, no dev.alinho.pt: «Terminar e dar os
-- pontos» deu «Não foi possível finalizar o mix» (mix «Viva», 6 duplas, cada
-- uma com um convidado sem conta). Erro: «null value in column "mix_won" of
-- relation "mix_player_stats"». Já é assim em produção desde que os
-- convidados sem conta entram nas duplas (migration_mix_guest_sem_conta).
--
-- CAUSA. «quem ganhou o mix» era «pid IN (SELECT unnest(ARRAY[player1_id,
-- player2_id]) FROM teams WHERE id = <vencedora>)». Com um convidado, um dos
-- dois é NULL, e «x IN (a, NULL)» dá NULL (não false) para quem não ganhou.
--
-- O QUE FAZ (corpo VIVO, 1 troca em cada; «já estava»):
--   · finalize_mix: won_mix passa a EXISTS (… a.pid IN (wt.player1_id,
--     wt.player2_id)), que é true ou false, nunca NULL;
--   · correct_finished_mix_match (corrigir um resultado depois de
--     terminado): o mesmo cálculo, a mesma troca.
--   O finalize_americano_mix não tem este problema (quem ganha é quem tem
--   mais pontos, nunca NULL) e não muda. Jogos, vitórias e derrotas já
--   deixavam os convidados de fora (pid IS NOT NULL) e estão certos.
--   Funciona antes e depois da migration_vouchers_so_com_conta.sql (troca
--   outro pedaço do finalize_mix).
--
-- Dev 3, 2 out 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  f     RECORD;
  v_def TEXT;
BEGIN
  FOR f IN SELECT * FROM (VALUES
      ('public.finalize_mix(uuid, uuid)',
       '\(a\.pid IN \([[:space:]]+SELECT unnest\(ARRAY\[player1_id, player2_id\]\) FROM teams WHERE id = p_winner_team_id[[:space:]]+\)\) AS won_mix',
       'EXISTS (SELECT 1 FROM teams wt
                    WHERE wt.id = p_winner_team_id AND a.pid IN (wt.player1_id, wt.player2_id)) AS won_mix',
       'wt.id = p_winner_team_id'),
      ('public.correct_finished_mix_match(uuid, integer, integer, uuid, jsonb)',
       '\(t\.pid IN \(SELECT unnest\(ARRAY\[player1_id, player2_id\]\) FROM teams WHERE id = p_new_winner_team_id\)\)',
       'EXISTS (SELECT 1 FROM teams wt
                     WHERE wt.id = p_new_winner_team_id AND t.pid IN (wt.player1_id, wt.player2_id))',
       'wt.id = p_new_winner_team_id')
    ) AS t(sig, mau, bom, marca) LOOP
    v_def := pg_get_functiondef(f.sig::regprocedure);
    IF v_def LIKE '%' || f.marca || '%' THEN
      RAISE NOTICE '%: já estava', f.sig;
      CONTINUE;
    END IF;
    IF (SELECT count(*) FROM regexp_matches(v_def, f.mau, 'g')) <> 1 THEN
      RAISE EXCEPTION '%: o pedaço a trocar não aparece 1 vez. Parar e ler.', f.sig;
    END IF;
    EXECUTE regexp_replace(v_def, f.mau, f.bom);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.finalize_mix(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_mix(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.correct_finished_mix_match(uuid, integer, integer, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correct_finished_mix_match(uuid, integer, integer, uuid, jsonb) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM pg_proc WHERE proname IN ('finalize_mix', 'correct_finished_mix_match')
--      AND pg_get_functiondef(oid) LIKE '%wt.player1_id, wt.player2_id%';  -- 2
