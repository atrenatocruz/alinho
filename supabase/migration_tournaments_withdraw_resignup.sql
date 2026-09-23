-- ═════════════════════════════════════════════════════════════════════════
-- TORNEIOS: QUEM DESISTE PODE VOLTAR A INSCREVER-SE
-- (23 set 2026) — cartões #450, #451 (e o #429, que é o mesmo episódio).
--
-- CORRER DEPOIS de migration_tournaments_prizes.sql (redefine a mesma
-- tournament_page_json, a partir da versão de lá). Pode-se correr outra vez
-- sem estragar.
--
-- 1. #450 — O índice único (category_id, player1_id) valia também para as
--    linhas desistidas, por isso quem desistia nunca mais se podia inscrever
--    na categoria: as funções deixavam (excluem 'desistiu' de propósito) e a
--    base de dados recusava com 409. Passa a índice parcial, com a mesma
--    regra das funções. (O player2_id já é verificado nas funções, que olham
--    às duas colunas; não há índice para ele porque a regra atravessa as
--    duas colunas e um índice não a exprime.)
--
-- 2. #451 — O `my` da página devolvia a inscrição mais antiga, desistida ou
--    não: quem desistia continuava a ler «Estás inscrito». Passa a ignorar as
--    desistidas, e junta-se `my_entries` com todas as inscrições ativas.
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE tournament_entries
  DROP CONSTRAINT IF EXISTS tournament_entries_category_id_player1_id_key;
DROP INDEX IF EXISTS tournament_entries_category_id_player1_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS tournament_entries_active_player1_key
  ON tournament_entries (category_id, player1_id)
  WHERE status <> 'desistiu';

CREATE OR REPLACE FUNCTION tournament_page_json(p_id UUID, p_preview BOOLEAN DEFAULT FALSE)
RETURNS JSONB
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'tournament', (
      SELECT to_jsonb(x) || jsonb_build_object('is_preview', p_preview)
      FROM (
        SELECT t.id, t.slug, t.name, t.organization_id,
               o.name AS club_name, o.group_logo_url AS club_logo_url,
               t.location, t.poster_url, t.starts_on, t.ends_on,
               t.entries_deadline, t.draw_on, t.entry_fee_cents,
               t.organizer_text, t.status,
               (SELECT count(*) FROM tournament_days d WHERE d.tournament_id = t.id) AS day_count,
               (SELECT max(d.courts) FROM tournament_days d WHERE d.tournament_id = t.id) AS court_count,
               (SELECT count(*) FROM tournament_categories c WHERE c.tournament_id = t.id) AS category_count,
               (SELECT count(*) FROM tournament_entries e
                  JOIN tournament_categories c ON c.id = e.category_id
                 WHERE c.tournament_id = t.id AND e.status IN ('validada','selecionada')) AS entry_count,
               (SELECT count(*) FROM tournament_matches m
                  JOIN tournament_categories c ON c.id = m.category_id
                 WHERE c.tournament_id = t.id) AS match_count
        FROM tournaments t
        JOIN organizations o ON o.id = t.organization_id
        WHERE t.id = p_id
      ) x),
    'days', COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.date)
                      FROM tournament_days d WHERE d.tournament_id = p_id), '[]'::jsonb),
    'categories', COALESCE((
      SELECT jsonb_agg(to_jsonb(c) ORDER BY c.position, c.code) FROM (
        SELECT c.id, c.tournament_id, c.code, c.name, c.gender, c.level, c.age_group,
               c.slots, c.price_cents, c.day_date, c.start_time, c.third_place_match,
               c.format, c.status, c.position, c.prize_first, c.prize_second,
               (SELECT count(*) FROM tournament_entries e
                 WHERE e.category_id = c.id AND e.status IN ('validada','selecionada')) AS entry_count
        FROM tournament_categories c WHERE c.tournament_id = p_id
      ) c), '[]'::jsonb),
    'notices', COALESCE((
      SELECT jsonb_agg(to_jsonb(n) ORDER BY n.created_at DESC) FROM (
        SELECT n.id, n.tournament_id, n.body, n.created_at, p.name AS author_name,
               n.expires_at, n.updated_at
        FROM tournament_notices n
        LEFT JOIN profiles p ON p.id = n.author_id
        WHERE n.tournament_id = p_id
      ) n), '[]'::jsonb),
    -- A minha inscrição ativa mais antiga — sem as desistidas (#451).
    'my', (SELECT to_jsonb(x) FROM (
             SELECT e.category_id, e.status AS state, e.id AS entry_id
             FROM tournament_entries e
             JOIN tournament_categories c ON c.id = e.category_id
             WHERE c.tournament_id = p_id
               AND auth.uid() IS NOT NULL
               AND e.status <> 'desistiu'
               AND (e.player1_id = auth.uid() OR e.player2_id = auth.uid())
             ORDER BY e.created_at LIMIT 1) x),
    -- Todas as minhas inscrições ativas: o torneio deixa ir a mais do que
    -- uma categoria, e o ecrã tem de saber em quais estou (#451).
    'my_entries', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at) FROM (
        SELECT e.category_id, e.status, e.status AS state, e.id AS entry_id, e.created_at
        FROM tournament_entries e
        JOIN tournament_categories c ON c.id = e.category_id
        WHERE c.tournament_id = p_id
          AND auth.uid() IS NOT NULL
          AND e.status <> 'desistiu'
          AND (e.player1_id = auth.uid() OR e.player2_id = auth.uid())
      ) x), '[]'::jsonb)
  );
$$;

-- Só se chama por dentro (get_tournament_page / pré-visualização).
REVOKE ALL ON FUNCTION tournament_page_json(UUID, BOOLEAN) FROM public, anon, authenticated;
