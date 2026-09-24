-- ════════════════════════════════════════════════════════════════════════
-- TORNEIOS, PARTE 7: FECHAR A CATEGORIA, O PÓDIO E OS PONTOS
-- (Dev 3, 23 set 2026) — cartões #364 e #365.
--
-- CORRER DEPOIS de `migration_tournaments_base.sql` e
-- `migration_tournaments_draw.sql`. Pode-se correr outra vez sem estragar.
--
-- O QUE FALTAVA: jogava-se a final e não acontecia nada. A categoria nunca
-- chegava a `terminada`, o ecrã do pódio chamava uma função que não
-- existia, e ganhar um torneio não dava um único ponto a ninguém.
--
-- AS CONTAS DO RANKING SÃO AS DOS MIXES, copiadas linha a linha do
-- `apply_mix_elo` (migration_elo_rating.sql): média da dupla, fórmula de
-- Elo, K por número de jogos (40 / 30 / 20), redistribuição entre parceiros
-- entre 35% e 65% (numa vitória o mais fraco leva a maior fatia), e o bónus
-- de mérito de 1% aos vencedores, pago pelos outros participantes na
-- proporção do rating — nunca soma-positiva.
--
-- Não se reaproveita a função do mix porque ela lê as tabelas do mix
-- (`matches`, `teams`); o torneio tem as suas. Se um dia as contas do mix
-- mudarem, MUDA-SE AQUI TAMBÉM — está dito aqui e lá.
--
-- DECIDIDO PELO FRANCISCO:
--   · os jogos de torneio contam para o ranking (23 set);
--   · faltas e desistências NÃO contam — o adversário ganha o jogo, mas o
--     ranking não se mexe (21 set). Por isso só entram os `terminado`.
--   · a soma dos pontos so fecha a zero entre jogadores com o mesmo K
--     (o K desce com a experiencia: 40, 30, 20). Entre experiencias
--     diferentes ha sempre uma pequena deriva -- e herdado da formula dos
--     mixes e nao se corrige aqui sozinho.
--   · o ranking aplica-se ao FECHAR a categoria, não a cada jogo: se
--     mexesse a cada jogo, o nível das pessoas mudava a meio do torneio e
--     as cabeças de série deixavam de fazer sentido.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. O que cada pessoa levou da categoria ─────────────────────────────
-- O equivalente ao `mix_player_stats`: é o que deixa o pódio dizer «o que
-- cada um levou» e o que permite desfazer uma correção mais tarde sem
-- adivinhar.
CREATE TABLE IF NOT EXISTS tournament_player_stats (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id     UUID NOT NULL REFERENCES tournament_categories(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  entry_id        UUID REFERENCES tournament_entries(id) ON DELETE SET NULL,
  matches_played  INTEGER NOT NULL DEFAULT 0,
  matches_won     INTEGER NOT NULL DEFAULT 0,
  rating_delta    NUMERIC(7,2),
  rating_after    NUMERIC(7,2),
  final_position  INTEGER,          -- 1, 2, 3 — só para quem subiu ao pódio
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (category_id, user_id)
);

ALTER TABLE tournament_player_stats ENABLE ROW LEVEL SECURITY;

-- Ninguém escreve daqui: quem escreve é o `finish_category`, que é
-- SECURITY DEFINER e já verifica quem está a chamar.
REVOKE INSERT, UPDATE, DELETE ON tournament_player_stats FROM authenticated, anon;
-- Sem este GRANT a politica de leitura era letra morta: nem o proprio
-- jogador nem o admin do clube conseguiam ler as suas estatisticas.
GRANT SELECT ON tournament_player_stats TO authenticated;

DROP POLICY IF EXISTS "tournament stats sao minhas ou do meu clube" ON tournament_player_stats;
CREATE POLICY "tournament stats sao minhas ou do meu clube"
  ON tournament_player_stats FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_tournament_admin(tournament_of_category(category_id)));

-- ── 2. Os pontos de ranking da categoria ────────────────────────────────
CREATE OR REPLACE FUNCTION apply_tournament_elo(p_category_id UUID, p_champion_entry_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m RECORD;
  pl RECORD;
  v_r_a NUMERIC;
  v_r_b NUMERIC;
  v_e_a NUMERIC;
  v_s_a NUMERIC;
  v_w NUMERIC;
  v_share NUMERIC;
  v_k INTEGER;
  v_delta NUMERIC;
  v_had_matches BOOLEAN := FALSE;
  v_bonus_total NUMERIC;
  v_payer_rating_sum NUMERIC;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _elo_torneio (
    pid UUID PRIMARY KEY,
    delta NUMERIC NOT NULL DEFAULT 0,
    played INTEGER NOT NULL DEFAULT 0,
    won INTEGER NOT NULL DEFAULT 0,
    bonus NUMERIC NOT NULL DEFAULT 0
  ) ON COMMIT DROP;
  TRUNCATE _elo_torneio;

  FOR m IN
    SELECT mt.score_a, mt.score_b, mt.winner_entry_id, mt.entry_a_id,
           ea.player1_id AS a1, ea.player2_id AS a2,
           eb.player1_id AS b1, eb.player2_id AS b2
    FROM tournament_matches mt
    JOIN tournament_entries ea ON ea.id = mt.entry_a_id
    JOIN tournament_entries eb ON eb.id = mt.entry_b_id
    WHERE mt.category_id = p_category_id
      -- Só jogos JOGADOS: a falta de comparência e a desistência dão o jogo
      -- ao adversário mas não mexem no ranking (Francisco, 21 set).
      AND mt.status = 'terminado'
      AND mt.winner_entry_id IS NOT NULL
    ORDER BY mt.scheduled_at NULLS LAST, mt.created_at, mt.id
  LOOP
    v_had_matches := TRUE;

    SELECT AVG(COALESCE(pr.rating, 900)) INTO v_r_a
    FROM unnest(ARRAY[m.a1, m.a2]) AS pid
    JOIN profiles pr ON pr.id = pid;
    SELECT AVG(COALESCE(pr.rating, 900)) INTO v_r_b
    FROM unnest(ARRAY[m.b1, m.b2]) AS pid
    JOIN profiles pr ON pr.id = pid;
    -- Dupla só com parceiro sem conta: conta o jogador que existe. Se
    -- nenhum dos dois tiver conta, não há nada que pontuar.
    IF v_r_a IS NULL OR v_r_b IS NULL THEN
      CONTINUE;
    END IF;

    v_s_a := CASE
      WHEN m.score_a IS NOT NULL AND m.score_a = m.score_b THEN 0.5
      WHEN m.winner_entry_id = m.entry_a_id THEN 1
      ELSE 0
    END;
    v_e_a := 1 / (1 + power(10::numeric, (v_r_b - v_r_a) / 400));

    FOR pl IN
      SELECT t.pid,
             CASE WHEN t.is_a THEN v_s_a ELSE 1 - v_s_a END AS s,
             CASE WHEN t.is_a THEN v_e_a ELSE 1 - v_e_a END AS e,
             COALESCE(pr.rating, 900) AS r,
             pr.rating_games,
             (SELECT COALESCE(pr2.rating, 900) FROM profiles pr2 WHERE pr2.id = t.partner) AS partner_r
      FROM (VALUES (m.a1, m.a2, TRUE), (m.a2, m.a1, TRUE),
                   (m.b1, m.b2, FALSE), (m.b2, m.b1, FALSE)) AS t(pid, partner, is_a)
      JOIN profiles pr ON pr.id = t.pid
    LOOP
      IF pl.partner_r IS NULL THEN
        -- Parceiro sem conta: este jogador E a dupla toda, e leva o
        -- movimento todo dela (fatia 1, nao 0,5).
        --
        -- ATENCAO, E DIFERENTE DO MIX: la a fatia fica em 0,5 e o jogador
        -- leva METADE do que a dupla adversaria mexe -- a diferenca nao e
        -- paga por ninguem, por isso CRIAM-SE pontos do nada nesses jogos
        -- (medido: +14,93 num jogo so). No Smash Cup muitas duplas trazem
        -- parceiro sem conta, e o ranking e um bolo que se reparte, nao um
        -- poco sem fundo. O mix tem o mesmo defeito e devia ser corrigido
        -- do mesmo modo -- mas isso e o motor dos mixes, nao se mexe a 16
        -- dias do torneio.
        v_share := 1;
      ELSIF pl.s = 0.5 THEN
        v_share := 0.5;
      ELSE
        v_w := LEAST(0.65, GREATEST(0.35, pl.partner_r / NULLIF(pl.r + pl.partner_r, 0)));
        v_w := COALESCE(v_w, 0.5);
        v_share := CASE WHEN pl.s = 1 THEN v_w ELSE 1 - v_w END;
      END IF;

      v_k := CASE WHEN pl.rating_games < 5 THEN 40
                  WHEN pl.rating_games < 20 THEN 30
                  ELSE 20 END;

      v_delta := v_k * (pl.s - pl.e) * v_share * 2;

      UPDATE profiles
      SET rating = GREATEST(0, COALESCE(rating, 900) + v_delta),
          rating_games = rating_games + 1
      WHERE id = pl.pid;

      INSERT INTO _elo_torneio (pid, delta, played, won)
      VALUES (pl.pid, v_delta, 1, CASE WHEN pl.s = 1 THEN 1 ELSE 0 END)
      ON CONFLICT (pid) DO UPDATE
      SET delta = _elo_torneio.delta + EXCLUDED.delta,
          played = _elo_torneio.played + 1,
          won = _elo_torneio.won + EXCLUDED.won;
    END LOOP;
  END LOOP;

  -- ── Bónus de mérito ───────────────────────────────────────────────────
  -- Igual ao mix: 1% do próprio rating à dupla vencedora, +0,5% a quem
  -- ganhou todos os jogos que fez, pago pelos outros participantes na
  -- proporção do rating. Sem pagadores, não há bónus.
  IF v_had_matches AND p_champion_entry_id IS NOT NULL THEN
    UPDATE _elo_torneio n
    SET bonus = (CASE WHEN n.pid IN (SELECT unnest(ARRAY[player1_id, player2_id])
                                     FROM tournament_entries WHERE id = p_champion_entry_id)
                      THEN 0.01 ELSE 0 END
               + CASE WHEN n.played > 0 AND n.won = n.played THEN 0.005 ELSE 0 END)
              * COALESCE((SELECT pr.rating FROM profiles pr WHERE pr.id = n.pid), 900);

    SELECT COALESCE(SUM(bonus), 0) INTO v_bonus_total FROM _elo_torneio WHERE bonus > 0;
    SELECT COALESCE(SUM(COALESCE(pr.rating, 900)), 0) INTO v_payer_rating_sum
    FROM _elo_torneio n JOIN profiles pr ON pr.id = n.pid
    WHERE n.bonus = 0;

    IF v_bonus_total > 0 AND v_payer_rating_sum > 0 THEN
      UPDATE _elo_torneio n
      SET bonus = - v_bonus_total * COALESCE(pr.rating, 900) / v_payer_rating_sum
      FROM profiles pr
      WHERE pr.id = n.pid AND n.bonus = 0;

      UPDATE _elo_torneio SET delta = delta + bonus WHERE TRUE;  -- WHERE TRUE: o pg_safeupdate recusa UPDATE sem WHERE (ver migration_fix_tournament_elo_safeupdate.sql)

      UPDATE profiles pr
      SET rating = GREATEST(0, COALESCE(pr.rating, 900) + n.bonus)
      FROM _elo_torneio n
      WHERE pr.id = n.pid;
    END IF;
  END IF;

  -- O que cada um levou, para o pódio e para se poder desfazer depois.
  INSERT INTO tournament_player_stats (category_id, user_id, entry_id, matches_played, matches_won, rating_delta, rating_after)
  SELECT p_category_id, n.pid,
         (SELECT e.id FROM tournament_entries e
           WHERE e.category_id = p_category_id
             AND (e.player1_id = n.pid OR e.player2_id = n.pid) LIMIT 1),
         n.played, n.won, ROUND(n.delta, 2), ROUND(COALESCE(pr.rating, 900), 2)
  FROM _elo_torneio n JOIN profiles pr ON pr.id = n.pid
  ON CONFLICT (category_id, user_id) DO UPDATE
  SET matches_played = EXCLUDED.matches_played,
      matches_won = EXCLUDED.matches_won,
      rating_delta = EXCLUDED.rating_delta,
      rating_after = EXCLUDED.rating_after;
END;
$$;

REVOKE ALL ON FUNCTION apply_tournament_elo(UUID, UUID) FROM public, anon, authenticated;

-- ── 3. Fechar a categoria ───────────────────────────────────────────────
-- Joga-se a final e o organizador fecha. A app confirma que não falta
-- nenhum resultado, decide o pódio, dá os pontos, e só então tranca.
CREATE OR REPLACE FUNCTION finish_category(p_category_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tournament UUID;
  v_status     TEXT;
  v_falta      INTEGER;
  v_final      tournament_matches;
  v_third      tournament_matches;
  v_champion   UUID;
  v_runner_up  UUID;
  v_third_id   UUID;
BEGIN
  v_tournament := tournament_of_category(p_category_id);
  IF v_tournament IS NULL THEN
    RAISE EXCEPTION 'Categoria não encontrada';
  END IF;
  IF NOT is_tournament_admin(v_tournament) THEN
    RAISE EXCEPTION 'Só um admin do clube pode fechar a categoria'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT status INTO v_status FROM tournament_categories WHERE id = p_category_id;
  IF v_status = 'terminada' THEN
    RAISE EXCEPTION 'Esta categoria já está fechada';
  END IF;
  IF v_status NOT IN ('sorteada','a_decorrer') THEN
    RAISE EXCEPTION 'Esta categoria ainda não foi sorteada';
  END IF;

  -- Falta algum resultado? Só contam os jogos que já têm as duas duplas —
  -- um lugar do quadro que nunca chegou a ser preenchido não trava nada.
  SELECT count(*) INTO v_falta
    FROM tournament_matches m
   WHERE m.category_id = p_category_id
     AND m.entry_a_id IS NOT NULL AND m.entry_b_id IS NOT NULL
     AND m.status IN ('marcado','a_decorrer');
  IF v_falta > 0 THEN
    IF v_falta = 1 THEN
      RAISE EXCEPTION 'Ainda falta 1 jogo por marcar nesta categoria';
    END IF;
    RAISE EXCEPTION 'Ainda faltam % jogos por marcar nesta categoria', v_falta;
  END IF;

  -- O pódio sai da final e do jogo de 3.º e 4.º.
  SELECT * INTO v_final FROM tournament_matches
   WHERE category_id = p_category_id AND stage = 'principal' AND round = 'F'
   ORDER BY bracket_slot LIMIT 1;
  IF v_final.id IS NULL OR v_final.winner_entry_id IS NULL THEN
    RAISE EXCEPTION 'A final ainda não foi jogada';
  END IF;

  v_champion := v_final.winner_entry_id;
  v_runner_up := CASE WHEN v_final.entry_a_id = v_champion
                      THEN v_final.entry_b_id ELSE v_final.entry_a_id END;

  SELECT * INTO v_third FROM tournament_matches
   WHERE category_id = p_category_id AND stage = '3lugar' LIMIT 1;
  v_third_id := v_third.winner_entry_id;

  -- Os pontos. Isto mexe no ranking das pessoas e só acontece aqui.
  PERFORM apply_tournament_elo(p_category_id, v_champion);

  -- Quem subiu ao pódio, para o ecrã do fim e para o histórico.
  UPDATE tournament_player_stats s
     SET final_position = CASE WHEN s.entry_id = v_champion THEN 1
                               WHEN s.entry_id = v_runner_up THEN 2
                               WHEN s.entry_id = v_third_id THEN 3 END
   WHERE s.category_id = p_category_id;

  UPDATE tournament_categories SET status = 'terminada' WHERE id = p_category_id;

  -- O torneio acaba quando a última categoria acaba.
  UPDATE tournaments SET status = 'terminado'
   WHERE id = v_tournament
     AND NOT EXISTS (SELECT 1 FROM tournament_categories c
                      WHERE c.tournament_id = v_tournament AND c.status <> 'terminada');

  RETURN jsonb_build_object(
    'champion', v_champion, 'runner_up', v_runner_up, 'third', v_third_id,
    'players_rated', (SELECT count(*) FROM tournament_player_stats WHERE category_id = p_category_id));
END;
$$;

-- ── 4. O pódio, para o ecrã do fim ──────────────────────────────────────
-- Abre sem conta, como o resto da página. Nomes sim; pontos de ranking
-- NÃO — o que cada um ganhou ou perdeu no ranking é do próprio, e vê-se no
-- perfil dele, não numa página que qualquer um abre.
CREATE OR REPLACE FUNCTION get_tournament_results(p_tournament TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH t AS (
    SELECT * FROM tournament_public
    WHERE slug = p_tournament
       OR id = (CASE WHEN p_tournament ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                     THEN p_tournament END)::uuid
    LIMIT 1
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM t) THEN NULL ELSE jsonb_build_object(
    'tournament', (SELECT to_jsonb(t) FROM t),
    'categories', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.position, x.code) FROM (
        SELECT c.id, c.code, c.name, c.position, c.status,
               tournament_team_json((SELECT m.winner_entry_id FROM tournament_matches m
                                      WHERE m.category_id = c.id AND m.stage = 'principal'
                                        AND m.round = 'F' AND m.winner_entry_id IS NOT NULL
                                      LIMIT 1)) AS champion,
               tournament_team_json((SELECT CASE WHEN m.entry_a_id = m.winner_entry_id
                                                 THEN m.entry_b_id ELSE m.entry_a_id END
                                       FROM tournament_matches m
                                      WHERE m.category_id = c.id AND m.stage = 'principal'
                                        AND m.round = 'F' AND m.winner_entry_id IS NOT NULL
                                      LIMIT 1)) AS runner_up,
               tournament_team_json((SELECT m.winner_entry_id FROM tournament_matches m
                                      WHERE m.category_id = c.id AND m.stage = '3lugar'
                                        AND m.winner_entry_id IS NOT NULL LIMIT 1)) AS third,
               (SELECT count(*) FROM tournament_matches m
                 WHERE m.category_id = c.id AND m.status IN ('terminado','falta','desistencia')) AS matches_played
        FROM tournament_categories c
        WHERE c.tournament_id = (SELECT id FROM t)
      ) x), '[]'::jsonb)
  ) END;
$$;

REVOKE ALL ON FUNCTION finish_category(UUID) FROM public, anon;
REVOKE ALL ON FUNCTION get_tournament_results(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION finish_category(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_tournament_results(TEXT) TO anon, authenticated;
