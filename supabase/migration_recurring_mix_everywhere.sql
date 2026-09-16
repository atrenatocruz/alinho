-- ════════════════════════════════════════════════════════════════════════
-- Migration: mix recorrente em qualquer grupo ou clube (Francisco, 16 set 2026)
--
-- "Mix recorrente não tem a ver com planos. Vai ser para qualquer mix. Para
-- a pessoa não estar sempre a criar o mix."
--
-- Até aqui o "Mix recorrente" estava escondido nos grupos criados na
-- Comunidade (só no ecrã — as policies de game_recurrences nunca olharam
-- para self_serve). A razão era o limite de mixes em aberto: o mix seguinte
-- de uma série é pré-criado com status 'pending' (fica à espera da hora de
-- abrir) e self_serve_active_mix_count contava-o como "em aberto". Num grupo
-- com limite de 1 mix, criar um mix recorrente era bloqueado na hora.
--
-- Um mix 'pending' ainda não existe para os jogadores (não aparece, ninguém
-- se inscreve) — deixa de contar para o limite. Quando abre, a própria série
-- garante que só há um mix dela aberto de cada vez
-- (process_due_game_recurrences só abre o seguinte quando o anterior já não
-- está open/closed/in_progress).
--
-- Sem dependências de outras migrações por correr: redefine só esta função,
-- com a mesma assinatura da versão de migration_fix_games_policy_recursion.sql,
-- e serve tanto os caps fixos de hoje como migration_plan_limits.sql.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION self_serve_active_mix_count(p_organization_id UUID, p_exclude_game_id UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COUNT(*)::INTEGER FROM games
  WHERE organization_id = p_organization_id
    AND (p_exclude_game_id IS NULL OR id <> p_exclude_game_id)
    -- 'pending' = próximo mix de uma série recorrente, ainda por abrir.
    AND COALESCE(status, 'open') NOT IN ('finished', 'cancelled', 'pending');
$$;

REVOKE ALL ON FUNCTION self_serve_active_mix_count(UUID, UUID) FROM public;
GRANT EXECUTE ON FUNCTION self_serve_active_mix_count(UUID, UUID) TO authenticated;
