-- ════════════════════════════════════════════════════════════════════════
-- TORNEIOS, PARTE 11: O RESUMO DE QUEM ESTÁ A VER, NO PÓDIO
-- (Dev 3, 23 set 2026) — cartão #361, print 12.
--
-- CORRER DEPOIS de `migration_tournaments_finish.sql` e
-- `migration_tournaments_who_played.sql`. Pode-se correr outra vez sem
-- estragar.
--
-- PORQUÊ: o `get_tournament_results` devolvia só o pódio. O ecrã do fim do
-- torneio (Dev 1) lê um `my` para duas coisas do desenho, e sem ele as
-- duas desapareciam em silêncio — nada rebentava, simplesmente não
-- apareciam:
--   · a caixa do resumo pessoal («4 jogos · ranking M5 +18 pontos»);
--   · o destaque do nome de quem está a ver, dentro do pódio.
--
-- Os dados já existiam todos em `tournament_player_stats`; faltava
-- expô-los. Não se acrescenta nada de novo — só se deixa a pessoa ver o
-- que é dela.
--
-- O QUE NÃO VAI AQUI, de propósito: o XP. Não existe em lado nenhum nos
-- torneios — nem coluna, nem conta. O ecrã mostrava «+60 XP» a partir dos
-- dados de teste. Ou sai do texto, ou se decide de onde vem o XP de um
-- torneio; está com o Francisco. Não se inventa um número para encher o
-- ecrã.
-- ════════════════════════════════════════════════════════════════════════

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
                 WHERE m.category_id = c.id AND m.status IN ('terminado','falta','desistencia')) AS matches_played,
               -- Quem subiu ao pódio, pessoa a pessoa, e se jogou a final.
               -- Com substituição a meio, uma dupla campeã pode ter mais do
               -- que duas pessoas: ficam todas (decisão do Francisco, 23
               -- set), e o ecrã distingue quem esteve em campo na final sem
               -- ter de fazer contas.
               COALESCE((
                 -- Ordenado como o ecra precisa: 1.o, 2.o, 3.o e, dentro do
                 -- mesmo lugar, quem jogou a final primeiro. Assim o ecra
                 -- nao ordena outra vez.
                 SELECT jsonb_agg(to_jsonb(y) ORDER BY y.final_position, y.played_final DESC, y.name) FROM (
                   SELECT pr.name, s.final_position, s.matches_played, s.matches_won,
                          EXISTS (
                            SELECT 1 FROM tournament_match_players mp
                            JOIN tournament_matches fm ON fm.id = mp.match_id
                            WHERE fm.category_id = c.id AND fm.stage = 'principal'
                              AND fm.round = 'F' AND mp.user_id = s.user_id
                          ) AS played_final
                   FROM tournament_player_stats s
                   JOIN profiles pr ON pr.id = s.user_id
                   WHERE s.category_id = c.id AND s.final_position IS NOT NULL
                 ) y), '[]'::jsonb) AS podium_players
        FROM tournament_categories c
        WHERE c.tournament_id = (SELECT id FROM t)
      ) x), '[]'::jsonb),
    -- O resumo de quem está a ver. Sem sessão vem NULL, como dantes.
    -- Jogou em duas categorias? Vem a de melhor lugar; a empatar, a de
    -- maior variação de pontos. (Forma pedida pelo Dev 1 para o print 12.)
    'my', (SELECT to_jsonb(z) FROM (
             SELECT pr.name AS player_name,
                    c.code AS category_code,
                    c.name AS category_name,
                    s.matches_played AS matches,
                    s.matches_won,
                    s.rating_delta,
                    s.final_position
             FROM tournament_player_stats s
             JOIN tournament_categories c ON c.id = s.category_id
             JOIN profiles pr ON pr.id = s.user_id
             WHERE c.tournament_id = (SELECT id FROM t)
               AND auth.uid() IS NOT NULL
               AND s.user_id = auth.uid()
             ORDER BY s.final_position NULLS LAST, s.rating_delta DESC NULLS LAST
             LIMIT 1) z)
  ) END;
$$;

REVOKE ALL ON FUNCTION get_tournament_results(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION get_tournament_results(TEXT) TO anon, authenticated;
