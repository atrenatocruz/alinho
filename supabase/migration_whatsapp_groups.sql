-- ════════════════════════════════════════════════════════════════════════
-- Bot WhatsApp multi-grupo / multi-clube (spec 2026-09-08)
--
-- Um processo de bot (uma conta WhatsApp) passa a servir N grupos, cada
-- grupo mapeado a um clube e, opcionalmente, a níveis de mix (M6..M1).
-- Substitui o modelo "organizations.whatsapp_group_jid" (um TEXT único).
--
-- A coluna antiga NÃO é removida: fica como fallback legacy do bot (um
-- bot antigo ignora esta tabela; um bot novo funciona sem ela). A gestão
-- de grupos continua por SQL manual, como o campo antigo — UI fica para
-- o plano club.
--
-- Correr este ficheiro inteiro no Supabase → SQL Editor.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS whatsapp_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Um grupo WhatsApp pertence a exatamente um clube.
  group_jid TEXT NOT NULL UNIQUE,
  -- Só para humanos ("Grupo principal", "M6 Almada") — nunca aparece nas
  -- mensagens.
  label TEXT,
  -- Filtro de nível: NULL = o grupo vê todos os mixes do clube; caso
  -- contrário só vê mixes com games.level dentro deste array (mixes sem
  -- nível aparecem em todos os grupos do clube). CHECK contra a lista de
  -- bandas válidas — o filtro compara strings exatas, e um 'm6' minúsculo
  -- inserido à mão esconderia mixes para sempre sem erro em lado nenhum.
  levels TEXT[] CHECK (levels IS NULL OR levels <@ ARRAY['M1','M2','M3','M4','M5','M6','F1','F2','F3','F4','F5','F6']),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_groups_org ON whatsapp_groups(organization_id);

-- Deny-all para clientes: só o service role do bot e SQL manual tocam
-- nisto — exatamente o regime do whatsapp_group_jid antigo (que nunca
-- teve writer na app nem grant de UPDATE).
ALTER TABLE whatsapp_groups ENABLE ROW LEVEL SECURITY;

-- Nível opcional do mix, para o filtro grupo→nível. CHECK como as outras
-- colunas enum-like do schema (format, gender_restriction…) — a UI só
-- oferece M6..M1, mas as bandas F ficam já válidas para quando existirem
-- grupos dessa escala. Também em game_recurrences, para as ocorrências
-- herdarem o nível (mesmo padrão de migration_mix_auto_start.sql para
-- auto_start_hours_before).
ALTER TABLE games ADD COLUMN IF NOT EXISTS level TEXT
  CHECK (level IS NULL OR level IN ('M1','M2','M3','M4','M5','M6','F1','F2','F3','F4','F5','F6'));
ALTER TABLE game_recurrences ADD COLUMN IF NOT EXISTS level TEXT
  CHECK (level IS NULL OR level IN ('M1','M2','M3','M4','M5','M6','F1','F2','F3','F4','F5','F6'));

-- ── process_due_game_recurrences — carrega level para cada ocorrência,
--    tal como gender_restriction e os restantes campos do snapshot. ──────
CREATE OR REPLACE FUNCTION process_due_game_recurrences()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec RECORD;
  v_new_date TIMESTAMPTZ;
BEGIN
  FOR rec IN
    SELECT g.id AS pending_game_id, g.date AS pending_date, gr.*
    FROM games g
    JOIN game_recurrences gr ON gr.id = g.recurrence_id
    WHERE g.status = 'pending' AND g.launch_at <= now() AND gr.is_active = true
    FOR UPDATE OF g SKIP LOCKED
  LOOP
    IF EXISTS (
      SELECT 1 FROM games
      WHERE recurrence_id = rec.id AND status IN ('open', 'closed', 'in_progress')
    ) THEN
      CONTINUE;
    END IF;

    UPDATE games SET status = 'open', updated_at = now(), launch_at = NULL WHERE id = rec.pending_game_id;

    v_new_date := (
      (rec.pending_date AT TIME ZONE 'Europe/Lisbon') + (CASE rec.frequency
            WHEN 'daily'   THEN interval '1 day'
            WHEN 'weekly'  THEN interval '1 week'
            WHEN 'monthly' THEN interval '1 month'
            WHEN 'yearly'  THEN interval '1 year'
          END)
    ) AT TIME ZONE 'Europe/Lisbon';

    IF (rec.ends_type = 'on_date' AND v_new_date > rec.ends_on)
       OR (rec.ends_type = 'after_occurrences' AND rec.occurrences_created >= rec.ends_after_occurrences) THEN
      UPDATE game_recurrences SET is_active = false, updated_at = now() WHERE id = rec.id;
      CONTINUE;
    END IF;

    INSERT INTO games (
      organization_id, title, date, location, price_per_player, prize,
      num_courts, max_players, court_time_minutes, game_time_minutes, format,
      gender_restriction, auto_start_hours_before, level,
      status, created_by, recurrence_id, is_recurrence_origin, launch_at
    )
    VALUES (
      rec.organization_id, rec.title, v_new_date, rec.location, rec.price_per_player, rec.prize,
      rec.num_courts, rec.num_courts * 4, rec.court_time_minutes, rec.game_time_minutes, rec.format,
      rec.gender_restriction, rec.auto_start_hours_before, rec.level,
      'pending', rec.created_by, rec.id, false,
      v_new_date - make_interval(secs => rec.mix_offset_seconds)
    )
    ON CONFLICT (recurrence_id, date) WHERE recurrence_id IS NOT NULL DO NOTHING;

    UPDATE game_recurrences
    SET occurrences_created = occurrences_created + 1, updated_at = now()
    WHERE id = rec.id;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION process_due_game_recurrences() FROM public;

-- Seed: cada JID legacy vira uma linha da tabela nova.
INSERT INTO whatsapp_groups (organization_id, group_jid, label)
SELECT id, whatsapp_group_jid, 'Grupo principal'
FROM organizations
WHERE whatsapp_group_jid IS NOT NULL
ON CONFLICT (group_jid) DO NOTHING;

-- ── Como adicionar um grupo novo (ex.: o clube do Pedro) ────────────────
-- 1. Adicionar a conta WhatsApp do bot ao grupo.
-- 2. Capturar o JID do grupo no log de arranque do bot (lista todos os
--    grupos em que a conta está, com JID).
-- 3. Correr (com os valores reais):
--
-- INSERT INTO whatsapp_groups (organization_id, group_jid, label)
-- VALUES ('<uuid da organization do Pedro>', '1203...@g.us', 'Grupo do Pedro');
--
-- Com filtro de nível (grupo só vê mixes M6/M5):
-- INSERT INTO whatsapp_groups (organization_id, group_jid, label, levels)
-- VALUES ('<uuid>', '1203...@g.us', 'M6+M5', ARRAY['M6','M5']);
