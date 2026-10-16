-- ═════════════════════════════════════════════════════════════════════════
-- Mix: avisar os inscritos quando as regras mudam
--
-- PORQUÊ. SPEC design-handoff/2026-10-13-serie-so-este-ou-seguintes/
-- (aprovado pelo Francisco): ao guardar mudanças numa data de uma série, a
-- app pergunta «Só este mix» ou «Este e os seguintes»; os inscritos de
-- todos os mixes que mudam recebem um aviso no sino («O Mix de terça de
-- 27 out mudou: preço 10,00 €, formato Sobe e desce.»). Ecrã: Dev 2.
-- Chamada explícita (e não um gatilho em games): quem escolhe «só este /
-- seguintes» é o ecrã, e um gatilho avisaria em qualquer update.
--
-- O QUE FAZ. notify_mix_changed(p_game_ids uuid[], p_changes jsonb):
--   · só para quem é admin do clube de TODOS esses mixes (senão
--     'not_admin'); p_changes tem de ser uma lista ('bad_input');
--   · para cada mix, um aviso 'mix_changed' a cada pessoa com conta inscrita
--     (confirmed ou waitlisted, e os parceiros com conta), menos a quem muda;
--     data = {game_title, game_date, changes} — changes como chegam, com
--     códigos (ex.: [{field: 'price', value: 10}]); o ecrã escreve a frase;
--   · devolve [{game_id, notified}].
--
-- Dev 3, 13 out 2026 · ecrã: Dev 2
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.notify_mix_changed(p_game_ids UUID[], p_changes JSONB)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  g     RECORD;
  v_n   INTEGER;
  v_out JSONB := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_game_ids IS NULL OR cardinality(p_game_ids) = 0 THEN RAISE EXCEPTION 'not_admin'; END IF;
  IF jsonb_typeof(p_changes) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'bad_input'; END IF;
  -- Todos os mixes têm de existir e ser de um clube que esta pessoa organiza.
  IF (SELECT count(*) FROM games WHERE id = ANY (p_game_ids) AND is_org_admin(organization_id))
     <> (SELECT count(DISTINCT x) FROM unnest(p_game_ids) x) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  FOR g IN SELECT id, title, date FROM games WHERE id = ANY (p_game_ids) ORDER BY date LOOP
    INSERT INTO notifications (user_id, kind, game_id, actor_id, data)
    SELECT DISTINCT u.uid, 'mix_changed', g.id, auth.uid(),
           jsonb_build_object('game_title', g.title, 'game_date', g.date, 'changes', p_changes)
      FROM participants p
      CROSS JOIN LATERAL (VALUES (p.user_id), (p.partner_id)) AS u(uid)
     WHERE p.game_id = g.id AND p.status IN ('confirmed', 'waitlisted')
       AND u.uid IS NOT NULL AND u.uid <> auth.uid();
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_array(jsonb_build_object('game_id', g.id, 'notified', v_n));
  END LOOP;
  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_mix_changed(UUID[], JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_mix_changed(UUID[], JSONB) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT has_function_privilege('anon', 'public.notify_mix_changed(uuid[],jsonb)', 'EXECUTE');  -- false
