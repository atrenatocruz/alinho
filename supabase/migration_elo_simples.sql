-- ═════════════════════════════════════════════════════════════════════════
-- ELO SIMPLES: K 20, K 40 nos primeiros 12 jogos (só para o próprio),
-- cada um da dupla leva o mesmo, sem prémios.
-- (Ruben, 28 set 2026 — decisão a partir das simulações em RANKING.md e
--  docs/superpowers/specs/2026-09-28-elo-simples-design.md)
--
-- O QUE MUDA
--   · K = 20 para toda a gente. Quem tem menos de 12 jogos contados usa
--     K = 40 — e isso só mexe no rating DELE: os outros três no jogo movem
--     pelo K 20 deles. Acaba a fase provisória de soma zero, que subia o K
--     do jogo inteiro sempre que entrava um novato.
--   · Cada um da dupla leva exatamente o mesmo: ganharam juntos, ganham o
--     mesmo. Acaba a repartição 35/65 e o peso pelo K do parceiro.
--   · Só conta vitória, derrota ou empate. Acaba o prémio da noite (+1 %),
--     a noite perfeita (+0,5 %), a taxa por surpresa, a trava de domínio e
--     o prémio do campeão de torneio. O rating mede como se joga; o prémio
--     da noite é assunto de XP/pontos de clube.
--   · Um lugar sem conta (convidado por nome) não conta para a média nem
--     recebe nada; os outros movem normalmente. Acaba a regra «dupla com
--     convidado move metade».
--   · Chão em 0. Sem teto. Arredondamento a 2 casas por pessoa.
--
-- O QUE NÃO MUDA
--   · Quem entra e como (complete_rating_onboarding, âncoras 600–1900).
--   · Que jogos contam (finalize_mix/games.ranked, amigos com 4 aceitações e
--     sem empate, group_matches.ranked, torneios não-teste).
--   · A ordem dentro do mix/torneio, as reversões de grupo e torneio, o
--     registo em mix_player_stats / tournament_player_stats.
--   · As assinaturas: apply_elo_pairing(…, p_partner_chosen) e
--     elo_jogo_deltas(…, p_convidado) mantêm os parâmetros, agora ignorados,
--     para nada que os chama ter de mudar (confirm_private_match,
--     friend_match_apply_game, apply_group_match_ranking, recalcular_niveis).
--     apply_mix_elo(game, winner) e apply_tournament_elo(category, champion)
--     idem — o vencedor já não serve para nada, mas fica.
--
-- Deixa de ser soma zero nos jogos com um novato (o K 40 dele não é pago
-- por ninguém). Por isso recalcular_niveis.sql deixa de exigir soma zero
-- (ver esse ficheiro). Sem novatos, continua a ser soma zero por construção.
--
-- Correr à mão no SQL Editor, DEPOIS de migration_ranking_soma_zero.sql e
-- migration_549_contas_e_torneio_de_teste.sql. Recalcular o histórico com
-- recalcular_niveis(TRUE) é decisão à parte (ver o spec).
-- ═════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF to_regprocedure('apply_elo_pairing(uuid, uuid, uuid, uuid, numeric, boolean)') IS NULL THEN
    RAISE EXCEPTION 'Falta migration_ranking_soma_zero.sql (apply_elo_pairing). Correr primeiro.';
  END IF;
END $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 1. elo_jogo_deltas — a conta de um jogo 2v2, pura
-- ═════════════════════════════════════════════════════════════════════════
-- p_r[1..4]     níveis [A1, A2, B1, B2]; NULL = lugar sem conta.
-- p_jogos[1..4] jogos já contados de cada um (decide o K 40 / K 20).
-- p_s_a         resultado da dupla A: 1 ganhou, 0 perdeu, 0.5 empate.
-- p_convidado   ignorado (ficou da versão #440).
-- Devolve o delta de cada um (NULL onde não há conta), já arredondado e já
-- com o chão em 0 aplicado.
CREATE OR REPLACE FUNCTION elo_jogo_deltas(
  p_r NUMERIC[], p_jogos INTEGER[], p_s_a NUMERIC, p_convidado TEXT DEFAULT NULL)
RETURNS NUMERIC[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_out NUMERIC[] := ARRAY[NULL, NULL, NULL, NULL]::NUMERIC[];
  v_ra  NUMERIC;
  v_rb  NUMERIC;
  v_ea  NUMERIC;
  v_k   NUMERIC;
  v_s   NUMERIC;
  v_e   NUMERIC;
  v_d   NUMERIC;
  i     INTEGER;
BEGIN
  -- Um lado sem ninguém com conta, ou sem resultado: não há o que medir.
  IF (p_r[1] IS NULL AND p_r[2] IS NULL) OR (p_r[3] IS NULL AND p_r[4] IS NULL)
     OR p_s_a IS NULL OR p_s_a NOT BETWEEN 0 AND 1 THEN
    RETURN v_out;
  END IF;

  -- Nível da dupla = média de quem tem conta.
  SELECT avg(x) INTO v_ra FROM unnest(p_r[1:2]) x;
  SELECT avg(x) INTO v_rb FROM unnest(p_r[3:4]) x;
  v_ea := 1 / (1 + power(10::NUMERIC, (v_rb - v_ra) / 400));

  FOR i IN 1..4 LOOP
    CONTINUE WHEN p_r[i] IS NULL;
    v_k := CASE WHEN COALESCE(p_jogos[i], 0) < 12 THEN 40 ELSE 20 END;
    v_s := CASE WHEN i <= 2 THEN p_s_a ELSE 1 - p_s_a END;
    v_e := CASE WHEN i <= 2 THEN v_ea ELSE 1 - v_ea END;
    v_d := round(v_k * (v_s - v_e), 2);
    -- Chão em 0: nunca se perde mais do que se tem.
    IF v_d < 0 THEN
      v_d := -LEAST(-v_d, GREATEST(p_r[i], 0));
    END IF;
    v_out[i] := v_d;
  END LOOP;

  RETURN v_out;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. apply_elo_pairing — lê os 4 níveis, aplica, escreve, devolve
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION apply_elo_pairing(
  p_a1 UUID, p_a2 UUID, p_b1 UUID, p_b2 UUID, p_s_a NUMERIC,
  p_partner_chosen BOOLEAN DEFAULT TRUE)
RETURNS TABLE(pid UUID, delta NUMERIC, s NUMERIC)
LANGUAGE plpgsql
SET search_path = public
AS $$
-- p_partner_chosen: ignorado desde #440; fica pela assinatura.
DECLARE
  v_ids UUID[] := ARRAY[p_a1, p_a2, p_b1, p_b2];
  v_r   NUMERIC[] := ARRAY[NULL, NULL, NULL, NULL]::NUMERIC[];
  v_g   INTEGER[] := ARRAY[NULL, NULL, NULL, NULL]::INTEGER[];
  v_d   NUMERIC[];
  v_rat NUMERIC;
  v_jog INTEGER;
  i     INTEGER;
BEGIN
  FOR i IN 1..4 LOOP
    IF v_ids[i] IS NOT NULL THEN
      v_rat := NULL;
      v_jog := NULL;
      SELECT COALESCE(pr.rating, 900), COALESCE(pr.rating_games, 0)
        INTO v_rat, v_jog
        FROM profiles pr WHERE pr.id = v_ids[i];
      v_r[i] := v_rat;
      v_g[i] := v_jog;
    END IF;
  END LOOP;

  v_d := elo_jogo_deltas(v_r, v_g, p_s_a);

  FOR i IN 1..4 LOOP
    CONTINUE WHEN v_d[i] IS NULL;
    UPDATE profiles
       SET rating = GREATEST(0, COALESCE(rating, 900) + v_d[i]),
           rating_games = COALESCE(rating_games, 0) + 1
     WHERE id = v_ids[i];
    pid   := v_ids[i];
    delta := v_d[i];
    s     := CASE WHEN i <= 2 THEN p_s_a ELSE 1 - p_s_a END;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 3. apply_mix_elo — os jogos do mix, por ordem de ronda; nada mais
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION apply_mix_elo(p_game_id UUID, p_winner_team_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
-- p_winner_team_id: já não dá prémio; fica pela assinatura (finalize_mix,
-- finalize_americano_mix, correct_finished_mix_match, recalcular_niveis).
DECLARE
  m  RECORD;
  pl RECORD;
  v_s_a NUMERIC;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _elo_night (
    pid UUID PRIMARY KEY,
    delta NUMERIC NOT NULL DEFAULT 0,
    played INTEGER NOT NULL DEFAULT 0
  ) ON COMMIT DROP;
  TRUNCATE _elo_night;

  FOR m IN
    SELECT mt.score_a, mt.score_b, mt.winner_team_id, mt.team_a_id,
           ta.player1_id AS a1, ta.player2_id AS a2,
           tb.player1_id AS b1, tb.player2_id AS b2
      FROM matches mt
      JOIN teams ta ON ta.id = mt.team_a_id
      JOIN teams tb ON tb.id = mt.team_b_id
     WHERE mt.game_id = p_game_id
       AND mt.winner_team_id IS NOT NULL
     ORDER BY mt.round_number NULLS LAST, mt.created_at, mt.id
  LOOP
    v_s_a := CASE WHEN m.score_a IS NOT NULL AND m.score_a = m.score_b THEN 0.5
                  WHEN m.winner_team_id = m.team_a_id THEN 1
                  ELSE 0 END;
    FOR pl IN SELECT * FROM apply_elo_pairing(m.a1, m.a2, m.b1, m.b2, v_s_a, p_partner_chosen => FALSE) LOOP
      INSERT INTO _elo_night (pid, delta, played) VALUES (pl.pid, pl.delta, 1)
      ON CONFLICT (pid) DO UPDATE
        SET delta = _elo_night.delta + EXCLUDED.delta,
            played = _elo_night.played + 1;
    END LOOP;
  END LOOP;

  UPDATE mix_player_stats mps
     SET rating_delta = round(n.delta, 2),
         rating_after = round(COALESCE(pr.rating, 900), 2)
    FROM _elo_night n
    JOIN profiles pr ON pr.id = n.pid
   WHERE mps.game_id = p_game_id AND mps.user_id = n.pid AND n.played > 0;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 4. apply_tournament_elo — os jogos da categoria, por ordem; sem prémio
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION apply_tournament_elo(p_category_id UUID, p_champion_entry_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
-- p_champion_entry_id: já não dá prémio; fica pela assinatura.
DECLARE
  m  RECORD;
  pl RECORD;
  v_s_a NUMERIC;
  v_a UUID[];
  v_b UUID[];
BEGIN
  -- Torneio de teste (#549): não mexe no nível nem dá pontos a ninguém.
  IF EXISTS (SELECT 1 FROM tournament_categories tc JOIN tournaments tt ON tt.id = tc.tournament_id
              WHERE tc.id = p_category_id AND tt.is_test) THEN
    RETURN;
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _elo_torneio (
    pid UUID PRIMARY KEY,
    delta NUMERIC NOT NULL DEFAULT 0,
    played INTEGER NOT NULL DEFAULT 0,
    won INTEGER NOT NULL DEFAULT 0
  ) ON COMMIT DROP;
  TRUNCATE _elo_torneio;

  FOR m IN
    SELECT mt.id, mt.score_a, mt.score_b, mt.winner_entry_id, mt.entry_a_id,
           -- Quem esteve em campo naquele jogo; sem isso, a inscrição.
           (SELECT array_agg(p.user_id) FROM tournament_match_players p
             WHERE p.match_id = mt.id AND p.side = 'a' AND p.user_id IS NOT NULL) AS lado_a,
           (SELECT array_agg(p.user_id) FROM tournament_match_players p
             WHERE p.match_id = mt.id AND p.side = 'b' AND p.user_id IS NOT NULL) AS lado_b,
           ea.player1_id AS ea1, ea.player2_id AS ea2,
           eb.player1_id AS eb1, eb.player2_id AS eb2
      FROM tournament_matches mt
      JOIN tournament_entries ea ON ea.id = mt.entry_a_id
      JOIN tournament_entries eb ON eb.id = mt.entry_b_id
     WHERE mt.category_id = p_category_id
       AND mt.status = 'terminado'
       AND mt.winner_entry_id IS NOT NULL
     ORDER BY mt.scheduled_at NULLS LAST, mt.created_at, mt.id
  LOOP
    v_a := COALESCE(m.lado_a, array_remove(ARRAY[m.ea1, m.ea2], NULL));
    v_b := COALESCE(m.lado_b, array_remove(ARRAY[m.eb1, m.eb2], NULL));
    v_s_a := CASE WHEN m.score_a IS NOT NULL AND m.score_a = m.score_b THEN 0.5
                  WHEN m.winner_entry_id = m.entry_a_id THEN 1
                  ELSE 0 END;
    FOR pl IN SELECT * FROM apply_elo_pairing(v_a[1], v_a[2], v_b[1], v_b[2], v_s_a, p_partner_chosen => FALSE) LOOP
      INSERT INTO _elo_torneio (pid, delta, played, won)
      VALUES (pl.pid, pl.delta, 1, CASE WHEN pl.s = 1 THEN 1 ELSE 0 END)
      ON CONFLICT (pid) DO UPDATE
        SET delta  = _elo_torneio.delta + EXCLUDED.delta,
            played = _elo_torneio.played + 1,
            won    = _elo_torneio.won + EXCLUDED.won;
    END LOOP;
  END LOOP;

  INSERT INTO tournament_player_stats (category_id, user_id, entry_id, matches_played, matches_won, rating_delta, rating_after)
  SELECT p_category_id, n.pid,
         (SELECT p.entry_id FROM tournament_match_players p
            JOIN tournament_matches mm ON mm.id = p.match_id
           WHERE mm.category_id = p_category_id AND p.user_id = n.pid LIMIT 1),
         n.played, n.won, round(n.delta, 2), round(COALESCE(pr.rating, 900), 2)
    FROM _elo_torneio n JOIN profiles pr ON pr.id = n.pid
  ON CONFLICT (category_id, user_id) DO UPDATE
    SET matches_played = EXCLUDED.matches_played,
        matches_won    = EXCLUDED.matches_won,
        rating_delta   = EXCLUDED.rating_delta,
        rating_after   = EXCLUDED.rating_after;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 5. Limpeza e acessos
-- ═════════════════════════════════════════════════════════════════════════
-- Já nada as lê: as opções do #440 e a escada de K de migration_elo_entry_levels.
DROP FUNCTION IF EXISTS elo_opcoes();
DROP FUNCTION IF EXISTS elo_k_factor(INTEGER);

-- Correm com os poderes de quem as chama por dentro (finalize_mix & co. são
-- SECURITY DEFINER); estas ficam como estavam — só a app lhes chega.
REVOKE ALL ON FUNCTION elo_jogo_deltas(NUMERIC[], INTEGER[], NUMERIC, TEXT) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION apply_elo_pairing(UUID, UUID, UUID, UUID, NUMERIC, BOOLEAN) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION apply_mix_elo(UUID, UUID) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION apply_tournament_elo(UUID, UUID) FROM public, anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- CONFIRMAR (só leitura)
-- ═════════════════════════════════════════════════════════════════════════
--   SELECT elo_jogo_deltas(ARRAY[1100,1100,1100,1100], ARRAY[30,30,30,30], 1);
--     → {10.00, 10.00, -10.00, -10.00}          (K 20, E = 0.5, cada um o mesmo)
--   SELECT elo_jogo_deltas(ARRAY[1100,1100,1100,1100], ARRAY[0,30,30,30], 1);
--     → {20.00, 10.00, -10.00, -10.00}          (o novato move o dobro; os outros iguais)
--   SELECT elo_jogo_deltas(ARRAY[1200,1000,1100,1100], ARRAY[30,30,30,30], 1);
--     → {10.00, 10.00, -10.00, -10.00}          (dupla 1100 vs 1100: sem repartição)
--   SELECT elo_jogo_deltas(ARRAY[1100,NULL,1100,1100], ARRAY[30,0,30,30], 1);
--     → {10.00, NULL, -10.00, -10.00}           (lugar sem conta: ignorado)
--   SELECT elo_jogo_deltas(ARRAY[5,1800,500,500], ARRAY[30,30,30,30], 0);
--     → {-5.00, -18.21, 18.21, 18.21}           (chão em 0 para quem tem 5)
--   SELECT proname FROM pg_proc WHERE proname IN ('elo_opcoes','elo_k_factor');   -- vazio
