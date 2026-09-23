-- ════════════════════════════════════════════════════════════════════════
-- TORNEIOS, PARTE 8: O DONO VÊ O SEU PRÓPRIO RASCUNHO
-- (Dev 3, 23 set 2026) — cartão #437, fase 3 do plano de 23 set.
--
-- CORRER DEPOIS de `migration_tournaments_base.sql`. Pode-se correr outra
-- vez sem estragar.
--
-- O PROBLEMA: o admin cria um torneio, carrega na seta do Gerir para o ir
-- ver, e apanha «Torneio não encontrado». A razão é a vista
-- `tournament_public`, que acaba em `WHERE t.is_public AND t.status <>
-- 'rascunho'` — nem o próprio dono o vê.
--
-- ESSE FILTRO ESTÁ CERTO E NÃO SE MEXE. Se a vista deixar de filtrar,
-- todos os rascunhos de todos os clubes ficam à vista de toda a gente,
-- incluindo de quem não tem conta. O caminho para o dono ver o seu
-- rascunho tem de ser OUTRO, e fechado a quem é admin daquele clube.
--
-- COMO: o `get_tournament_page` passa a ter dois caminhos.
--   1. o de sempre: o torneio está público → devolve-o a qualquer um;
--   2. o novo: não está público, mas quem pergunta É ADMIN daquele clube
--      → devolve-o à mesma, com `is_preview: true`.
-- Quem não é admin continua a receber NULL, exatamente como hoje.
--
-- O ecrã do Dev 1 não precisa de função nova: chama o mesmo sítio e, se
-- vier `is_preview`, mostra a faixa «Rascunho — só tu vês isto».
--
-- As vistas públicas ficam TODAS como estão. Um rascunho não tem
-- categorias nem inscritos visíveis por elas, por isso a pré-visualização
-- lê as tabelas diretamente — e só depois de a permissão estar decidida.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. A página, a partir das tabelas ───────────────────────────────────
-- Devolve o MESMO formato que o `get_tournament_page` já devolvia, para o
-- ecrã não ter de saber por que caminho veio. Não decide permissões: quem
-- a chama é que já as decidiu. Por isso não se dá a ninguém (ver o fim).
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
               c.format, c.status, c.position,
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
    'my', (SELECT to_jsonb(x) FROM (
             SELECT e.category_id, e.status AS state, e.id AS entry_id
             FROM tournament_entries e
             JOIN tournament_categories c ON c.id = e.category_id
             WHERE c.tournament_id = p_id
               AND auth.uid() IS NOT NULL
               AND (e.player1_id = auth.uid() OR e.player2_id = auth.uid())
             ORDER BY e.created_at LIMIT 1) x)
  );
$$;

-- ── 2. A página, com a permissão decidida ───────────────────────────────
CREATE OR REPLACE FUNCTION get_tournament_page(p_tournament TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id      UUID;
  v_public  BOOLEAN;
BEGIN
  -- O CASE é preciso: sem ele o Postgres tenta converter o endereço em
  -- texto ("smash-cup") para identificador e rebenta, mesmo que a
  -- primeira condição já fosse verdadeira.
  SELECT t.id, (t.is_public AND t.status <> 'rascunho')
    INTO v_id, v_public
    FROM tournaments t
   WHERE t.slug = p_tournament
      OR t.id = (CASE WHEN p_tournament ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                      THEN p_tournament END)::uuid
   LIMIT 1;

  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Caminho de sempre: está público, vê-o quem quiser, com ou sem conta.
  IF v_public THEN
    RETURN tournament_page_json(v_id, FALSE);
  END IF;

  -- Caminho novo: está em rascunho ou escondido. Só o admin daquele clube
  -- o vê, e vê-o marcado como pré-visualização. Para todos os outros
  -- continua a não existir — a resposta é a mesma de um id inventado, para
  -- não se poder descobrir que ele existe.
  IF is_tournament_admin(v_id) THEN
    RETURN tournament_page_json(v_id, TRUE);
  END IF;

  RETURN NULL;
END;
$$;

-- ── 3. Quem pode chamar o quê ───────────────────────────────────────────
-- A `tournament_page_json` NÃO se dá a ninguém: ela não verifica
-- permissões nenhumas — devolve o torneio que lhe pedirem. Quem decide é o
-- `get_tournament_page`, e é esse que abre ao público.
REVOKE ALL ON FUNCTION tournament_page_json(UUID, BOOLEAN) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION get_tournament_page(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION get_tournament_page(TEXT) TO anon, authenticated;
