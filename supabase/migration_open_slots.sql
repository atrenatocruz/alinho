-- ════════════════════════════════════════════════════════════════════════
-- Jogos em aberto via WhatsApp — origin/open_batch_id em games + trigger
-- de nível dinâmico. Ver docs/superpowers/specs/2026-09-16-jogos-abertos-
-- whatsapp-design.md. Idempotente — pode ser corrida mais que uma vez.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE games ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'admin'
  CHECK (origin IN ('admin', 'open_slot'));

ALTER TABLE games ADD COLUMN IF NOT EXISTS open_batch_id UUID;

CREATE INDEX IF NOT EXISTS games_open_batch_id_idx ON games(open_batch_id)
  WHERE open_batch_id IS NOT NULL;

-- Ao primeiro participante confirmado num jogo em aberto sem nível ainda
-- definido, copia o nível da membership do clube para games.level — só
-- informativo (groups.js's mixVisibleToGroup nunca filtra jogos em aberto
-- por nível), nunca bloqueia entradas seguintes. SECURITY DEFINER pelo
-- mesmo motivo do check_game_full existente (schema.sql:452-454): quem
-- entra não é admin do clube, e sem isto a UPDATE seria bloqueada por
-- "Org admins can update games".
-- Bandas e prefixo de género espelham src/lib/elo.js's BANDS/ratingBand()
-- exatamente (ler esse ficheiro antes de mexer aqui): 1800→1, 1600→2,
-- 1400→3, 1200→4, 1000→5, 700→6; abaixo de 700, ou rating NULL, não há
-- banda derivável (o equivalente a "Iniciante", que games.level's CHECK
-- não aceita). Prefixo: 'feminino'→F, 'masculino'→M, qualquer outro valor
-- (incluindo NULL — profiles.gender é opcional) não tem prefixo válido —
-- ratingBand() usa 'N' aí, mas games.level's CHECK só aceita M1-M6/F1-F6,
-- por isso um género por preencher também deixa games.level por definir.
CREATE OR REPLACE FUNCTION lock_open_slot_level()
RETURNS TRIGGER AS $$
DECLARE
  v_org_id UUID;
  v_origin TEXT;
  v_current_level TEXT;
  v_rating NUMERIC;
  v_gender TEXT;
  v_band_num INT;
  v_prefix TEXT;
  v_computed_level TEXT;
BEGIN
  IF NEW.status IS DISTINCT FROM 'confirmed' THEN
    RETURN NEW;
  END IF;

  SELECT organization_id, origin, level INTO v_org_id, v_origin, v_current_level
  FROM games WHERE id = NEW.game_id;

  IF v_origin != 'open_slot' OR v_current_level IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT rating, gender INTO v_rating, v_gender
  FROM profiles
  WHERE id = NEW.user_id;

  IF v_rating IS NULL THEN
    RETURN NEW;
  END IF;

  v_band_num := CASE
    WHEN v_rating >= 1800 THEN 1
    WHEN v_rating >= 1600 THEN 2
    WHEN v_rating >= 1400 THEN 3
    WHEN v_rating >= 1200 THEN 4
    WHEN v_rating >= 1000 THEN 5
    WHEN v_rating >= 700 THEN 6
    ELSE NULL
  END;

  IF v_band_num IS NULL THEN
    RETURN NEW;
  END IF;

  v_prefix := CASE
    WHEN v_gender = 'feminino' THEN 'F'
    WHEN v_gender = 'masculino' THEN 'M'
    ELSE NULL
  END;

  IF v_prefix IS NULL THEN
    RETURN NEW;
  END IF;

  v_computed_level := v_prefix || v_band_num;

  -- Belt-and-braces: por construção isto já devia respeitar a escala, mas
  -- guarda-se contra uma futura mudança à lógica das bandas que viole o
  -- CHECK de games.level.
  IF v_computed_level ~ '^[MF][1-6]$' THEN
    UPDATE games SET level = v_computed_level, updated_at = NOW()
    WHERE id = NEW.game_id AND level IS NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS open_slot_level_lock_trigger ON participants;
CREATE TRIGGER open_slot_level_lock_trigger
AFTER INSERT ON participants
FOR EACH ROW EXECUTE FUNCTION lock_open_slot_level();
