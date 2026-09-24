-- ═════════════════════════════════════════════════════════════════════════
-- RANKING: O QUE UMA DUPLA GANHA É O QUE A OUTRA PERDE
-- (Dev 3, 24 set 2026) — cartão «#440».
--
-- Regra do Francisco (24 set, sem exceções): em cada jogo, os pontos que uma
-- dupla ganha são exatamente os que a dupla adversária perde. Vale para mix,
-- jogo entre amigos, jogo dentro do grupo e torneio. Proposta escrita a 24
-- set (Alinho/notas/2026-09-24-ranking-proposta-para-o-ruben.md). As duas
-- escolhas do Ruben (24 set, pelo PO): convidado B e bónus pago por inteiro.
-- Ficam numa linha (`elo_opcoes`), para se poderem trocar sem mexer no resto.
--
-- Pode-se correr outra vez sem estragar.
--
-- ─────────────────────────────────────────────────────────────────────────
-- A CONTA, NUM SÍTIO SÓ
-- ─────────────────────────────────────────────────────────────────────────
-- `elo_jogo_deltas` faz a conta de UM jogo e não lê nem escreve nada: recebe
-- os níveis e devolve quanto cada um mexe. Todos os sítios passam por ela:
--   · `apply_elo_pairing` (mixes, jogos entre amigos, jogos dentro do grupo)
--     lê os níveis, chama-a e grava — MESMA assinatura de antes, por isso as
--     funções que a chamam (`confirm_private_match`,
--     `apply_group_match_ranking`, …) não mudam;
--   · `apply_mix_elo` passa por ela jogo a jogo, como já fazia;
--   · `apply_tournament_elo` tinha uma cópia própria das contas (novato até
--     5 jogos, e não 8 como o resto). Passa a chamar `apply_elo_pairing`.
--
-- 1. Expectativa como hoje: a média do nível de cada dupla dá a
--    probabilidade de ganhar. Ganhar a um mais fraco dá pouco, perder contra
--    ele custa muito.
-- 2. Um só K por jogo: a média dos K (40 até 8 jogos, 30 até 20, 20 depois)
--    de quem tem conta. A dupla A mexe 2·K·(S−E) e a B exatamente o
--    contrário.
-- 3. Dentro da dupla reparte-se como hoje (na vitória, 35–65 % a favor do
--    mais fraco; na derrota e no empate, metade), pesado pelo K de cada um: o
--    novo mexe mais do que o parceiro, mas à custa da fatia do parceiro.
-- 4. Chão a 0: quem está no 0 só perde o que tem, e os vencedores ganham só o
--    que os outros perderam de facto.
-- 5. Acaba a proteção do parceiro novo (o «escudo»).
-- 6. Arredonda-se a cêntimos, e o último vencedor leva o acerto: a soma dá
--    0,00 exato, e o que se grava é o que se aplicou (o nível é numeric(7,2)).
--
-- CONVIDADO SEM CONTA (só torneios: nos mixes o bot cria-lhes conta, e os
-- jogos entre amigos com convidado não contam). Escolhido pelo Ruben: B.
-- O torneio dava o movimento todo a quem tinha conta (era a A); passa a B por
-- chamar a mesma função.
--   · 'B' — a dupla com convidado conta como uma pessoa só: o jogo mexe
--     metade (1100 + convidado ganham a 1100 + 1100: +10 / −5 / −5).
--   · 'A' — quem tem conta leva o movimento todo da dupla (+20 / −10 / −10).
--
-- BÓNUS DO VENCEDOR DO MIX. Escolhido pelo Ruben: 'pago'.
--   · 'pago' — como hoje (+1 % para a dupla vencedora, +0,5 % a quem ganhou
--     todos os jogos), mas pago POR INTEIRO por quem perdeu contra os
--     premiados nessa noite, pesado pela surpresa dessa derrota. Se não
--     chegar para pagar (alguém no 0), o prémio encolhe até ao que se pagou.
--   · 'nenhum' — acaba o bónus.
-- O limite para quem ganha a adversários muito mais fracos (150/300 pontos)
-- continua, mas agora só corta o BÓNUS, nunca os pontos dos jogos: cortar os
-- pontos de um jogo tirava-os a um lado sem os dar ao outro.
--
-- O bónus de campeão do torneio já era pago por inteiro pelos outros
-- jogadores da categoria; fica igual, só com o chão a 0 e os cêntimos
-- acertados.
--
-- ─────────────────────────────────────────────────────────────────────────
-- OS NÍVEIS DE HOJE NÃO MUDAM COM ESTE FICHEIRO
-- ─────────────────────────────────────────────────────────────────────────
-- Isto muda a conta dos jogos daqui para a frente. Refazer tudo o que já
-- contou é outro ficheiro (`recalcular_niveis.sql`), com ensaio primeiro.
--
-- ─────────────────────────────────────────────────────────────────────────
-- TRAVA: SÓ CORRE SOBRE AS VERSÕES MEDIDAS A 24 SET
-- ─────────────────────────────────────────────────────────────────────────
-- Estas três funções são substituídas por inteiro — é o objetivo. Para não
-- apagar uma mudança que produção tenha feito depois de 24 set, o ficheiro
-- recusa se a impressão (md5) de alguma não for a medida pelo PO nesse dia.
-- ═════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  -- Impressões do código em bruto (left(md5(prosrc), 8)) medidas em produção
  -- pelo System Integrator a 24 set, já com o #501 (WHERE TRUE) na do torneio.
  c_medidas CONSTANT JSONB := '{"apply_elo_pairing":    "bbddc94c",
                                "apply_mix_elo":        "a59efd76",
                                "apply_tournament_elo": "2c0a45c9"}';
  f RECORD;
BEGIN
  FOR f IN SELECT p.proname, count(*) AS n,
                  min(left(md5(p.prosrc), 8)) AS md5_8,
                  bool_or(p.prosrc LIKE '%elo_jogo_deltas%' OR p.prosrc LIKE '%(#440)%') AS ja_nova
             FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('apply_elo_pairing', 'apply_mix_elo', 'apply_tournament_elo')
            GROUP BY p.proname LOOP
    IF f.n <> 1 THEN
      RAISE EXCEPTION '% existe em % versões. Parar e ler antes de correr isto.', f.proname, f.n;
    END IF;
    IF f.ja_nova THEN
      RAISE NOTICE '%: já tem a conta nova — vai ser escrita outra vez, igual.', f.proname;
    ELSIF f.md5_8 <> c_medidas ->> f.proname THEN
      RAISE EXCEPTION '% mudou desde 24 set (impressão % em vez de %). Não substituo às cegas — ler o corpo vivo e avisar o Dev 3.',
        f.proname, f.md5_8, c_medidas ->> f.proname;
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT proname) FROM pg_proc
       WHERE pronamespace = 'public'::regnamespace
         AND proname IN ('apply_elo_pairing', 'apply_mix_elo', 'apply_tournament_elo')) <> 3 THEN
    RAISE EXCEPTION 'Falta uma das três funções do ranking. Parar e ler.';
  END IF;
END $$;

-- Guardar quem corria com poderes de dono, para os repor no fim (substituir
-- uma função com CREATE OR REPLACE tira-lhe o SECURITY DEFINER se o texto
-- novo não o disser, e produção pode tê-lo onde o repositório não tem).
CREATE TEMP TABLE _440_poderes AS
SELECT p.oid::regprocedure::text AS assinatura, p.prosecdef
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('apply_elo_pairing', 'apply_mix_elo', 'apply_tournament_elo');


-- ═════════════════════════════════════════════════════════════════════════
-- 1. AS DUAS ESCOLHAS DO RUBEN (convidado B, bónus pago) — trocam-se aqui
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION elo_opcoes()
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT '{"convidado": "B", "bonus_mix": "pago"}'::jsonb;
$$;


-- ═════════════════════════════════════════════════════════════════════════
-- 2. A CONTA DE UM JOGO (não lê nem escreve nada)
-- ═════════════════════════════════════════════════════════════════════════
-- p_r:     níveis [A1, A2, B1, B2]; NULL = lugar sem conta (convidado).
-- p_jogos: jogos que já contaram para o nível de cada um.
-- p_s_a:   resultado da dupla A — 1 ganhou, 0 perdeu, 0,5 empate.
-- Devolve quanto cada lugar mexe (NULL nos lugares sem conta).
CREATE OR REPLACE FUNCTION elo_jogo_deltas(
  p_r NUMERIC[], p_jogos INTEGER[], p_s_a NUMERIC, p_convidado TEXT DEFAULT 'B')
RETURNS NUMERIC[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_out     NUMERIC[] := ARRAY[NULL, NULL, NULL, NULL]::NUMERIC[];
  v_k       NUMERIC[] := ARRAY[NULL, NULL, NULL, NULL]::NUMERIC[];
  v_p       NUMERIC[] := ARRAY[0, 0, 0, 0]::NUMERIC[];
  v_na      INTEGER := 0;
  v_nb      INTEGER := 0;
  v_ra      NUMERIC;
  v_rb      NUMERIC;
  v_ea      NUMERIC;
  v_m       NUMERIC;
  v_w       NUMERIC;
  v_s_t     NUMERIC;
  v_soma    NUMERIC;
  v_ganha   INTEGER[];
  v_perde   INTEGER[];
  v_perdido NUMERIC := 0;
  v_dado    NUMERIC := 0;
  v_ultimo  INTEGER;
  i INTEGER;
  a INTEGER;
  b INTEGER;
BEGIN
  FOR i IN 1..4 LOOP
    IF p_r[i] IS NOT NULL THEN
      IF i <= 2 THEN v_na := v_na + 1; ELSE v_nb := v_nb + 1; END IF;
      v_k[i] := CASE WHEN COALESCE(p_jogos[i], 0) < 8  THEN 40
                     WHEN p_jogos[i] < 20              THEN 30
                     ELSE 20 END;
      v_out[i] := 0;
    END IF;
  END LOOP;
  -- Um lado sem ninguém com conta, ou jogo sem resultado: não há o que medir.
  -- (Sem resultado, as contas com NULL davam perdas do nível inteiro: o
  -- LEAST e o GREATEST do Postgres ignoram NULL.)
  IF v_na = 0 OR v_nb = 0 OR p_s_a IS NULL OR p_s_a NOT BETWEEN 0 AND 1 THEN
    RETURN ARRAY[NULL, NULL, NULL, NULL]::NUMERIC[];
  END IF;

  -- 1. Expectativa: média do nível de cada dupla (só de quem tem conta).
  SELECT avg(x) INTO v_ra FROM unnest(p_r[1:2]) x;
  SELECT avg(x) INTO v_rb FROM unnest(p_r[3:4]) x;
  v_ea := 1 / (1 + power(10::NUMERIC, (v_rb - v_ra) / 400));

  -- 2. Um K por jogo; quanto a dupla A mexe.
  SELECT avg(x) INTO v_m FROM unnest(v_k) x;
  v_m := 2 * v_m * (p_s_a - v_ea);
  IF p_convidado = 'B' THEN
    v_m := v_m * LEAST(v_na, v_nb) / 2.0;   -- dupla com convidado = uma pessoa
  END IF;
  IF round(v_m, 2) = 0 THEN
    RETURN v_out;
  END IF;

  -- 3. Dentro de cada dupla: a fatia de cada um, pesada pelo seu K.
  FOR i IN 0..1 LOOP
    a := 2 * i + 1;
    b := 2 * i + 2;
    v_s_t := CASE WHEN i = 0 THEN p_s_a ELSE 1 - p_s_a END;
    IF p_r[a] IS NULL OR p_r[b] IS NULL THEN
      IF p_r[a] IS NOT NULL THEN v_p[a] := 1; END IF;
      IF p_r[b] IS NOT NULL THEN v_p[b] := 1; END IF;
    ELSE
      -- Na vitória, o mais fraco leva mais (35–65 %). Os dois no 0: metade.
      v_w := CASE WHEN v_s_t = 1 AND p_r[a] + p_r[b] > 0
                  THEN LEAST(0.65, GREATEST(0.35, p_r[b] / (p_r[a] + p_r[b])))
                  ELSE 0.5 END;
      v_p[a] := v_w * v_k[a];
      v_p[b] := (1 - v_w) * v_k[b];
      v_soma := v_p[a] + v_p[b];
      v_p[a] := v_p[a] / v_soma;
      v_p[b] := v_p[b] / v_soma;
    END IF;
  END LOOP;

  IF v_m > 0 THEN
    v_ganha := ARRAY[1, 2]; v_perde := ARRAY[3, 4];
  ELSE
    v_ganha := ARRAY[3, 4]; v_perde := ARRAY[1, 2];
  END IF;
  v_m := abs(v_m);

  -- 4. Quem perde, perde a sua fatia — mas nunca abaixo de 0.
  FOREACH i IN ARRAY v_perde LOOP
    IF p_r[i] IS NOT NULL THEN
      v_out[i] := - LEAST(round(v_m * v_p[i], 2), GREATEST(p_r[i], 0));
      v_perdido := v_perdido - v_out[i];
    END IF;
  END LOOP;

  -- Quem ganha, reparte o que se perdeu DE FACTO; o último leva o acerto
  -- dos cêntimos, para a soma dar 0,00.
  FOREACH i IN ARRAY v_ganha LOOP
    IF p_r[i] IS NOT NULL THEN
      v_out[i] := round(v_perdido * v_p[i], 2);
      v_dado := v_dado + v_out[i];
      v_ultimo := i;
    END IF;
  END LOOP;
  v_out[v_ultimo] := v_out[v_ultimo] + (v_perdido - v_dado);

  RETURN v_out;
END;
$$;


-- ═════════════════════════════════════════════════════════════════════════
-- 3. apply_elo_pairing — mesma assinatura, a conta passa a ser a de cima
-- ═════════════════════════════════════════════════════════════════════════
-- `p_partner_chosen` fica só para as chamadas antigas continuarem a
-- funcionar: servia para o escudo do parceiro novo, que acabou.
CREATE OR REPLACE FUNCTION apply_elo_pairing(
  p_a1 UUID, p_a2 UUID, p_b1 UUID, p_b2 UUID, p_s_a NUMERIC,
  p_partner_chosen BOOLEAN DEFAULT TRUE)
RETURNS TABLE(pid UUID, delta NUMERIC, s NUMERIC)
LANGUAGE plpgsql
SET search_path = public
AS $$
-- Conta de soma zero (#440): ver elo_jogo_deltas.
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

  v_d := elo_jogo_deltas(v_r, v_g, p_s_a, COALESCE(elo_opcoes() ->> 'convidado', 'B'));

  FOR i IN 1..4 LOOP
    CONTINUE WHEN v_d[i] IS NULL;
    UPDATE profiles
       SET rating = GREATEST(0, COALESCE(rating, 900) + v_d[i]),
           rating_games = rating_games + 1
     WHERE id = v_ids[i];
    pid   := v_ids[i];
    delta := v_d[i];
    s     := CASE WHEN i <= 2 THEN p_s_a ELSE 1 - p_s_a END;
    RETURN NEXT;
  END LOOP;
END;
$$;


-- ═════════════════════════════════════════════════════════════════════════
-- 4. apply_mix_elo — os jogos como antes; o bónus pago por inteiro
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION apply_mix_elo(p_game_id UUID, p_winner_team_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
-- Conta de soma zero (#440).
DECLARE
  m RECORD;
  pl RECORD;
  v_s_a            NUMERIC;
  v_had_matches    BOOLEAN := FALSE;
  v_bonus          TEXT := COALESCE(elo_opcoes() ->> 'bonus_mix', 'pago');
  v_premio_total   NUMERIC;
  v_peso_total     NUMERIC;
  v_cobrado        NUMERIC;
  v_acerto         NUMERIC;
  v_a_rating_before NUMERIC;
  v_b_rating_before NUMERIC;
  v_e_a_before     NUMERIC;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _elo_night (
    pid UUID PRIMARY KEY,
    delta NUMERIC NOT NULL DEFAULT 0,
    played INTEGER NOT NULL DEFAULT 0,
    won INTEGER NOT NULL DEFAULT 0,
    bonus NUMERIC NOT NULL DEFAULT 0,
    taxa NUMERIC NOT NULL DEFAULT 0,
    rating_before NUMERIC,
    opp_r_sum NUMERIC NOT NULL DEFAULT 0,
    surprise_weight NUMERIC NOT NULL DEFAULT 0
  ) ON COMMIT DROP;
  TRUNCATE _elo_night;

  -- Nível de cada um ANTES deste mix: a régua do limite e da surpresa, para
  -- não se mexer à medida que as rondas vão correndo.
  INSERT INTO _elo_night (pid, rating_before)
  SELECT DISTINCT t.pid, COALESCE(pr.rating, 900)
    FROM (SELECT player1_id AS pid FROM teams WHERE game_id = p_game_id
          UNION
          SELECT player2_id FROM teams WHERE game_id = p_game_id) t
    JOIN profiles pr ON pr.id = t.pid
  ON CONFLICT (pid) DO NOTHING;

  -- ── Os jogos: cada um soma zero ───────────────────────────────────────
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
    v_had_matches := TRUE;
    v_s_a := CASE WHEN m.score_a IS NOT NULL AND m.score_a = m.score_b THEN 0.5
                  WHEN m.winner_team_id = m.team_a_id THEN 1
                  ELSE 0 END;

    SELECT AVG(rating_before) INTO v_a_rating_before FROM _elo_night WHERE pid IN (m.a1, m.a2);
    SELECT AVG(rating_before) INTO v_b_rating_before FROM _elo_night WHERE pid IN (m.b1, m.b2);

    FOR pl IN SELECT * FROM apply_elo_pairing(m.a1, m.a2, m.b1, m.b2, v_s_a, p_partner_chosen => FALSE) LOOP
      INSERT INTO _elo_night (pid, delta, played, won, opp_r_sum)
      VALUES (pl.pid, pl.delta, 1, CASE WHEN pl.s = 1 THEN 1 ELSE 0 END,
              CASE WHEN pl.pid IN (m.a1, m.a2) THEN v_b_rating_before ELSE v_a_rating_before END)
      ON CONFLICT (pid) DO UPDATE
      SET delta     = _elo_night.delta + EXCLUDED.delta,
          played    = _elo_night.played + 1,
          won       = _elo_night.won + EXCLUDED.won,
          opp_r_sum = _elo_night.opp_r_sum + EXCLUDED.opp_r_sum;
    END LOOP;
  END LOOP;

  -- ── O bónus do vencedor, pago por inteiro ─────────────────────────────
  IF v_had_matches AND p_winner_team_id IS NOT NULL AND v_bonus = 'pago' THEN
    -- Prémio como hoje: +1 % do próprio nível para a dupla vencedora do mix,
    -- +0,5 % a quem ganhou todos os jogos.
    UPDATE _elo_night n
       SET bonus = round(
             (CASE WHEN n.pid IN (SELECT unnest(ARRAY[player1_id, player2_id])
                                    FROM teams WHERE id = p_winner_team_id)
                   THEN 0.01 ELSE 0 END
            + CASE WHEN n.played > 0 AND n.won = n.played THEN 0.005 ELSE 0 END)
           * COALESCE((SELECT pr.rating FROM profiles pr WHERE pr.id = n.pid), 900), 2)
     WHERE TRUE;

    -- Limite para quem ganhou por ter adversários muito mais fracos: agora só
    -- corta o prémio (até 0), nunca os pontos dos jogos.
    UPDATE _elo_night n
       SET bonus = GREATEST(0, LEAST(n.bonus,
             (CASE WHEN g.gap >= 300 THEN 5 ELSE 15 END) - n.delta))
      FROM (SELECT pid, (rating_before - opp_r_sum / NULLIF(played, 0)) AS gap
              FROM _elo_night WHERE played > 0) g
     WHERE g.pid = n.pid AND g.gap >= 150 AND n.bonus > 0;

    -- Quem paga: quem perdeu contra um premiado, pesado pela surpresa dessa
    -- derrota (uma derrota esperada pesa quase nada).
    FOR m IN
      SELECT mt.winner_team_id, mt.team_a_id,
             ta.player1_id AS a1, ta.player2_id AS a2,
             tb.player1_id AS b1, tb.player2_id AS b2
        FROM matches mt
        JOIN teams ta ON ta.id = mt.team_a_id
        JOIN teams tb ON tb.id = mt.team_b_id
       WHERE mt.game_id = p_game_id AND mt.winner_team_id IS NOT NULL
    LOOP
      CONTINUE WHEN NOT EXISTS (
        SELECT 1 FROM _elo_night n
         WHERE n.bonus > 0
           AND n.pid = ANY (CASE WHEN m.winner_team_id = m.team_a_id
                                 THEN ARRAY[m.a1, m.a2] ELSE ARRAY[m.b1, m.b2] END));
      SELECT AVG(rating_before) INTO v_a_rating_before FROM _elo_night WHERE pid IN (m.a1, m.a2);
      SELECT AVG(rating_before) INTO v_b_rating_before FROM _elo_night WHERE pid IN (m.b1, m.b2);
      v_e_a_before := 1 / (1 + power(10::NUMERIC, (v_b_rating_before - v_a_rating_before) / 400));
      IF m.winner_team_id = m.team_a_id THEN
        UPDATE _elo_night SET surprise_weight = surprise_weight + (1 - v_e_a_before)
         WHERE pid IN (m.b1, m.b2);
      ELSE
        UPDATE _elo_night SET surprise_weight = surprise_weight + v_e_a_before
         WHERE pid IN (m.a1, m.a2);
      END IF;
    END LOOP;

    SELECT COALESCE(sum(bonus), 0) INTO v_premio_total FROM _elo_night WHERE bonus > 0;
    SELECT COALESCE(sum(surprise_weight * rating_before), 0) INTO v_peso_total
      FROM _elo_night WHERE bonus = 0 AND surprise_weight > 0;

    IF v_premio_total > 0 AND v_peso_total > 0 THEN
      -- Cada pagador paga a sua parte do prémio TODO (antes pagava-se só uma
      -- parte). Nunca abaixo de 0.
      UPDATE _elo_night n
         SET taxa = LEAST(round(v_premio_total * n.surprise_weight * n.rating_before / v_peso_total, 2),
                          GREATEST(COALESCE(pr.rating, 900), 0))
        FROM profiles pr
       WHERE pr.id = n.pid AND n.bonus = 0 AND n.surprise_weight > 0;
      SELECT COALESCE(sum(taxa), 0) INTO v_cobrado FROM _elo_night;

      -- O prémio é o que se cobrou: se alguém estava no 0, ou pelos cêntimos,
      -- os premiados recebem na proporção, e o maior leva o acerto.
      IF v_cobrado <> v_premio_total THEN
        UPDATE _elo_night SET bonus = round(bonus * v_cobrado / v_premio_total, 2) WHERE bonus > 0;
        SELECT v_cobrado - COALESCE(sum(bonus), 0) INTO v_acerto FROM _elo_night WHERE bonus > 0;
        UPDATE _elo_night SET bonus = bonus + v_acerto
         WHERE pid = (SELECT pid FROM _elo_night WHERE bonus > 0 ORDER BY bonus DESC, pid LIMIT 1);
      END IF;
    ELSE
      -- Ninguém para pagar: não há prémio.
      UPDATE _elo_night SET bonus = 0 WHERE bonus <> 0;
    END IF;

    UPDATE _elo_night SET delta = delta + bonus - taxa WHERE bonus <> 0 OR taxa <> 0;
    UPDATE profiles pr
       SET rating = GREATEST(0, COALESCE(pr.rating, 900) + n.bonus - n.taxa)
      FROM _elo_night n
     WHERE pr.id = n.pid AND (n.bonus <> 0 OR n.taxa <> 0);
  END IF;

  UPDATE mix_player_stats mps
     SET rating_delta = round(n.delta, 2),
         rating_after = round(COALESCE(pr.rating, 900), 2)
    FROM _elo_night n
    JOIN profiles pr ON pr.id = n.pid
   WHERE mps.game_id = p_game_id AND mps.user_id = n.pid AND n.played > 0;
END;
$$;


-- ═════════════════════════════════════════════════════════════════════════
-- 5. apply_tournament_elo — deixa de ter uma cópia própria das contas
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION apply_tournament_elo(p_category_id UUID, p_champion_entry_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
-- Conta de soma zero (#440): cada jogo passa por apply_elo_pairing.
DECLARE
  m RECORD;
  pl RECORD;
  v_s_a          NUMERIC;
  v_had_matches  BOOLEAN := FALSE;
  v_premio_total NUMERIC;
  v_peso_total   NUMERIC;
  v_cobrado      NUMERIC;
  v_acerto       NUMERIC;
  v_campeoes     UUID[];
  v_a            UUID[];
  v_b            UUID[];
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _elo_torneio (
    pid UUID PRIMARY KEY,
    delta NUMERIC NOT NULL DEFAULT 0,
    played INTEGER NOT NULL DEFAULT 0,
    won INTEGER NOT NULL DEFAULT 0,
    bonus NUMERIC NOT NULL DEFAULT 0,
    taxa NUMERIC NOT NULL DEFAULT 0
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
    v_had_matches := TRUE;
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

  IF v_had_matches AND p_champion_entry_id IS NOT NULL THEN
    -- O bónus de campeão vai para quem JOGOU A FINAL; sem final, para a
    -- inscrição campeã.
    SELECT array_agg(mp.user_id) INTO v_campeoes
      FROM tournament_match_players mp
      JOIN tournament_matches fm ON fm.id = mp.match_id
     WHERE fm.category_id = p_category_id
       AND fm.stage = 'principal' AND fm.round = 'F'
       AND fm.winner_entry_id = p_champion_entry_id
       AND mp.user_id IS NOT NULL
       AND mp.side = CASE WHEN fm.entry_a_id = p_champion_entry_id THEN 'a' ELSE 'b' END;
    IF v_campeoes IS NULL THEN
      SELECT array_remove(ARRAY[player1_id, player2_id], NULL) INTO v_campeoes
        FROM tournament_entries WHERE id = p_champion_entry_id;
    END IF;

    UPDATE _elo_torneio n
       SET bonus = round(
             (CASE WHEN n.pid = ANY (v_campeoes) THEN 0.01 ELSE 0 END
            + CASE WHEN n.played > 0 AND n.won = n.played THEN 0.005 ELSE 0 END)
           * COALESCE((SELECT pr.rating FROM profiles pr WHERE pr.id = n.pid), 900), 2)
     WHERE TRUE;

    -- Pagam todos os outros da categoria, na proporção do nível (como
    -- antes), mas nunca abaixo de 0; o prémio é o que se cobrou.
    SELECT COALESCE(sum(bonus), 0) INTO v_premio_total FROM _elo_torneio WHERE bonus > 0;
    SELECT COALESCE(sum(COALESCE(pr.rating, 900)), 0) INTO v_peso_total
      FROM _elo_torneio n JOIN profiles pr ON pr.id = n.pid
     WHERE n.bonus = 0;

    IF v_premio_total > 0 AND v_peso_total > 0 THEN
      UPDATE _elo_torneio n
         SET taxa = LEAST(round(v_premio_total * COALESCE(pr.rating, 900) / v_peso_total, 2),
                          GREATEST(COALESCE(pr.rating, 900), 0))
        FROM profiles pr
       WHERE pr.id = n.pid AND n.bonus = 0;
      SELECT COALESCE(sum(taxa), 0) INTO v_cobrado FROM _elo_torneio;
      IF v_cobrado <> v_premio_total THEN
        UPDATE _elo_torneio SET bonus = round(bonus * v_cobrado / v_premio_total, 2) WHERE bonus > 0;
        SELECT v_cobrado - COALESCE(sum(bonus), 0) INTO v_acerto FROM _elo_torneio WHERE bonus > 0;
        UPDATE _elo_torneio SET bonus = bonus + v_acerto
         WHERE pid = (SELECT pid FROM _elo_torneio WHERE bonus > 0 ORDER BY bonus DESC, pid LIMIT 1);
      END IF;
    ELSE
      UPDATE _elo_torneio SET bonus = 0 WHERE bonus <> 0;
    END IF;

    UPDATE _elo_torneio SET delta = delta + bonus - taxa WHERE bonus <> 0 OR taxa <> 0;
    UPDATE profiles pr
       SET rating = GREATEST(0, COALESCE(pr.rating, 900) + n.bonus - n.taxa)
      FROM _elo_torneio n
     WHERE pr.id = n.pid AND (n.bonus <> 0 OR n.taxa <> 0);
  END IF;

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
-- 6. Poderes e acessos
-- ═════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  f RECORD;
BEGIN
  FOR f IN SELECT * FROM _440_poderes WHERE prosecdef LOOP
    EXECUTE format('ALTER FUNCTION %s SECURITY DEFINER', f.assinatura);
  END LOOP;
END $$;
DROP TABLE _440_poderes;

-- Internas: só as funções da app as chamam.
REVOKE ALL ON FUNCTION elo_opcoes() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION elo_jogo_deltas(NUMERIC[], INTEGER[], NUMERIC, TEXT) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION apply_elo_pairing(UUID, UUID, UUID, UUID, NUMERIC, BOOLEAN) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION apply_mix_elo(UUID, UUID) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION apply_tournament_elo(UUID, UUID) FROM public, anon, authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- CONFIRMAR (só leitura) — os cinco casos da proposta, e a soma a zero
-- ═════════════════════════════════════════════════════════════════════════
--   SELECT caso, d, (SELECT sum(x) FROM unnest(d) x) AS soma FROM (VALUES
--     ('1 convidado',  elo_jogo_deltas(ARRAY[1100,NULL,1100,1100], ARRAY[30,0,30,30], 1, 'B')),
--     ('2 novo',       elo_jogo_deltas(ARRAY[1100,1100,1100,1100], ARRAY[0,30,30,30], 1, 'B')),
--     ('3 parceiro',   elo_jogo_deltas(ARRAY[1200,1000,1100,1100], ARRAY[30,0,30,30], 1, 'B')),
--     ('5 chão',       elo_jogo_deltas(ARRAY[5,1800,500,500],      ARRAY[30,30,30,30], 0, 'B'))
--   ) t(caso, d);
-- Esperado: {10,NULL,-5,-5}; {16.67,8.33,-12.50,-12.50};
--           {7.35,17.65,-12.50,-12.50}; {-5,-18.21,11.61,11.60}; soma 0 em todos.
