-- ════════════════════════════════════════════════════════════════════════
-- TORNEIOS, PARTE 5: AS DUPLAS PARA O SORTEIO  (Dev 3, 22 set 2026)
-- Cartão #364, «Torneio 4/6» — ecrã «Sortear».
--
-- CORRER DEPOIS de `migration_tournaments_base.sql`. Pode-se correr outra
-- vez sem estragar.
--
-- PORQUE EXISTE: o ecrã do sorteio propõe as cabeças de série «pelos pontos
-- do ranking, somados» (desenho, ecrã «Sortear · M4»). Os pontos vivem em
-- `profiles.rating`, e um perfil só é visível a quem partilha clube — num
-- torneio entra gente de fora, por isso o ecrã não os consegue ler
-- sozinho. Esta função dá-os, mas SÓ ao admin do torneio e SÓ das duplas
-- daquela categoria: nada de pontos de gente que não está no torneio.
--
-- Não devolve telemóvel, email, nem os pontos de cada jogador em separado.
-- Os pontos não vão para lado nenhum público: a página do torneio nunca os
-- mostra.
--
-- COM UMA EXCEÇÃO, e vale a pena ser dito em vez de fingir que não existe:
-- quando a dupla é de um só (parceiro sem conta, ou o outro ainda sem
-- ranking), a «soma da dupla» É o ranking dessa pessoa. O organizador fica
-- a saber o nível de alguém com quem pode não partilhar clube nenhum.
-- Fica assim de propósito: sem esse número não há como pôr as cabeças de
-- série por ordem, e no Smash Cup muitas duplas trazem um parceiro sem
-- conta. Quem se inscreve num torneio por níveis está a dizer o seu nível à
-- organização, que é quem precisa dele. Essas linhas vêm marcadas com
-- `points_incomplete` para o ecrã as poder mostrar como «nível por apurar»
-- em vez de um número — mas o número vai no JSON, e isso é uma decisão, não
-- um descuido.
--
-- A lista vem SEMPRE por pontos, mesmo numa categoria já sorteada: serve
-- para PROPOR cabeças de série. Quem quiser rever um sorteio feito ordena
-- pelo `seed_number`, que também vai.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION list_category_seeding(p_category_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tournament UUID;
  v_out JSONB;
BEGIN
  v_tournament := tournament_of_category(p_category_id);
  IF v_tournament IS NULL THEN
    RAISE EXCEPTION 'Categoria não encontrada';
  END IF;
  IF NOT is_tournament_admin(v_tournament) THEN
    RAISE EXCEPTION 'Só um admin do clube pode ver os pontos para o sorteio'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.points DESC NULLS LAST, x.created_at), '[]'::jsonb)
    INTO v_out
  FROM (
    SELECT e.id AS entry_id,
           e.status,
           e.seed_number,
           e.created_at,
           COALESCE(NULLIF(trim(e.team_name), ''),
                    concat_ws(' / ', p1.name, COALESCE(p2.name, e.guest_name))) AS name,
           jsonb_build_array(p1.name, COALESCE(p2.name, e.guest_name)) AS players,
           -- Os pontos da dupla são a soma dos dois. Quem ainda não tem
           -- ranking (conta nova, ou parceiro sem conta) conta como zero e
           -- vai para o fim — não se inventa um nível que a pessoa não tem.
           (COALESCE(p1.rating, 0) + COALESCE(p2.rating, 0))::int AS points,
           (p1.rating IS NULL OR (e.player2_id IS NOT NULL AND p2.rating IS NULL)
            OR e.player2_id IS NULL) AS points_incomplete
    FROM tournament_entries e
    LEFT JOIN profiles p1 ON p1.id = e.player1_id
    LEFT JOIN profiles p2 ON p2.id = e.player2_id
    WHERE e.category_id = p_category_id
      -- Antes de fechar as inscrições ainda não há `selecionada` nenhuma, e
      -- é nessa altura que o organizador precisa dos pontos para escolher
      -- quem entra («Por pontos», no ecrã de fechar). Por isso vêm também
      -- as que estão à espera. Quem desistiu, quem ainda não tem parceiro e
      -- quem não respondeu ao convite ficam de fora: não se escolhe para o
      -- sorteio quem não se sabe se joga.
      AND e.status IN ('selecionada', 'validada', 'por_validar', 'suplente')
  ) x;

  RETURN v_out;
END;
$$;

-- ── As categorias, vistas pelo organizador ──────────────────────────────
-- A vista pública não serve aqui: esconde os torneios em rascunho e os que
-- o clube não quis mostrar, e é precisamente nesses que o organizador está
-- a trabalhar quando prepara o sorteio. Esta dá as categorias todas, com as
-- contas de que o ecrã precisa para dizer «17 duplas para 16 lugares».
CREATE OR REPLACE FUNCTION list_tournament_categories_admin(p_tournament_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_out JSONB;
BEGIN
  IF NOT is_tournament_admin(p_tournament_id) THEN
    RAISE EXCEPTION 'Só um admin do clube pode preparar o sorteio'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Devolve tambem os DIAS e as REGRAS do torneio: o assistente de formato
  -- precisa deles para dizer "cabe" ou "nao cabe" (horas de campo x duracao
  -- maxima do jogo), e ir busca-los a vista publica nao serve num torneio
  -- em rascunho.
  SELECT jsonb_build_object(
    'rules', (SELECT rules FROM tournaments WHERE id = p_tournament_id),
    'days', COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.date)
                        FROM tournament_days d WHERE d.tournament_id = p_tournament_id), '[]'::jsonb),
    'categories', COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.position, x.code), '[]'::jsonb))
    INTO v_out
  FROM (
    SELECT c.id, c.code, c.name, c.gender, c.level, c.age_group, c.slots,
           c.price_cents, c.day_date, c.start_time, c.third_place_match,
           c.format, c.status, c.position,
           (SELECT count(*) FROM tournament_entries e
             WHERE e.category_id = c.id AND e.status = 'selecionada') AS selected_count,
           (SELECT count(*) FROM tournament_entries e
             WHERE e.category_id = c.id AND e.status IN ('validada','por_validar')) AS waiting_count,
           (SELECT count(*) FROM tournament_entries e
             WHERE e.category_id = c.id AND e.status = 'suplente') AS waitlist_count,
           (SELECT count(*) FROM tournament_entries e
             WHERE e.category_id = c.id AND e.status IN ('convite','sem_parceiro')) AS incomplete_count,
           (SELECT count(*) FROM tournament_groups g WHERE g.category_id = c.id) AS group_count,
           (SELECT count(*) FROM tournament_matches m WHERE m.category_id = c.id) AS match_count,
           (SELECT count(*) FROM tournament_matches m
             WHERE m.category_id = c.id
               AND m.status IN ('terminado','falta','desistencia')) AS played_count
    FROM tournament_categories c
    WHERE c.tournament_id = p_tournament_id
  ) x;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION list_category_seeding(UUID) FROM public, anon;
REVOKE ALL ON FUNCTION list_tournament_categories_admin(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION list_category_seeding(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION list_tournament_categories_admin(UUID) TO authenticated;
