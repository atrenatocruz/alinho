-- ═════════════════════════════════════════════════════════════════════════
-- Torneio: avisos no sino quando sai o sorteio e quando a categoria termina
--
-- PORQUÊ. QA, 14 out (torneio de ponta a ponta «Open QA Outono»): num
-- torneio inteiro o sino dos jogadores só recebeu um aviso. Não havia aviso
-- de «saiu o sorteio» nem de «terminou» (o mix tem «o mix terminou»), e o
-- Francisco pediu «o aviso no sino» no fim. Aprovado pelo PO a 14 out; puxado
-- para sexta 16. Linha do sino e textos: Dev 1 com a UX (nomes combinados).
--
-- O QUE FAZ. Um gatilho em tournament_categories, que corre no fim da
-- transação (deferred), para ver os jogos e os lugares já gravados:
--   1. a categoria passa a 'sorteada' → 'tournament_drawn' a cada pessoa com
--      conta numa dupla selecionada:
--        {tournament_id, tournament_slug, tournament_name, category_id,
--         category_code, entry_id, first_match_at, court_name}
--      first_match_at e court_name são do primeiro jogo da dupla (null se
--      ainda não há horas — o texto diz «as horas saem em breve»). Um novo
--      sorteio da mesma categoria marca como lidos os avisos de sorteio
--      antigos dela e manda os novos.
--   2. a categoria passa a 'terminada' → 'tournament_finished' a cada pessoa
--      com conta numa dupla selecionada:
--        {tournament_id, tournament_slug, tournament_name, category_id,
--         category_code, entry_id, final_position, champion_name, entry_name}
--      final_position: 1, 2, 3 ou null (o mesmo lugar do fim do torneio);
--      champion_name e entry_name: o nome da dupla («Ana / Rita», ou o nome
--      da equipa se tiver).
--   Corrigir um resultado depois (a categoria continua 'terminada') não
--   manda outro aviso. Quem faz o sorteio ou fecha a categoria também
--   recebe, se jogar nela: é o seu jogo, não uma mudança que fez a outros.
--
-- Dev 3, 14 out 2026 · ecrã: Dev 1
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- O nome de uma dupla, para os avisos.
CREATE OR REPLACE FUNCTION public.tournament_entry_display_name(p_entry_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT COALESCE(NULLIF(btrim(e.team_name), ''),
                  NULLIF(concat_ws(' / ', COALESCE(p1.name, e.guest1_name), COALESCE(p2.name, e.guest_name)), ''))
    FROM tournament_entries e
    LEFT JOIN profiles p1 ON p1.id = e.player1_id
    LEFT JOIN profiles p2 ON p2.id = e.player2_id
   WHERE e.id = p_entry_id;
$function$;
REVOKE ALL ON FUNCTION public.tournament_entry_display_name(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tournament_categories_draw_finish_notice()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  c tournament_categories%ROWTYPE;
  t tournaments%ROWTYPE;
BEGIN
  -- Deferred: lê o estado no fim da transação (jogos e lugares já gravados).
  SELECT * INTO c FROM tournament_categories WHERE id = NEW.id;
  IF c.id IS NULL OR c.status IS DISTINCT FROM NEW.status THEN RETURN NULL; END IF;
  SELECT * INTO t FROM tournaments WHERE id = c.tournament_id;

  IF NEW.status = 'sorteada' THEN
    -- Um sorteio novo da mesma categoria substitui o aviso antigo.
    UPDATE notifications SET read_at = TIMEZONE('utc', NOW())
     WHERE kind = 'tournament_drawn' AND read_at IS NULL AND data->>'category_id' = c.id::text;

    INSERT INTO notifications (user_id, kind, actor_id, data)
    SELECT x.uid, 'tournament_drawn', auth.uid(),
           jsonb_build_object(
             'tournament_id', t.id, 'tournament_slug', t.slug, 'tournament_name', t.name,
             'category_id', c.id, 'category_code', c.code, 'entry_id', e.id,
             'first_match_at', fm.scheduled_at, 'court_name', fm.court_name)
      FROM tournament_entries e
      CROSS JOIN LATERAL (VALUES (e.player1_id), (e.player2_id)) AS x(uid)
      LEFT JOIN LATERAL (
        SELECT m.scheduled_at, tc.name AS court_name
          FROM tournament_matches m
          LEFT JOIN tournament_courts tc ON tc.id = m.court_id
         WHERE m.category_id = c.id AND e.id IN (m.entry_a_id, m.entry_b_id)
         ORDER BY m.scheduled_at NULLS LAST, m.bracket_slot NULLS LAST
         LIMIT 1) fm ON TRUE
     WHERE e.category_id = c.id AND e.status = 'selecionada' AND x.uid IS NOT NULL;

  ELSIF NEW.status = 'terminada' THEN
    INSERT INTO notifications (user_id, kind, actor_id, data)
    SELECT x.uid, 'tournament_finished', auth.uid(),
           jsonb_build_object(
             'tournament_id', t.id, 'tournament_slug', t.slug, 'tournament_name', t.name,
             'category_id', c.id, 'category_code', c.code, 'entry_id', e.id,
             'final_position', COALESCE(
                (SELECT s.final_position FROM tournament_player_stats s WHERE s.category_id = c.id AND s.user_id = x.uid),
                CASE WHEN e.id = c.champion_entry_id THEN 1 WHEN e.id = c.runner_up_entry_id THEN 2
                     WHEN e.id = c.third_entry_id THEN 3 END),
             'champion_name', tournament_entry_display_name(c.champion_entry_id),
             'entry_name', tournament_entry_display_name(e.id))
      FROM tournament_entries e
      CROSS JOIN LATERAL (VALUES (e.player1_id), (e.player2_id)) AS x(uid)
     WHERE e.category_id = c.id AND e.status = 'selecionada' AND x.uid IS NOT NULL;
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.tournament_categories_draw_finish_notice() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tournament_categories_draw_finish_notice ON tournament_categories;
CREATE CONSTRAINT TRIGGER tournament_categories_draw_finish_notice
  AFTER UPDATE OF status ON tournament_categories
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.status IN ('sorteada', 'terminada') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.tournament_categories_draw_finish_notice();

COMMIT;

-- Verificar depois de correr (true):
--   SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tournament_categories_draw_finish_notice')
--      AND NOT has_function_privilege('authenticated', 'public.tournament_entry_display_name(uuid)', 'EXECUTE');
