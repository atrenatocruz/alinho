-- ════════════════════════════════════════════════════════════════════════
-- Migration: restrição de escalão etário num mix — Trello #212.
--
-- Decisão do Francisco (9 set 2026): escalões curtos — Sub-18 / 18-34 /
-- +35 / +45 — e a restrição **bloqueia** a inscrição, não avisa apenas.
-- Sem restrição, entra toda a gente, com ou sem data de nascimento.
--
-- OS "+" SÃO MÍNIMOS, NÃO GAVETAS
-- No desporto, um jogador de 50 anos pode jogar um torneio +35. Por isso
-- 'plus35' significa "35 ou mais" e 'plus45' significa "45 ou mais". Só
-- 'sub18' e '18_34' são intervalos fechados. Como etiqueta de perfil os
-- escalões continuam a ser gavetas exclusivas (quem tem 50 mostra "+45"),
-- mas para efeitos de inscrição valem como mínimo.
--
-- NULL = sem restrição. Deliberadamente NULLABLE, e não NOT NULL DEFAULT
-- como `gender_restriction`: o trigger abaixo precisa de distinguir "não
-- especificado" de "explicitamente sem restrição".
--
-- Correr este ficheiro todo no Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. As colunas ───────────────────────────────────────────────────────
ALTER TABLE games ADD COLUMN IF NOT EXISTS age_restriction TEXT
  CHECK (age_restriction IS NULL OR age_restriction IN ('sub18', '18_34', 'plus35', 'plus45'));
ALTER TABLE game_recurrences ADD COLUMN IF NOT EXISTS age_restriction TEXT
  CHECK (age_restriction IS NULL OR age_restriction IN ('sub18', '18_34', 'plus35', 'plus45'));

-- ── 2. Herança nas ocorrências de mixes recorrentes ─────────────────────
-- O caminho habitual seria recriar `process_due_game_recurrences`, como fez
-- a migration da restrição de género. NÃO se faz isso aqui: essa função tem
-- OITO definições espalhadas por migrations e não há como saber daqui qual
-- está viva na base de dados. Recriá-la a partir da base errada apagaria em
-- silêncio o que as outras acrescentaram, e partiria a criação de mixes
-- recorrentes — que vários clubes usam todas as semanas.
--
-- Um trigger é aditivo: não toca na função, funciona seja qual for a versão
-- viva, e apanha TODOS os caminhos de criação (o cron, a app e o bot), não
-- só o do cron.
CREATE OR REPLACE FUNCTION inherit_age_restriction_from_recurrence()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.recurrence_id IS NOT NULL AND NEW.age_restriction IS NULL THEN
    SELECT gr.age_restriction INTO NEW.age_restriction
    FROM game_recurrences gr WHERE gr.id = NEW.recurrence_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS games_inherit_age_restriction ON games;
CREATE TRIGGER games_inherit_age_restriction
BEFORE INSERT ON games
FOR EACH ROW EXECUTE FUNCTION inherit_age_restriction_from_recurrence();

REVOKE ALL ON FUNCTION inherit_age_restriction_from_recurrence() FROM public;

-- ── 3. Elegibilidade, como função reutilizável ──────────────────────────
-- Separada da policy para a policy não ficar ilegível, e para a app poder
-- ser testada contra a mesma regra. Idade em anos completos à data de hoje.
CREATE OR REPLACE FUNCTION meets_age_restriction(p_user_id UUID, p_restriction TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT CASE
    WHEN p_restriction IS NULL THEN true
    -- Sem data de nascimento não há como verificar: fica de fora. A app
    -- pede a data no momento, num modal, em vez de mandar a pessoa embora.
    WHEN (SELECT birthday FROM profiles WHERE id = p_user_id) IS NULL THEN false
    ELSE (
      WITH idade AS (
        SELECT date_part('year', age(current_date, p.birthday))::int AS anos
        FROM profiles p WHERE p.id = p_user_id
      )
      SELECT CASE p_restriction
        WHEN 'sub18'  THEN (SELECT anos FROM idade) < 18
        WHEN '18_34'  THEN (SELECT anos FROM idade) BETWEEN 18 AND 34
        WHEN 'plus35' THEN (SELECT anos FROM idade) >= 35
        WHEN 'plus45' THEN (SELECT anos FROM idade) >= 45
        ELSE true
      END
    )
  END;
$$;

REVOKE ALL ON FUNCTION meets_age_restriction(UUID, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION meets_age_restriction(UUID, TEXT) TO authenticated;

-- ── 4. A policy de inscrição ────────────────────────────────────────────
-- ATENÇÃO: esta policy tem três definições no repo e DUAS DELAS DISCORDAM —
-- a de `migration_mix_gender_restriction.sql` (2026-08-27) tem a verificação
-- de género, a de `schema.sql` (2026-08-28) NÃO TEM. Ou seja, o schema base
-- está desactualizado face às migrations, e um ambiente novo criado a partir
-- dele nasceria sem a restrição de género a ser aplicada.
--
-- Esta versão inclui as duas verificações — género E escalão — de propósito:
-- assim fica correcta quer a base de dados viva tenha hoje a versão com
-- género, quer tenha a sem. Não há forma de perder a restrição de género por
-- causa desta migration.
DROP POLICY IF EXISTS "Users can join games in their org" ON participants;
CREATE POLICY "Users can join games in their org"
  ON participants FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM games JOIN memberships ON memberships.organization_id = games.organization_id
      WHERE games.id = participants.game_id AND memberships.user_id = auth.uid()
    )
    -- Género (preservado da migration_mix_gender_restriction.sql)
    AND (
      (SELECT gender_restriction FROM games WHERE games.id = participants.game_id) IN ('indiferente', 'misto')
      OR (
        (SELECT gender FROM profiles WHERE id = participants.user_id)
          = (SELECT gender_restriction FROM games WHERE games.id = participants.game_id)
        AND (
          participants.partner_id IS NULL
          OR (SELECT gender FROM profiles WHERE id = participants.partner_id)
               = (SELECT gender_restriction FROM games WHERE games.id = participants.game_id)
        )
      )
    )
    -- Escalão etário (novo). O parceiro é verificado da mesma forma que no
    -- género: não faria sentido um mix +35 aceitar um par com alguém de 20.
    AND meets_age_restriction(
          participants.user_id,
          (SELECT age_restriction FROM games WHERE games.id = participants.game_id))
    AND (
      participants.partner_id IS NULL
      OR meets_age_restriction(
           participants.partner_id,
           (SELECT age_restriction FROM games WHERE games.id = participants.game_id))
    )
  );

COMMENT ON COLUMN games.age_restriction IS
  'Escalão exigido para entrar no mix: sub18 / 18_34 / plus35 / plus45. NULL = sem restrição. Os "plus" são mínimos (plus35 = 35 ou mais), não gavetas.';

-- ── 5. Mostrar o escalão no perfil de outro jogador ─────────────────────
-- O cartão pede duas coisas: restringir (acima) e **mostrar no perfil**.
-- Mostra-se o ESCALÃO, nunca a data de nascimento: é a informação que serve
-- ("é sénior ou não?") sem publicar a data de aniversário de ninguém.
--
-- Estende `get_player_public_extras`, criada em
-- migration_player_public_extras.sql. Correr esse ficheiro PRIMEIRO se
-- ainda não foi corrido — este só o substitui.
--
-- DROP antes do CREATE de propósito: mudar a lista de colunas devolvidas é
-- mudar o tipo de retorno, e `CREATE OR REPLACE` recusa-se a fazê-lo.
--
-- Aqui os escalões são GAVETAS EXCLUSIVAS (quem tem 50 mostra "+45"), ao
-- contrário de `meets_age_restriction` acima, onde os "+" são mínimos. É a
-- diferença entre etiquetar uma pessoa e decidir se ela pode entrar.
DROP FUNCTION IF EXISTS get_player_public_extras(UUID);
CREATE FUNCTION get_player_public_extras(p_user_id UUID)
RETURNS TABLE (nationality TEXT, gender TEXT, age_category TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    p.nationality,
    p.gender,
    CASE
      WHEN p.birthday IS NULL THEN NULL
      WHEN date_part('year', age(current_date, p.birthday))::int < 18 THEN 'sub18'
      WHEN date_part('year', age(current_date, p.birthday))::int < 35 THEN '18_34'
      WHEN date_part('year', age(current_date, p.birthday))::int < 45 THEN 'plus35'
      ELSE 'plus45'
    END::TEXT
  FROM profiles p
  WHERE p.id = p_user_id;
$$;

REVOKE ALL ON FUNCTION get_player_public_extras(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION get_player_public_extras(UUID) TO authenticated;
