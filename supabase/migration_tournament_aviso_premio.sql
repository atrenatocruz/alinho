-- ═════════════════════════════════════════════════════════════════════════
-- Torneio: aviso aos inscritos quando o prémio de uma categoria muda
--
-- PORQUÊ. Auditoria «editar tem tudo do criar», ponto 2 (design-handoff/
-- 2026-09-27-editar-tem-tudo/AUDITORIA.md; Francisco disse sim a 28 set):
-- o editar do torneio passa a deixar mudar o prémio com inscritos, e quem
-- está inscrito tem de saber. A gravação já existe (update_tournament);
-- falta o aviso. Ecrã e textos do sino: Dev 1.
--
-- O QUE FAZ. Gatilho AFTER UPDATE OF prize_first, prize_second em
-- tournament_categories, só quando algum muda de facto.
--   · Avisa quem continua inscrito na categoria (todos os estados menos
--     'desistiu', também os suplentes): quem inscreveu, e o parceiro só se
--     já aceitou (como o tournament_entry_promoted_notice). Nunca quem fez a
--     mudança.
--   · notifications: kind 'tournament_prize_changed', actor_id auth.uid(),
--     data {tournament_id, tournament_slug, tournament_name, category_id,
--     category_code, category_name, prize_first, prize_second} — os prémios
--     novos (podem ser null).
--   · Um aviso destes ainda por ler da mesma categoria fica lido: mudar o
--     prémio duas vezes não deixa dois avisos, só o último.
--
-- Dev 3, 28 set 2026 · ecrã: Dev 1
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.tournament_prize_changed_notice()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_t    tournaments%ROWTYPE;
  v_data JSONB;
BEGIN
  IF NEW.prize_first IS NOT DISTINCT FROM OLD.prize_first
     AND NEW.prize_second IS NOT DISTINCT FROM OLD.prize_second THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_t FROM tournaments WHERE id = NEW.tournament_id;

  v_data := jsonb_build_object(
    'tournament_id',   v_t.id,
    'tournament_slug', v_t.slug,
    'tournament_name', v_t.name,
    'category_id',     NEW.id,
    'category_code',   NEW.code,
    'category_name',   NEW.name,
    'prize_first',     NEW.prize_first,
    'prize_second',    NEW.prize_second);

  -- Só o último aviso conta.
  UPDATE notifications SET read_at = NOW()
   WHERE kind = 'tournament_prize_changed' AND read_at IS NULL
     AND data->>'category_id' = NEW.id::text;

  INSERT INTO notifications (user_id, kind, actor_id, data)
  SELECT DISTINCT u.uid, 'tournament_prize_changed', auth.uid(), v_data
    FROM tournament_entries e,
         LATERAL (VALUES (e.player1_id),
                         (CASE WHEN e.partner_accepted_at IS NOT NULL THEN e.player2_id END)) AS u(uid)
   WHERE e.category_id = NEW.id
     AND e.status <> 'desistiu'
     AND u.uid IS NOT NULL
     AND u.uid IS DISTINCT FROM auth.uid();

  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.tournament_prize_changed_notice() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tournament_categories_prize_changed_notice ON tournament_categories;
CREATE TRIGGER tournament_categories_prize_changed_notice
  AFTER UPDATE OF prize_first, prize_second ON tournament_categories
  FOR EACH ROW EXECUTE FUNCTION tournament_prize_changed_notice();

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM pg_trigger WHERE tgname = 'tournament_categories_prize_changed_notice';  -- 1
--   SELECT has_function_privilege('authenticated', 'public.tournament_prize_changed_notice()', 'EXECUTE');  -- false
