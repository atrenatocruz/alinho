-- ═════════════════════════════════════════════════════════════════════════
-- Editar o jogo em aberto (a publicação inteira)
--
-- PORQUÊ. Auditoria «editar tem tudo do criar» (#586, ponto 5;
-- design-handoff/2026-09-27-editar-tem-tudo/AUDITORIA.md), aprovada pelo
-- Francisco. Hoje o criar faz INSERT direto em games e nada no servidor
-- tranca o que se pode mudar depois. Ecrã: Dev 1 (nomes dele, 28 set).
--
-- O QUE FAZ. update_open_slot_batch(p_batch_id, p_price, p_slots) → jsonb
-- (os ids dos jogos da publicação que ficam ativos). Só o admin do clube.
--   · p_slots: [{ game_id?, starts_at, minutes }] — a lista inteira dos
--     horários que devem ficar.
--   · Com game_id: muda o dia/hora (date) e a duração (court_time_minutes).
--   · Sem game_id: junta um horário novo à publicação (como o criar; herda
--     as horas do WhatsApp da publicação).
--   · Os horários ativos que não vierem na lista são cancelados.
--   · Preço: p_price vale para os horários SEM ninguém confirmado (PO, 28
--     set: «ninguém pode ver o preço mudar depois de ter confirmado» — a
--     mesma ideia da turma). Nos horários com confirmados fica o que estava.
--   · O cadeado é por horário: um horário com alguém confirmado não muda
--     de dia, de hora nem de duração, e não é cancelado ('slot_taken').
--   · Os cancelados e os acabados não mexem.
--   Erros: not_allowed, bad_slot, slot_taken.
-- As horas do WhatsApp continuam no set_event_whatsapp_post_times.
--
-- Dev 3, 28 set 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.is_org_admin(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Falta is_org_admin(uuid). Parar e ler.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.update_open_slot_batch(p_batch_id UUID, p_price NUMERIC, p_slots JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org   UUID;
  v_times TIME[];
  v_keep  UUID[] := '{}';
  s       JSONB;
  g       games%ROWTYPE;
  v_id    UUID;
  v_at    TIMESTAMPTZ;
  v_min   INTEGER;
  v_taken BOOLEAN;
BEGIN
  SELECT organization_id INTO v_org FROM games
   WHERE open_batch_id = p_batch_id AND origin = 'open_slot' LIMIT 1;
  IF v_org IS NULL OR auth.uid() IS NULL OR NOT is_org_admin(v_org) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  IF jsonb_typeof(p_slots) IS DISTINCT FROM 'array' OR jsonb_array_length(p_slots) = 0 THEN
    RAISE EXCEPTION 'bad_slot';
  END IF;
  IF p_price IS NOT NULL AND p_price < 0 THEN RAISE EXCEPTION 'bad_slot'; END IF;
  PERFORM 1 FROM games WHERE open_batch_id = p_batch_id FOR UPDATE;
  SELECT whatsapp_post_times INTO v_times FROM games
   WHERE open_batch_id = p_batch_id AND whatsapp_post_times IS NOT NULL LIMIT 1;

  FOR s IN SELECT * FROM jsonb_array_elements(p_slots) LOOP
    BEGIN
      v_at  := (s->>'starts_at')::timestamptz;
      v_min := (s->>'minutes')::integer;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'bad_slot';
    END;
    IF v_at IS NULL OR v_min IS NULL OR v_min <= 0 THEN RAISE EXCEPTION 'bad_slot'; END IF;

    IF NULLIF(s->>'game_id', '') IS NOT NULL THEN
      SELECT * INTO g FROM games
       WHERE id = (s->>'game_id')::uuid AND open_batch_id = p_batch_id AND origin = 'open_slot';
      IF g.id IS NULL OR g.status IN ('cancelled', 'finished', 'completed') OR g.id = ANY (v_keep) THEN
        RAISE EXCEPTION 'bad_slot';
      END IF;
      v_taken := EXISTS (SELECT 1 FROM participants WHERE game_id = g.id AND status = 'confirmed');
      IF v_taken AND (g.date IS DISTINCT FROM v_at OR g.court_time_minutes IS DISTINCT FROM v_min) THEN
        RAISE EXCEPTION 'slot_taken';
      END IF;
      UPDATE games SET date = v_at, court_time_minutes = v_min,
             price_per_player = CASE WHEN v_taken THEN price_per_player ELSE p_price END,
             updated_at = NOW()
       WHERE id = g.id;
      v_keep := v_keep || g.id;
    ELSE
      INSERT INTO games (organization_id, title, date, court_time_minutes, price_per_player,
                         origin, open_batch_id, created_by, status, whatsapp_post_times)
      VALUES (v_org, 'Jogo em aberto', v_at, v_min, p_price,
              'open_slot', p_batch_id, auth.uid(), 'open', v_times)
      RETURNING id INTO v_id;
      v_keep := v_keep || v_id;
    END IF;
  END LOOP;

  -- Os que não vieram na lista saem — menos os que já têm confirmados.
  IF EXISTS (SELECT 1 FROM games g2
              WHERE g2.open_batch_id = p_batch_id AND g2.origin = 'open_slot'
                AND g2.status NOT IN ('cancelled', 'finished', 'completed')
                AND NOT (g2.id = ANY (v_keep))
                AND EXISTS (SELECT 1 FROM participants p WHERE p.game_id = g2.id AND p.status = 'confirmed')) THEN
    RAISE EXCEPTION 'slot_taken';
  END IF;
  UPDATE games SET status = 'cancelled', updated_at = NOW()
   WHERE open_batch_id = p_batch_id AND origin = 'open_slot'
     AND status NOT IN ('cancelled', 'finished', 'completed')
     AND NOT (id = ANY (v_keep));

  RETURN to_jsonb(v_keep);
END;
$$;
REVOKE ALL ON FUNCTION public.update_open_slot_batch(UUID, NUMERIC, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_open_slot_batch(UUID, NUMERIC, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_open_slot_batch(UUID, NUMERIC, JSONB) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT has_function_privilege('anon', 'public.update_open_slot_batch(uuid, numeric, jsonb)', 'EXECUTE');  -- false
