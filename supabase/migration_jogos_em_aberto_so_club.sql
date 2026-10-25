-- ═════════════════════════════════════════════════════════════════════════
-- Jogos em aberto: só o Club os cria (trava na base, por plano)
--
-- PORQUÊ. Regra do Francisco, 21 out (design-handoff/2026-10-21-planos-o-
-- que-inclui/REGRAS-BA.md, via PO): jogos em aberto só no Club; no
-- Community são os jogos entre amigos. A app insere os jogos em aberto
-- direto em games (origin = 'open_slot') e a base não travava nada.
--
-- O QUE FAZ. Um gatilho antes de gravar em games: um jogo com origin
-- 'open_slot' só entra num clube (kind 'club') ou num grupo com o plano Club
-- (plan_tier 'club'). Senão dá 'plan_no_open_games'. Os superadmins (com o
-- modo ligado) e as tarefas do servidor (sem sessão: recorrências, robô)
-- passam. Os jogos em aberto que já existem ficam como estão (em produção, a
-- 21 out, há 1 num grupo Squad, já jogado).
--
-- COMPATIBILIDADE. Só acrescenta. A app antiga num grupo que não é Club
-- passa a receber o erro ao criar um jogo em aberto: é a regra.
--
-- Dev 3, 21 out 2026 · ecrã: Dev 1 (o «＋ Criar» já só mostra no Club)
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.games_open_slot_plan_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_kind TEXT;
  v_tier TEXT;
BEGIN
  IF NEW.origin IS DISTINCT FROM 'open_slot' THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL OR COALESCE(is_platform_admin_me(), FALSE) THEN RETURN NEW; END IF;
  SELECT kind, plan_tier INTO v_kind, v_tier FROM organizations WHERE id = NEW.organization_id;
  IF v_kind IS DISTINCT FROM 'club' AND v_tier IS DISTINCT FROM 'club' THEN
    RAISE EXCEPTION 'plan_no_open_games';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.games_open_slot_plan_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS games_open_slot_plan_guard ON public.games;
CREATE TRIGGER games_open_slot_plan_guard
  BEFORE INSERT OR UPDATE OF origin, organization_id ON public.games
  FOR EACH ROW EXECUTE FUNCTION public.games_open_slot_plan_guard();

COMMIT;

-- Verificar depois de correr (1):
--   SELECT count(*) FROM pg_trigger WHERE tgname = 'games_open_slot_plan_guard';
