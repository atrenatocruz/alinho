-- ════════════════════════════════════════════════════════════════════════
-- Migration: mix em rascunho — criar sem publicar
-- (Trello #544 — plano aprovado pelo Francisco a 25 set 2026; desenho em
-- design-handoff/2026-09-24-mix-em-rascunho/SPEC.md).
-- PROPOSTA, POR ACORDAR COM O RENATO: acrescenta uma condição às políticas
-- de `games` que vêm da migração multi-tenant / plan_limits.
--
-- Independente das outras migrações por correr. Corre-o o System Integrator
-- (regra de 25 set: nenhum agente dev corre SQL em produção).
-- As políticas e as funções foram copiadas das VIVAS em produção a 25 set.
--
-- O que faz — um estado novo, `draft`, à parte do `pending` das séries
-- (o cron process_due_game_recurrences abre os `pending` sozinho à hora
-- marcada; um rascunho nunca pode abrir sozinho, e o cron nem olha para ele):
-- 1. Quem vê: «Org members can view games» passa a esconder o `draft` a
--    quem não é admin do clube/grupo. Um jogador não o encontra, nem com o
--    link (a página lê a tabela e não recebe nada).
-- 2. Ninguém se inscreve: trigger em participants recusa inscrições num
--    `draft` — app, link de convite, robô e funções, admin incluído
--    (SECURITY DEFINER, para ver o estado mesmo quando quem inscreve não
--    tem acesso ao rascunho).
-- 3. Não volta atrás: um mix publicado não pode passar a `draft` (a
--    mensagem do robô já saiu).
-- 4. Limite do plano: o `draft` não conta, como o `pending`; passa a contar
--    ao publicar (a política de UPDATE mede o estado novo).
-- 5. Página do clube (get_club_profile): deixa o `draft` de fora, onde já
--    deixava o `pending`.
-- O robô do WhatsApp não muda: só anuncia `open` (sync.js), e publicar é um
-- UPDATE para `open`, que ele já trata como um mix novo.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Quem vê um rascunho: só os admins do clube/grupo ─────────────────
ALTER POLICY "Org members can view games" ON games
  USING (EXISTS (
    SELECT 1 FROM memberships
    WHERE memberships.organization_id = games.organization_id
      AND memberships.user_id = auth.uid()
      AND (games.status IS DISTINCT FROM 'draft' OR memberships.is_admin)
  ));

-- ── 4. Limite do plano: o rascunho não conta, como o `pending` ──────────
ALTER POLICY "Org admins can create games" ON games
  WITH CHECK (
    (EXISTS (
      SELECT 1 FROM memberships
      WHERE memberships.organization_id = games.organization_id
        AND memberships.user_id = auth.uid() AND memberships.is_admin))
    AND ((org_max_courts(organization_id) IS NULL) OR (num_courts <= org_max_courts(organization_id)))
    AND ((org_max_active_mixes(organization_id) IS NULL)
      OR (COALESCE(status, 'open') IN ('pending', 'draft'))
      OR (self_serve_active_mix_count(organization_id) < org_max_active_mixes(organization_id)))
  );

ALTER POLICY "Org admins can update games" ON games
  WITH CHECK (
    (EXISTS (
      SELECT 1 FROM memberships
      WHERE memberships.organization_id = games.organization_id
        AND memberships.user_id = auth.uid() AND memberships.is_admin))
    AND ((org_max_courts(organization_id) IS NULL) OR (num_courts <= org_max_courts(organization_id)))
    AND ((org_max_active_mixes(organization_id) IS NULL)
      OR ((self_serve_active_mix_count(organization_id, id)
           + CASE WHEN COALESCE(status, 'open') <> ALL (ARRAY['finished', 'cancelled', 'pending', 'draft']) THEN 1 ELSE 0 END)
          <= org_max_active_mixes(organization_id)))
  );

-- Troca só o fragmento do corpo vivo (regra de 24 set: nunca reescrever a
-- função inteira de memória). Pára se o corpo mudou entretanto.
DO $$
DECLARE
  v_def TEXT := pg_get_functiondef('public.self_serve_active_mix_count(uuid, uuid)'::regprocedure);
  v_old TEXT := $f$NOT IN ('finished', 'cancelled', 'pending')$f$;
  v_new TEXT := $f$NOT IN ('finished', 'cancelled', 'pending', 'draft')$f$;
BEGIN
  IF position(v_new IN v_def) > 0 THEN
    RAISE NOTICE 'self_serve_active_mix_count já deixa o draft de fora';
  ELSIF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'self_serve_active_mix_count mudou desde 25 set: o filtro não foi encontrado';
  ELSE
    EXECUTE replace(v_def, v_old, v_new);
  END IF;
END $$;

-- ── 5. Página do clube: o rascunho fica de fora ─────────────────────────
DO $$
DECLARE
  v_def TEXT := pg_get_functiondef('public.get_club_profile(text)'::regprocedure);
  v_old TEXT := $f$g.status NOT IN ('finished', 'completed', 'cancelled', 'pending')$f$;
  v_new TEXT := $f$g.status NOT IN ('finished', 'completed', 'cancelled', 'pending', 'draft')$f$;
BEGIN
  IF position(v_new IN v_def) > 0 THEN
    RAISE NOTICE 'get_club_profile já deixa o draft de fora';
  ELSIF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 2 THEN
    RAISE EXCEPTION 'get_club_profile mudou desde 25 set: esperava o filtro 2 vezes';
  ELSE
    EXECUTE replace(v_def, v_old, v_new);
  END IF;
END $$;

-- ── 2. Ninguém se inscreve num rascunho ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.participants_draft_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF (SELECT status FROM games WHERE id = NEW.game_id) = 'draft' THEN
    RAISE EXCEPTION 'mix_draft' USING ERRCODE = 'P0001',
      DETAIL = 'Este mix ainda é um rascunho: ninguém se inscreve antes de ser publicado.';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS participants_draft_guard_trigger ON participants;
CREATE TRIGGER participants_draft_guard_trigger
  BEFORE INSERT OR UPDATE OF game_id ON participants
  FOR EACH ROW EXECUTE FUNCTION participants_draft_guard();

-- ── 3. Um mix publicado não volta a rascunho ────────────────────────────
CREATE OR REPLACE FUNCTION public.games_draft_one_way()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF NEW.status = 'draft' AND OLD.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'mix_already_published' USING ERRCODE = 'P0001',
      DETAIL = 'Um mix publicado não volta a rascunho: o anúncio já saiu.';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS games_draft_one_way_trigger ON games;
CREATE TRIGGER games_draft_one_way_trigger
  BEFORE UPDATE OF status ON games
  FOR EACH ROW EXECUTE FUNCTION games_draft_one_way();

COMMIT;
