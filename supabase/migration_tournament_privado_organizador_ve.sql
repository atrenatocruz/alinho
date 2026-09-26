-- ═════════════════════════════════════════════════════════════════════════
-- #568 — Torneio privado: o organizador e os marcadores veem Grupos,
-- Quadro, Calendário e a folha de imprimir.
--
-- O que se passava (QA, 25 set): as três vistas que esses separadores leem
-- (tournament_public_groups, _entries e _matches) passam pela
-- tournament_public, que só tem torneios publicados. Num torneio privado —
-- o Smash Cup está privado até ser publicado — até o organizador via
-- «ainda não sorteado».
--
-- O que faz:
--   1. tournament_board_visible(torneio, categoria): quem vê o quadro — toda
--      a gente num torneio publicado (e que não seja rascunho, como até
--      aqui), e num privado o organizador (admin do clube ou da
--      plataforma), os marcadores dessa categoria (can_score_tournament) e
--      quem está inscrito nessa categoria (acrescentado a 26 set, decisão
--      do PO: os jogadores veem os seus jogos, grupos e quadro).
--      Pode-se correr outra vez: a função é substituída e as vistas dizem
--      «já estava».
--   2. As três vistas deixam de juntar a tournament_public e passam a
--      juntar tournaments com essa regra. Mesmas colunas, pela mesma ordem;
--      troca-se só o JOIN no corpo vivo (pg_get_viewdef), e recusa se não o
--      encontrar exatamente uma vez.
-- NÃO mexe na tournament_public nem na tournament_public_categories: são
-- as listas (descobrir torneios, torneios abertos), e um privado não deve
-- aparecer lá.
--
-- ⚠️ PORQUE a função nova tem EXECUTE para anon (ao contrário da regra de
-- 25 set): numa vista, as funções que ela chama são verificadas com as
-- permissões de QUEM LÊ, não do dono da vista. Sem o GRANT a anon, a página
-- pública do torneio partia para quem não tem sessão («permission denied
-- for function»). A função só devolve verdadeiro/falso sobre o próprio
-- pedido: a quem não tem sessão, verdadeiro só nos torneios publicados.
-- PUBLIC fica revogado; o GRANT é explícito a anon e a authenticated.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

-- ── 0. Peças de que depende ─────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.can_score_tournament(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'Falta can_score_tournament(uuid, uuid). Parar e ler.';
  END IF;
END $$;

-- ── 1. Quem vê o quadro ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tournament_board_visible(p_tournament_id UUID, p_category_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM tournaments t
                  WHERE t.id = p_tournament_id AND t.is_public AND t.status <> 'rascunho')
      OR can_score_tournament(p_tournament_id, p_category_id)
      -- Quem está inscrito nessa categoria vê os seus jogos, grupos e quadro
      -- (decisão do PO, 26 set). Sem sessão, auth.uid() é nulo e não conta.
      OR EXISTS (SELECT 1 FROM tournament_entries e
                  WHERE e.category_id = p_category_id
                    AND auth.uid() IN (e.player1_id, e.player2_id));
$$;

REVOKE ALL ON FUNCTION public.tournament_board_visible(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tournament_board_visible(UUID, UUID) TO anon, authenticated;

-- ── 2. As três vistas do quadro passam a usá-la ─────────────────────────
DO $$
DECLARE
  c_join_mau CONSTANT TEXT := 'JOIN tournament_public t ON \(\(t\.id = c\.tournament_id\)\)';
  c_join_bom CONSTANT TEXT :=
    'JOIN tournaments t ON ((t.id = c.tournament_id) AND tournament_board_visible(t.id, c.id))';
  v_view TEXT;
  v_def  TEXT;
  v_opts TEXT[];
BEGIN
  FOREACH v_view IN ARRAY ARRAY['tournament_public_groups', 'tournament_public_entries', 'tournament_public_matches'] LOOP
    IF to_regclass('public.' || v_view) IS NULL THEN
      RAISE EXCEPTION 'Não existe a vista %. Parar e ler.', v_view;
    END IF;
    v_def := pg_get_viewdef(('public.' || v_view)::regclass);
    IF position('tournament_board_visible' IN v_def) > 0 THEN
      RAISE NOTICE '%: já estava.', v_view;
      CONTINUE;
    END IF;
    IF (SELECT count(*) FROM regexp_matches(v_def, c_join_mau, 'g')) <> 1 THEN
      RAISE EXCEPTION '%: o JOIN à tournament_public não aparece exatamente uma vez. Ler a vista viva.', v_view;
    END IF;
    SELECT reloptions INTO v_opts FROM pg_class WHERE oid = ('public.' || v_view)::regclass;
    EXECUTE format('CREATE OR REPLACE VIEW public.%I%s AS %s',
      v_view,
      CASE WHEN v_opts IS NULL THEN '' ELSE ' WITH (' || array_to_string(v_opts, ', ') || ')' END,
      regexp_replace(v_def, c_join_mau, c_join_bom));
    RAISE NOTICE '%: o organizador e os marcadores veem o quadro de um torneio privado.', v_view;
  END LOOP;
END $$;
