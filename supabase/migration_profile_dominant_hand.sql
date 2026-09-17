-- ════════════════════════════════════════════════════════════════════════
-- Migration: mão dominante no perfil (destro / esquerdino).
--
-- O Francisco (17 set 2026): "adiciona a possibilidade de podermos
-- selecionar se somos destros ou esquerdinos (...) não é mandatório e pode
-- ser editado as vezes que quiserem (...) tem de ficar na informação
-- pessoal" e "sim podem ver. Isso é algo importante no padel."
--
-- Não confundir com `preferred_side` (lado do campo: esquerda/direita, usado
-- na formação de duplas). Isto é a mão com que a pessoa joga.
--
-- TRÊS PARTES, TODAS NECESSÁRIAS
-- 1. A coluna. Opcional: NULL = não indicada.
-- 2. O GRANT de UPDATE. `migration_fix_profiles_column_grants.sql` tirou o
--    UPDATE geral a `profiles` e só devolve colunas listadas. Sem este GRANT
--    o Profile.jsx, que grava o formulário todo num só UPDATE, fazia falhar
--    a gravação do perfil inteiro — foi exactamente o que aconteceu com
--    `nationality` (ver migration_fix_profile_nationality_grant.sql).
-- 3. `get_player_public_extras` passa a devolver a mão dominante, para
--    aparecer no perfil de outro jogador.
--    DROP antes do CREATE de propósito: mudar as colunas devolvidas muda o
--    tipo de retorno, e `CREATE OR REPLACE` recusa-se a fazê-lo.
--    Esta versão inclui `age_category` (migration_mix_age_restriction.sql):
--    só lê colunas de `profiles`, por isso funciona quer essa migração já
--    tenha sido corrida quer não, e não a desfaz.
--
-- PRIVACIDADE
-- Exposição nova e deliberada, pedida para o perfil público. Campo opcional
-- que a pessoa escolhe preencher; quem não preencher devolve NULL e a app
-- não mostra nada. Restrito a `authenticated`.
--
-- Correr este ficheiro inteiro em Supabase → SQL Editor → New query → Run,
-- ANTES de o código chegar a `dev` ou `main`.
-- ════════════════════════════════════════════════════════════════════════

-- 1. Coluna
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS dominant_hand TEXT
  CHECK (dominant_hand IS NULL OR dominant_hand IN ('right', 'left'));

COMMENT ON COLUMN profiles.dominant_hand IS
  'Mão com que o jogador joga: right = destro, left = esquerdino. NULL = não indicada; opcional e editável.';

-- 2. Poder editá-la a partir da app
GRANT UPDATE (dominant_hand) ON profiles TO authenticated;

-- 3. Visível no perfil de outro jogador
DROP FUNCTION IF EXISTS get_player_public_extras(UUID);
CREATE FUNCTION get_player_public_extras(p_user_id UUID)
RETURNS TABLE (nationality TEXT, gender TEXT, age_category TEXT, dominant_hand TEXT)
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
    END::TEXT,
    p.dominant_hand
  FROM profiles p
  WHERE p.id = p_user_id;
$$;

REVOKE ALL ON FUNCTION get_player_public_extras(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION get_player_public_extras(UUID) TO authenticated;
