-- ═════════════════════════════════════════════════════════════════════════
-- Cada pessoa lê o seu próprio perfil por uma função (#772, passo A)
--
-- A app passa a pedir o próprio perfil a get_my_profile, em vez de o ler da tabela.
-- Devolve a linha inteira, com as mesmas colunas de sempre, e só a de quem pede.
--
-- Só acrescenta: a app antiga continua a funcionar como hoje.
--
-- ORDEM: correr ANTES de o código chegar a cada site. A app nova não abre o perfil
-- sem esta função: no alinho-dev antes do envio para o dev, em produção antes do main.
-- O passo B é migration_772_fechar_colunas_dos_perfis.sql, à parte e mais tarde.
--
-- Para desfazer: DROP FUNCTION public.get_my_profile();
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS SETOF public.profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.profiles WHERE id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_my_profile() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_profile() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;

COMMIT;

-- Verificação: anon_pode = false, com_sessao_pode = true.
-- SELECT has_function_privilege('anon', 'public.get_my_profile()', 'EXECUTE') AS anon_pode,
--        has_function_privilege('authenticated', 'public.get_my_profile()', 'EXECUTE') AS com_sessao_pode;
