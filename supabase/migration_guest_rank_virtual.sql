-- ════════════════════════════════════════════════════════════════════════
-- RATING VIRTUAL DOS CONVIDADOS SEM CONTA (decisão Ruben, 2 out 2026)
--
-- ANTES: o lugar de um convidado era NULL no Elo — a dupla valia só o
-- parceiro com conta, e uma dupla 100% convidados anulava a medição do
-- jogo para toda a gente (os adversários, sem culpa, ficavam sem Elo
-- dessa partida).
--
-- AGORA: para EFEITOS DE CÁLCULO, um convidado vale:
--   1. a MÉDIA do rating dos jogadores com conta do mix (se houver ≥ 2);
--   2. senão, o ponto médio da banda do nível do mix (games.level):
--      *6 → 850 · *5 → 1100 · *4 → 1300 · *3 → 1500 · *2 → 1700 · *1 → 1900;
--   3. senão (mix sem nível), 900 — o baseline histórico.
-- O convidado continua sem receber delta nenhum (não tem conta); o valor
-- virtual serve só para a média da dupla, a expectativa dos adversários,
-- o emparelhamento e o seed dos campos. Assim todos os jogos medem, e
-- ninguém é beneficiado/prejudicado por jogar com ou contra convidados.
--
-- Fora do âmbito: torneios e amigáveis mantêm a semântica NULL de
-- migration_elo_simples.sql (o parâmetro novo tem DEFAULT NULL).
--
-- Inclui o comportamento de migration_mix_arranque_com_duplas_sorteadas
-- (Dev 3, 2 out) no corpo do start_due_mixes — o patch dele deteta
-- «já estava» e não duplica, em qualquer ordem de execução.
--
-- Pré-requisitos: migration_mix_guest_sem_conta.sql e migration_elo_simples.
-- Correr este ficheiro inteiro no Supabase → SQL Editor. Transação única.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. O valor virtual de um convidado num mix ───────────────────────────
CREATE OR REPLACE FUNCTION mix_guest_rating(p_game_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_avg   NUMERIC;
  v_n     INTEGER;
  v_level TEXT;
  v_band  INTEGER;
BEGIN
  -- Média dos jogadores COM CONTA inscritos (titulares e parceiros).
  SELECT avg(pr.rating), count(*)
    INTO v_avg, v_n
    FROM (
      SELECT p.user_id AS uid FROM participants p
       WHERE p.game_id = p_game_id AND p.status = 'confirmed' AND p.user_id IS NOT NULL
      UNION ALL
      SELECT p.partner_id FROM participants p
       WHERE p.game_id = p_game_id AND p.status = 'confirmed' AND p.partner_id IS NOT NULL
    ) x
    JOIN profiles pr ON pr.id = x.uid AND pr.rating IS NOT NULL;
  IF v_n >= 2 THEN
    RETURN round(v_avg);
  END IF;

  -- Sem média calibrável: o ponto médio da banda do nível do mix.
  SELECT g.level INTO v_level FROM games g WHERE g.id = p_game_id;
  v_band := NULLIF(substring(lower(COALESCE(v_level, '')) FROM '[1-6]$'), '')::INTEGER;
  RETURN CASE v_band
    WHEN 1 THEN 1900
    WHEN 2 THEN 1700
    WHEN 3 THEN 1500
    WHEN 4 THEN 1300
    WHEN 5 THEN 1100
    WHEN 6 THEN 850
    ELSE 900
  END;
END;
$$;
REVOKE ALL ON FUNCTION mix_guest_rating(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION mix_guest_rating(UUID) TO authenticated;

-- ── 2. apply_elo_pairing aprende o valor virtual ─────────────────────────
-- Assinatura nova (parâmetro extra) → não dá para CREATE OR REPLACE sem
-- criar um overload ambíguo: apaga-se a de 6 argumentos primeiro. Os
-- chamadores existentes (confirm_private_match, apply_tournament_elo,
-- recalcular_*) chamam com 6 posicionais e caem no DEFAULT NULL = a
-- semântica antiga (lugar sem conta não conta).
DROP FUNCTION IF EXISTS apply_elo_pairing(UUID, UUID, UUID, UUID, NUMERIC, BOOLEAN);

CREATE FUNCTION apply_elo_pairing(
  p_a1 UUID, p_a2 UUID, p_b1 UUID, p_b2 UUID, p_s_a NUMERIC,
  p_partner_chosen BOOLEAN DEFAULT TRUE,
  p_guest_rating NUMERIC DEFAULT NULL)
RETURNS TABLE(pid UUID, delta NUMERIC, s NUMERIC)
LANGUAGE plpgsql
SET search_path = public
AS $$
-- p_partner_chosen: ignorado desde #440; fica pela assinatura.
-- p_guest_rating: o valor virtual de um lugar SEM conta (convidado de mix)
-- — entra na média da dupla e na expectativa, mas esse lugar nunca recebe
-- delta (só se aplica/devolve para ids não-nulos, como sempre). NULL =
-- semântica antiga (lugar vazio não conta).
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
    ELSIF p_guest_rating IS NOT NULL THEN
      v_r[i] := p_guest_rating;
    END IF;
  END LOOP;

  v_d := elo_jogo_deltas(v_r, v_g, p_s_a);

  FOR i IN 1..4 LOOP
    CONTINUE WHEN v_d[i] IS NULL OR v_ids[i] IS NULL;
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

-- ── 3. apply_mix_elo passa o valor virtual do mix ────────────────────────
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
  v_guest NUMERIC;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _elo_night (
    pid UUID PRIMARY KEY,
    delta NUMERIC NOT NULL DEFAULT 0,
    played INTEGER NOT NULL DEFAULT 0
  ) ON COMMIT DROP;
  TRUNCATE _elo_night;

  -- O valor virtual dos convidados deste mix (média dos jogadores com
  -- conta; senão a banda do nível; senão 900) — uma vez por mix.
  v_guest := mix_guest_rating(p_game_id);

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
    FOR pl IN SELECT * FROM apply_elo_pairing(m.a1, m.a2, m.b1, m.b2, v_s_a,
                                              p_partner_chosen => FALSE,
                                              p_guest_rating => v_guest) LOOP
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

-- ── 4. start_due_mixes: convidados emparelham e semeiam com o virtual ────
-- Base: migration_mix_guest_sem_conta.sql + o bloco das duplas sorteadas
-- (migration_mix_arranque_com_duplas_sorteadas, Dev 3). Mudanças: pts do
-- convidado = mix_guest_rating (era 900) e o seed soma esses pontos (cai a
-- regra «herda o parceiro»).
CREATE OR REPLACE FUNCTION start_due_mixes()
RETURNS INTEGER AS $$
DECLARE
  v_game RECORD;
  v_tem_bot BOOLEAN;
  v_capacidade INT;
  v_pessoas INT;
  v_guest INT;
  v_pares_recentes TEXT[];
  v_solos UUID[];
  v_lados TEXT[];
  v_guest_flags BOOLEAN[];
  v_pontos INT[];
  v_duplas INT := 0;
  v_arrancados INT := 0;
  a UUID;    a_lado TEXT;  a_guest BOOLEAN;  a_pts INT;
  b UUID;    b_guest BOOLEAN;                b_pts INT;
  i INT;
  escolhido INT;
BEGIN
  FOR v_game IN
    SELECT g.*
    FROM games g
    WHERE g.auto_start_hours_before IS NOT NULL
      AND g.status IN ('open', 'closed')
      AND g.date > now()
      AND g.date <= now() + (g.auto_start_hours_before || ' hours')::interval
      AND COALESCE(g.format, 'sobe_desce') IN ('sobe_desce', 'todos_contra_todos')
      AND NOT COALESCE(g.rotate_partners, FALSE)
      AND COALESCE(g.pairing_mode, 'por_nivel') = 'por_nivel'
      AND COALESCE(g.origin, 'admin') <> 'open_slot'
  LOOP
    v_capacidade := COALESCE(v_game.max_players, COALESCE(v_game.num_courts, 1) * 4);
    SELECT COALESCE(SUM(1 + CASE WHEN partner_id IS NOT NULL OR partner_guest_id IS NOT NULL THEN 1 ELSE 0 END), 0)
      INTO v_pessoas
      FROM participants WHERE game_id = v_game.id AND status = 'confirmed';
    CONTINUE WHEN v_pessoas < v_capacidade;

    SELECT EXISTS (SELECT 1 FROM whatsapp_groups w WHERE w.organization_id = v_game.organization_id)
      INTO v_tem_bot;
    CONTINUE WHEN v_tem_bot
      AND v_game.date > now() + ((v_game.auto_start_hours_before * 60 - 15) || ' minutes')::interval;

    -- Duplas já sorteadas por quem organiza (2 out): começa com essas, sem
    -- sortear outras por cima. Com um lugar vazio, ou só 1 dupla, espera.
    IF EXISTS (SELECT 1 FROM teams WHERE game_id = v_game.id) THEN
      CONTINUE WHEN (SELECT count(*) FROM teams WHERE game_id = v_game.id) < 2
        OR EXISTS (SELECT 1 FROM teams t WHERE t.game_id = v_game.id
                    AND ((t.player1_id IS NULL AND t.player1_guest_id IS NULL)
                      OR (t.player2_id IS NULL AND t.player2_guest_id IS NULL)));
      UPDATE games SET status = 'in_progress', updated_at = NOW() WHERE id = v_game.id;
      v_arrancados := v_arrancados + 1;
      CONTINUE;
    END IF;

    -- O valor virtual dos convidados deste mix (Ruben, 2 out).
    v_guest := mix_guest_rating(v_game.id)::INT;

    -- Pares dos últimos 4 mixes (convidados têm id por jogo — nunca
    -- repetem entre mixes, o COALESCE é só para não gerar NULLs).
    SELECT COALESCE(array_agg(
             least(COALESCE(t.player1_id, t.player1_guest_id)::text,
                   COALESCE(t.player2_id, t.player2_guest_id)::text) || '|' ||
             greatest(COALESCE(t.player1_id, t.player1_guest_id)::text,
                      COALESCE(t.player2_id, t.player2_guest_id)::text)), '{}')
      INTO v_pares_recentes
      FROM teams t
     WHERE t.game_id IN (
       SELECT id FROM games
       WHERE organization_id = v_game.organization_id AND date < v_game.date
       ORDER BY date DESC LIMIT 4
     );

    -- Duplas escolhidas pelos jogadores: ficam como estão; o lugar de um
    -- convidado vale o virtual no seed.
    INSERT INTO teams (game_id, player1_id, player1_guest_id, player2_id, player2_guest_id, seed_ranking)
    SELECT v_game.id, p.user_id, p.guest_id, p.partner_id, p.partner_guest_id,
           (CASE WHEN p.user_id IS NOT NULL THEN COALESCE(pr1.rating, 0)::int ELSE v_guest END)
         + (CASE WHEN p.partner_id IS NOT NULL THEN COALESCE(pr2.rating, 0)::int ELSE v_guest END)
      FROM participants p
      LEFT JOIN profiles pr1 ON pr1.id = p.user_id
      LEFT JOIN profiles pr2 ON pr2.id = p.partner_id
     WHERE p.game_id = v_game.id AND p.status = 'confirmed'
       AND (p.partner_id IS NOT NULL OR p.partner_guest_id IS NOT NULL);
    GET DIAGNOSTICS v_duplas = ROW_COUNT;

    -- Solos por pontos (convidado = virtual, lado 'both'). O desempate por
    -- pid garante a MESMA permutação nos quatro arrays paralelos.
    SELECT COALESCE(array_agg(x.pid  ORDER BY x.pts DESC, x.pid), '{}'),
           COALESCE(array_agg(x.lado ORDER BY x.pts DESC, x.pid), '{}'),
           COALESCE(array_agg(x.eh_convidado ORDER BY x.pts DESC, x.pid), '{}'),
           COALESCE(array_agg(x.pts  ORDER BY x.pts DESC, x.pid), '{}')
      INTO v_solos, v_lados, v_guest_flags, v_pontos
      FROM (
        SELECT COALESCE(p.user_id, p.guest_id) AS pid,
               CASE WHEN p.user_id IS NULL THEN 'both'
                    ELSE COALESCE(pr.preferred_side, 'both') END AS lado,
               (p.user_id IS NULL) AS eh_convidado,
               CASE WHEN p.user_id IS NULL THEN v_guest
                    ELSE COALESCE(pr.rating, 0)::int END AS pts
          FROM participants p
          LEFT JOIN profiles pr ON pr.id = p.user_id
         WHERE p.game_id = v_game.id AND p.status = 'confirmed'
           AND p.partner_id IS NULL AND p.partner_guest_id IS NULL
      ) x;

    WHILE array_length(v_solos, 1) >= 2 LOOP
      a := v_solos[1];  a_lado := v_lados[1];  a_guest := v_guest_flags[1];  a_pts := v_pontos[1];
      v_solos := v_solos[2:];  v_lados := v_lados[2:];
      v_guest_flags := v_guest_flags[2:];  v_pontos := v_pontos[2:];

      escolhido := 0;
      FOR i IN 1..array_length(v_solos, 1) LOOP
        IF NOT (least(a::text, v_solos[i]::text) || '|' || greatest(a::text, v_solos[i]::text) = ANY (v_pares_recentes))
           AND (a_lado = 'both' OR v_lados[i] = 'both' OR a_lado <> v_lados[i]) THEN
          escolhido := i;
          EXIT;
        END IF;
      END LOOP;

      IF escolhido = 0 THEN
        FOR i IN 1..array_length(v_solos, 1) LOOP
          IF NOT (least(a::text, v_solos[i]::text) || '|' || greatest(a::text, v_solos[i]::text) = ANY (v_pares_recentes)) THEN
            escolhido := i;
            EXIT;
          END IF;
        END LOOP;
      END IF;

      IF escolhido = 0 THEN escolhido := 1; END IF;

      b := v_solos[escolhido];  b_guest := v_guest_flags[escolhido];  b_pts := v_pontos[escolhido];
      v_solos  := v_solos[1:escolhido-1]  || v_solos[escolhido+1:];
      v_lados  := v_lados[1:escolhido-1]  || v_lados[escolhido+1:];
      v_guest_flags := v_guest_flags[1:escolhido-1] || v_guest_flags[escolhido+1:];
      v_pontos := v_pontos[1:escolhido-1] || v_pontos[escolhido+1:];

      INSERT INTO teams (game_id, player1_id, player1_guest_id, player2_id, player2_guest_id, seed_ranking)
      VALUES (v_game.id,
              CASE WHEN a_guest THEN NULL ELSE a END,
              CASE WHEN a_guest THEN a END,
              CASE WHEN b_guest THEN NULL ELSE b END,
              CASE WHEN b_guest THEN b END,
              a_pts + b_pts);
      v_duplas := v_duplas + 1;
    END LOOP;

    IF v_duplas < 2 THEN
      DELETE FROM teams WHERE game_id = v_game.id;
      CONTINUE;
    END IF;

    UPDATE games SET status = 'in_progress', updated_at = NOW() WHERE id = v_game.id;
    v_arrancados := v_arrancados + 1;
  END LOOP;

  RETURN v_arrancados;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION start_due_mixes() FROM public, anon, authenticated;

COMMIT;

-- ── Verificação pós-migração ─────────────────────────────────────────────
-- SELECT to_regprocedure('mix_guest_rating(uuid)');                    -- não-nulo
-- SELECT to_regprocedure('apply_elo_pairing(uuid,uuid,uuid,uuid,numeric,boolean,numeric)'); -- não-nulo
-- SELECT to_regprocedure('apply_elo_pairing(uuid,uuid,uuid,uuid,numeric,boolean)');         -- NULO (sem overload)
-- Num mix de teste M6 só com 1 conta: SELECT mix_guest_rating('<id>'); -- 850
