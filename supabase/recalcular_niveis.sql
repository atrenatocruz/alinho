-- ═════════════════════════════════════════════════════════════════════════
-- REFAZER TODOS OS NÍVEIS COM A CONTA NOVA, POR ORDEM DE DATA
-- (Dev 3, 24 set 2026) — cartão «#440».
--
-- Ordem do Francisco (24 set, pelo PO): refazer tudo o que já contou para o
-- nível — os mixes (11, de 27 jul a 21 set), os jogos entre amigos, os jogos
-- dentro do grupo e os torneios — com a conta de soma zero
-- (`migration_ranking_soma_zero.sql`), por ordem de data.
--   · Primeiro um ensaio numa CÓPIA, com a lista pessoa a pessoa de antes e
--     depois, para o Francisco ver (`ensaio_recalcular_niveis.sql`).
--   · Em produção só com o «corre» dele, e NUNCA entre 8 e 12 out (Smash Cup)
--     — a função recusa nesses dias.
--
-- ─────────────────────────────────────────────────────────────────────────
-- COMO FUNCIONA
-- ─────────────────────────────────────────────────────────────────────────
-- 1. Cada pessoa volta ao nível com que começou (o que escolheu ao entrar:
--    Iniciado 700 / Regular 900 / Avançado 1100, ou 900 se nunca escolheu),
--    com 0 jogos.
-- 2. Repete-se, por ordem de data, cada coisa que contou para o nível, com
--    as MESMAS funções que a app usa a partir de agora — não uma cópia das
--    contas. O que ficou registado em cada sítio (quanto cada um mexeu
--    naquele mix, naquele jogo) é reescrito com os números novos.
-- 3. Depois de cada coisa, confirma que a soma de todos os níveis não mudou
--    (soma zero). Se mudar, pára e não grava nada.
--
-- `SELECT * FROM recalcular_niveis(FALSE)` — SÓ VER: faz tudo, devolve a
-- lista, e desfaz. É o modo por omissão.
-- `SELECT * FROM recalcular_niveis(TRUE)`  — GRAVA.
--
-- O que NÃO muda: pontos do clube, XP, conquistas, resultados. Só o nível e
-- o registo de quanto cada um mexeu em cada jogo.
--
-- ─────────────────────────────────────────────────────────────────────────
-- O QUE A LISTA DEVOLVE
-- ─────────────────────────────────────────────────────────────────────────
-- Uma linha por coisa refeita (tipo 'mix', 'amigos', 'grupo', 'torneio'),
-- com a soma dos níveis antes e depois (a diferença tem de ser 0), e uma
-- linha por pessoa (tipo 'pessoa') com o nível antes e depois, os jogos, e
-- uma nota quando o nível de hoje NÃO bate com o que está registado (sinal
-- de um acerto à mão, ou de um jogo que mexeu sem ficar registado — como os
-- dois jogadores dos mixes de 24 ago e 21 set).
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION recalcular_niveis(p_gravar BOOLEAN DEFAULT FALSE)
RETURNS TABLE(tipo TEXT, quando TIMESTAMPTZ, quem TEXT, id UUID,
              antes NUMERIC, depois NUMERIC, diferenca NUMERIC,
              jogos_antes INTEGER, jogos_depois INTEGER, nota TEXT)
LANGUAGE plpgsql
SET search_path = public
AS $$
-- As colunas da lista (id, tipo, quando…) têm nomes iguais a colunas das
-- tabelas; dentro das consultas, ganha sempre a coluna da tabela.
#variable_conflict use_column
DECLARE
  c_ensaio   CONSTANT TEXT := 'recalcular_niveis: só ver — tudo desfeito';
  v_linhas   JSONB := '[]'::jsonb;
  v_antes    JSONB;
  e          RECORD;
  v_soma0    NUMERIC;
  v_soma1    NUMERIC;
  v_n        INTEGER := 0;
  pl         RECORD;
  v_deltas   JSONB;
BEGIN
  IF p_gravar AND current_date BETWEEN DATE '2026-10-08' AND DATE '2026-10-12' THEN
    RAISE EXCEPTION 'Não se recalculam níveis entre 8 e 12 out (Smash Cup).';
  END IF;
  IF to_regprocedure('elo_jogo_deltas(numeric[], integer[], numeric, text)') IS NULL THEN
    RAISE EXCEPTION 'Falta a conta nova: correr primeiro migration_ranking_soma_zero.sql.';
  END IF;

  BEGIN
    IF p_gravar THEN
      -- Ninguém fecha um mix nem confirma um jogo a meio disto.
      LOCK TABLE profiles IN SHARE ROW EXCLUSIVE MODE;
    END IF;

    -- ── Como está hoje ────────────────────────────────────────────────────
    SELECT jsonb_object_agg(p.id::text, jsonb_build_object(
             'r', p.rating, 'g', p.rating_games, 'nome', p.name,
             'ancora', p.rating_anchor))
      INTO v_antes
      FROM profiles p
     WHERE p.rating IS NOT NULL OR COALESCE(p.rating_games, 0) > 0;

    -- ── 1. Todos voltam ao início ──────────────────────────────────────
    UPDATE profiles
       SET rating = COALESCE(rating_anchor, 900),
           rating_games = 0
     WHERE rating IS NOT NULL OR COALESCE(rating_games, 0) > 0;

    -- ── 2. Tudo o que contou, por ordem de data ─────────────────────────
    FOR e IN
      SELECT * FROM (
        -- Mixes: os que tiveram o nível aplicado.
        SELECT 'mix'::text AS tipo, g.date AS quando, g.id AS ref, NULL::uuid AS ref2,
               COALESCE(g.title, '') AS nome
          FROM games g
         WHERE EXISTS (SELECT 1 FROM mix_player_stats s
                        WHERE s.game_id = g.id AND s.rating_delta IS NOT NULL)
        UNION ALL
        -- Jogos entre amigos que contaram (os que têm o registo do nível).
        SELECT 'amigos', COALESCE(pm.played_at, pm.confirmed_at, pm.created_at), pm.id, NULL, ''
          FROM private_matches pm
         WHERE EXISTS (SELECT 1 FROM private_match_stats s
                        WHERE s.private_match_id = pm.id
                          AND (to_jsonb(s) ->> 'rating_delta') IS NOT NULL)
        UNION ALL
        -- Jogos dentro do grupo que contaram.
        SELECT 'grupo',
               COALESCE((to_jsonb(gm) ->> 'played_at')::timestamptz,
                        (to_jsonb(gm) ->> 'locked_at')::timestamptz,
                        (to_jsonb(gm) ->> 'created_at')::timestamptz),
               gm.id, NULL, ''
          FROM group_matches gm
         WHERE (to_jsonb(gm) ->> 'ranked_applied')::boolean
        UNION ALL
        -- Torneios: cada categoria fechada com o nível aplicado.
        SELECT 'torneio',
               COALESCE((SELECT max(tm.scheduled_at) FROM tournament_matches tm
                          WHERE tm.category_id = c.id),
                        c.day_date::timestamptz),
               c.id, c.champion_entry_id, c.name
          FROM tournament_categories c
         WHERE EXISTS (SELECT 1 FROM tournament_player_stats s
                        WHERE s.category_id = c.id AND s.rating_delta IS NOT NULL)
      ) x
      ORDER BY quando NULLS LAST, tipo, ref
    LOOP
      -- Soma de TODOS (sem nível conta 900, como nas contas): quem joga pela
      -- primeira vez passa de 900 a 900 ± o jogo, e a soma continua certa.
      SELECT COALESCE(sum(COALESCE(rating, 900)), 0) INTO v_soma0 FROM profiles;

      IF e.tipo = 'mix' THEN
        PERFORM apply_mix_elo(e.ref, (SELECT winner_team_id FROM games WHERE id = e.ref));

      ELSIF e.tipo = 'amigos' THEN
        FOR pl IN
          SELECT r.* FROM private_matches pm,
                 LATERAL apply_elo_pairing(pm.team_a_player1_id, pm.team_a_player2_id,
                                           pm.team_b_player1_id, pm.team_b_player2_id,
                                           CASE WHEN pm.winner_team = 'a' THEN 1 ELSE 0 END) r
           WHERE pm.id = e.ref
        LOOP
          UPDATE private_match_stats
             SET rating_delta = round(pl.delta, 2),
                 rating_after = round((SELECT COALESCE(pr.rating, 900) FROM profiles pr WHERE pr.id = pl.pid), 2)
           WHERE private_match_id = e.ref AND user_id = pl.pid;
        END LOOP;

      ELSIF e.tipo = 'grupo' THEN
        v_deltas := '{}'::jsonb;
        FOR pl IN
          SELECT r.* FROM group_matches gm,
                 LATERAL apply_elo_pairing(gm.team_a_player1_id, gm.team_a_player2_id,
                                           gm.team_b_player1_id, gm.team_b_player2_id,
                                           CASE WHEN gm.applied_winner_team = 'a' THEN 1 ELSE 0 END) r
           WHERE gm.id = e.ref
        LOOP
          v_deltas := v_deltas || jsonb_build_object(pl.pid::text, pl.delta);
        END LOOP;
        -- O que se guarda é o que se desfaz se o resultado for corrigido.
        UPDATE group_matches SET applied_elo_deltas = v_deltas WHERE id = e.ref;

      ELSE
        PERFORM apply_tournament_elo(e.ref, e.ref2);
      END IF;

      SELECT COALESCE(sum(COALESCE(rating, 900)), 0) INTO v_soma1 FROM profiles;
      IF v_soma1 <> v_soma0 THEN
        RAISE EXCEPTION 'A soma dos níveis mudou % no % de % (%). Nada foi gravado.',
          v_soma1 - v_soma0, e.tipo, e.quando, e.ref;
      END IF;

      v_n := v_n + 1;
      v_linhas := v_linhas || jsonb_build_object(
        'tipo', e.tipo, 'quando', e.quando, 'quem', e.nome, 'id', e.ref,
        'antes', v_soma0, 'depois', v_soma1, 'diferenca', v_soma1 - v_soma0);
    END LOOP;

    -- ── 3. Pessoa a pessoa: antes e depois ──────────────────────────────
    v_linhas := v_linhas || COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'tipo', 'pessoa', 'quem', a.value ->> 'nome', 'id', p.id,
               'antes', (a.value ->> 'r')::numeric, 'depois', p.rating,
               'diferenca', p.rating - (a.value ->> 'r')::numeric,
               'jogos_antes', (a.value ->> 'g')::int, 'jogos_depois', p.rating_games,
               'nota', CASE
                 WHEN p.rating_games > (a.value ->> 'g')::int
                   THEN 'mais jogos agora: havia jogos a contar que não somavam no número'
                 WHEN p.rating_games < (a.value ->> 'g')::int
                   THEN 'menos jogos agora: tinha jogos contados que já não se encontram (acerto à mão ou jogo apagado)'
                 END))
        FROM jsonb_each(v_antes) a
        JOIN profiles p ON p.id = a.key::uuid), '[]'::jsonb);

    IF NOT p_gravar THEN
      RAISE EXCEPTION USING MESSAGE = c_ensaio;
    END IF;
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> c_ensaio THEN
        RAISE;
      END IF;
      -- Só ver: tudo o que se mexeu acima foi desfeito; a lista ficou.
  END;

  RETURN QUERY
  SELECT l ->> 'tipo', (l ->> 'quando')::timestamptz, l ->> 'quem', (l ->> 'id')::uuid,
         round((l ->> 'antes')::numeric, 2), round((l ->> 'depois')::numeric, 2),
         round((l ->> 'diferenca')::numeric, 2),
         (l ->> 'jogos_antes')::int, (l ->> 'jogos_depois')::int, l ->> 'nota'
    FROM jsonb_array_elements(v_linhas) l
   ORDER BY (l ->> 'tipo') = 'pessoa', (l ->> 'quando')::timestamptz,
            abs((l ->> 'diferenca')::numeric) DESC;
END;
$$;

REVOKE ALL ON FUNCTION recalcular_niveis(BOOLEAN) FROM public, anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- USAR
-- ═════════════════════════════════════════════════════════════════════════
-- Ensaio (não grava):   SELECT * FROM recalcular_niveis(FALSE);
-- Só as pessoas:        SELECT quem, antes, depois, diferenca, jogos_antes, jogos_depois, nota
--                         FROM recalcular_niveis(FALSE) WHERE tipo = 'pessoa'
--                        ORDER BY abs(diferenca) DESC;
-- Gravar (só com o «corre» do Francisco, e nunca de 8 a 12 out):
--                       SELECT * FROM recalcular_niveis(TRUE);
