-- ═════════════════════════════════════════════════════════════════════════
-- Superadmins: o nome não fica nas ações feitas nos grupos onde não é
-- membro (histórico de entradas e saídas, e sino)
--
-- PORQUÊ. QA, 18 out: no histórico do mix, «· por Francisco Barros
-- (superadmin)». O ecrã lê o nome pelo actor_id, e o perfil do superadmin
-- continua legível para quem partilha OUTRO grupo com ele (ou um grupo
-- global). Esconder pelo perfil não chega: o nome tem de sair na origem.
-- Regra do Francisco, 18 out: nos grupos onde só entrou pelo acesso, o
-- superadmin fica escondido de toda a gente.
--
-- O QUE FAZ. Em participant_events e em notifications:
--   · coluna nova actor_hidden (verdadeiro quando quem fez é quem organiza
--     escondido);
--   · um gatilho antes de gravar: se o actor_id é um superadmin que NÃO é
--     membro do grupo do mix (game_id), deixa actor_id vazio, marca
--     actor_hidden e guarda quem foi numa tabela à parte
--     (superadmin_acoes_escondidas), que a app não lê — o id dele não chega
--     ao browser de ninguém (Dev 2, 18 out);
--   · o mesmo, uma vez, para o que já existe.
--   O ecrã mostra «Quem organiza» quando actor_hidden é verdadeiro
--   (Dev 2: histórico do mix e sino).
--
-- ORDEM. Depois de migration_superadmin_escondido.sql (que tira as
-- inscrições de acesso) e de migration_superadmin_modo.sql (platform_admins).
--
-- Dev 3, 18 out 2026 · ecrã: Dev 2
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE participant_events ADD COLUMN IF NOT EXISTS actor_hidden BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS actor_hidden BOOLEAN NOT NULL DEFAULT FALSE;

-- Quem foi, para auditoria, longe da app (sem regras de leitura).
CREATE TABLE IF NOT EXISTS superadmin_acoes_escondidas (
  tabela     TEXT NOT NULL,
  linha_id   UUID NOT NULL,
  actor_id   UUID NOT NULL,
  game_id    UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tabela, linha_id)
);
ALTER TABLE superadmin_acoes_escondidas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON superadmin_acoes_escondidas FROM PUBLIC, anon, authenticated;

-- Quem fez é um superadmin que não é membro do grupo deste mix?
CREATE OR REPLACE FUNCTION public.actor_is_hidden_organizer(p_actor UUID, p_game_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT p_actor IS NOT NULL AND p_game_id IS NOT NULL
     AND (EXISTS (SELECT 1 FROM profiles pr WHERE pr.id = p_actor AND pr.is_platform_admin)
          OR EXISTS (SELECT 1 FROM platform_admins pa WHERE pa.user_id = p_actor))
     AND NOT EXISTS (SELECT 1 FROM games g JOIN memberships m ON m.organization_id = g.organization_id
                      WHERE g.id = p_game_id AND m.user_id = p_actor);
$function$;
REVOKE ALL ON FUNCTION public.actor_is_hidden_organizer(UUID, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.hide_superadmin_actor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  -- O nome de quem organiza escondido não fica na ação (18 out).
  IF actor_is_hidden_organizer(NEW.actor_id, NEW.game_id) THEN
    INSERT INTO superadmin_acoes_escondidas (tabela, linha_id, actor_id, game_id)
    VALUES (TG_TABLE_NAME, NEW.id, NEW.actor_id, NEW.game_id)
    ON CONFLICT (tabela, linha_id) DO NOTHING;
    NEW.actor_id := NULL;
    NEW.actor_hidden := TRUE;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.hide_superadmin_actor() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS participant_events_hide_superadmin ON participant_events;
CREATE TRIGGER participant_events_hide_superadmin
  BEFORE INSERT ON participant_events
  FOR EACH ROW WHEN (NEW.actor_id IS NOT NULL)
  EXECUTE FUNCTION public.hide_superadmin_actor();

DROP TRIGGER IF EXISTS notifications_hide_superadmin ON notifications;
CREATE TRIGGER notifications_hide_superadmin
  BEFORE INSERT ON notifications
  FOR EACH ROW WHEN (NEW.actor_id IS NOT NULL AND NEW.game_id IS NOT NULL)
  EXECUTE FUNCTION public.hide_superadmin_actor();

-- O que já existe.
INSERT INTO superadmin_acoes_escondidas (tabela, linha_id, actor_id, game_id)
SELECT 'participant_events', e.id, e.actor_id, e.game_id FROM participant_events e
 WHERE e.actor_id IS NOT NULL AND actor_is_hidden_organizer(e.actor_id, e.game_id)
ON CONFLICT (tabela, linha_id) DO NOTHING;
INSERT INTO superadmin_acoes_escondidas (tabela, linha_id, actor_id, game_id)
SELECT 'notifications', n.id, n.actor_id, n.game_id FROM notifications n
 WHERE n.actor_id IS NOT NULL AND n.game_id IS NOT NULL AND actor_is_hidden_organizer(n.actor_id, n.game_id)
ON CONFLICT (tabela, linha_id) DO NOTHING;
UPDATE participant_events e SET actor_id = NULL, actor_hidden = TRUE
 WHERE e.id IN (SELECT linha_id FROM superadmin_acoes_escondidas WHERE tabela = 'participant_events') AND e.actor_id IS NOT NULL;
UPDATE notifications n SET actor_id = NULL, actor_hidden = TRUE
 WHERE n.id IN (SELECT linha_id FROM superadmin_acoes_escondidas WHERE tabela = 'notifications') AND n.actor_id IS NOT NULL;

COMMIT;

-- Verificar depois de correr (0 e 0):
--   SELECT count(*) FROM participant_events e WHERE e.actor_id IS NOT NULL AND actor_is_hidden_organizer(e.actor_id, e.game_id);
--   SELECT count(*) FROM notifications n WHERE n.actor_id IS NOT NULL AND n.game_id IS NOT NULL AND actor_is_hidden_organizer(n.actor_id, n.game_id);
