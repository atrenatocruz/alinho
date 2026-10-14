-- ═════════════════════════════════════════════════════════════════════════
-- Jogo em aberto: o preço especial fica nos horários onde já há quem jogue
--
-- PORQUÊ. Decisão do Francisco no #586 (4.2, via Dev 1): «Nos horários em
-- que já há quem jogue, fica o preço de antes.» — como o preço normal, que o
-- update_open_slot_batch já não muda nos horários com gente confirmada. O
-- set_event_special_price, com p_kind 'open_slot', gravava (ou apagava) o
-- preço especial em todos os horários do lote.
--
-- O QUE FAZ. set_event_special_price, com p_kind 'open_slot', salta os
-- horários que já têm alguém confirmado: não grava nem apaga a linha deles
-- em event_special_prices; fica o de antes. Os outros tipos (mix, série,
-- categoria) ficam iguais. Corpo VIVO, 1 troca literal («já estava»).
--
-- ORDEM. Depois de migration_preco_especial.sql (e das que o acertaram).
--
-- Dev 3, 13 out 2026 · ecrã: Dev 1
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_frag CONSTANT TEXT := E'    v_games := ARRAY[p_id];\n  END IF;';
  -- Sem os \r: colado no SQL Editor a partir de um ficheiro com CRLF, o corpo
  -- vivo pode tê-los, e o pedaço a trocar tem duas linhas.
  v_def  TEXT := replace(pg_get_functiondef('public.set_event_special_price(text,uuid,numeric,text,uuid[])'::regprocedure), E'\r', '');
BEGIN
  IF v_def LIKE '%fica o preço de antes%' THEN
    RAISE NOTICE 'set_event_special_price: já estava';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_frag, ''))) / length(c_frag) <> 1 THEN
    RAISE EXCEPTION 'set_event_special_price: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE replace(v_def, c_frag, c_frag || $b$
  -- Jogo em aberto: nos horários em que já há quem jogue, fica o preço de
  -- antes (Francisco, #586 4.2), como no preço normal.
  IF p_kind = 'open_slot' THEN
    v_games := ARRAY(SELECT x FROM unnest(v_games) AS x
                      WHERE NOT EXISTS (SELECT 1 FROM participants pp
                                         WHERE pp.game_id = x AND pp.status = 'confirmed'));
  END IF;$b$);
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.set_event_special_price(text,uuid,numeric,text,uuid[])'::regprocedure) LIKE '%fica o preço de antes%';  -- true
