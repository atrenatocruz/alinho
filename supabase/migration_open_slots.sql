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
CREATE OR REPLACE FUNCTION lock_open_slot_level()
RETURNS TRIGGER AS $$
DECLARE
  v_org_id UUID;
  v_origin TEXT;
  v_current_level TEXT;
  v_member_level TEXT;
BEGIN
  IF NEW.status != 'confirmed' THEN
    RETURN NEW;
  END IF;

  SELECT organization_id, origin, level INTO v_org_id, v_origin, v_current_level
  FROM games WHERE id = NEW.game_id;

  IF v_origin != 'open_slot' OR v_current_level IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT level INTO v_member_level
  FROM memberships
  WHERE user_id = NEW.user_id AND organization_id = v_org_id;

  -- memberships.level é um campo legado que ainda pode conter valores fora
  -- da escala M1-M6/F1-F6 que games.level aceita (ex: 'iniciante' de contas
  -- antigas) — ignora silenciosamente em vez de rebentar a inserção do
  -- participante com uma violação de CHECK.
  IF v_member_level ~ '^[MF][1-6]$' THEN
    UPDATE games SET level = v_member_level, updated_at = NOW()
    WHERE id = NEW.game_id AND level IS NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS open_slot_level_lock_trigger ON participants;
CREATE TRIGGER open_slot_level_lock_trigger
AFTER INSERT ON participants
FOR EACH ROW EXECUTE FUNCTION lock_open_slot_level();
