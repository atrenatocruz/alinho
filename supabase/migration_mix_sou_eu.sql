-- ═════════════════════════════════════════════════════════════════════════
-- Mix: «Sou eu» num convidado, com pedido que o admin aceita ou recusa
--
-- PORQUÊ. Escolha do Francisco a 21 out (via PO), em vez do aviso por nome:
-- uma pessoa com conta diz que é um convidado do mix, e só o admin decide.
-- Casos do M5 de 19 out (convidados acrescentados pelo nome, sem número).
--
-- O QUE FAZ
--   · guest_claims: os pedidos (pendente, aceite, recusado). Sem acesso
--     direto: só pelas funções.
--   · claim_guest_spot(p_game_id, p_guest_id) → {ok, claim_id}: quem tem
--     conta e ainda não está no mix (nem em lista de espera) pede. Só em
--     mixes abertos ou fechados (Francisco). Um pedido pendente por pessoa e
--     convidado: repetir devolve o mesmo. Cada admin do grupo recebe o aviso
--     'mix_guest_claim'.
--   · answer_guest_claim(p_claim_id, p_accept) → {ok, accepted}: só admin do
--     grupo. Aceitar faz a troca (admin_swap_guest_for_account) e recusa os
--     outros pedidos pendentes para o mesmo convidado. Recusar fecha o
--     pedido. Quem pediu recebe 'mix_guest_claim_accepted' ou
--     'mix_guest_claim_declined'.
--   · list_guest_claims(p_game_id): o admin vê os pendentes do mix; quem
--     pediu vê os seus (para o ecrã mostrar «Pedido enviado»).
--   · my_guest_name_matches(p_game_id): os convidados do mix com o mesmo
--     nome de quem pede (sem maiúsculas, acentos nem espaços a mais), para o
--     ecrã pôr «Sou eu» primeiro nesses. É só uma ajuda: o admin decide.
--   Erros: no_session, not_found, bad_status, already_in_game, not_allowed,
--   not_pending.
--
-- COMPATIBILIDADE. Só acrescenta. Os avisos começam por mix_: a app antiga
-- não os mostra no sino, e o push leva o texto genérico e abre o mix.
--
-- ORDEM. Depois de migration_mix_trocar_convidado_por_conta.sql
-- (admin_swap_guest_for_account).
--
-- Dev 3, 21 out 2026 · ecrã: Dev 2 · textos: UX
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.admin_swap_guest_for_account(uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Falta migration_mix_trocar_convidado_por_conta.sql. Parar.';
  END IF;
END $$;

-- ── 1. Os pedidos ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.guest_claims (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id     UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  guest_id    UUID NOT NULL,
  guest_name  TEXT NOT NULL,
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at  TIMESTAMPTZ,
  decided_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS guest_claims_one_pending
  ON public.guest_claims (guest_id, user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_guest_claims_game ON public.guest_claims (game_id) WHERE status = 'pending';
ALTER TABLE public.guest_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.guest_claims FROM PUBLIC, anon, authenticated;

-- O nome para comparar: minúsculas, sem acentos, espaços normais.
CREATE OR REPLACE FUNCTION public.name_match_key(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $function$
  SELECT NULLIF(lower(translate(btrim(regexp_replace(COALESCE(p_name, ''), '\s+', ' ', 'g')),
                'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
                'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')), '');
$function$;
REVOKE ALL ON FUNCTION public.name_match_key(TEXT) FROM PUBLIC, anon, authenticated;

-- ── 2. Pedir ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_guest_spot(p_game_id UUID, p_guest_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid    UUID := auth.uid();
  v_game   games%ROWTYPE;
  v_guest  TEXT;
  v_name   TEXT;
  v_group  TEXT;
  v_claim  UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'no_session'; END IF;
  SELECT * INTO v_game FROM games WHERE id = p_game_id;
  IF v_game.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT name INTO v_guest FROM game_guests WHERE id = p_guest_id AND game_id = p_game_id;
  IF v_guest IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_game.status NOT IN ('open', 'closed') THEN RAISE EXCEPTION 'bad_status'; END IF;
  IF EXISTS (SELECT 1 FROM participants WHERE game_id = p_game_id AND (user_id = v_uid OR partner_id = v_uid))
     OR EXISTS (SELECT 1 FROM teams WHERE game_id = p_game_id AND v_uid IN (player1_id, player2_id)) THEN
    RAISE EXCEPTION 'already_in_game';
  END IF;

  SELECT id INTO v_claim FROM guest_claims WHERE guest_id = p_guest_id AND user_id = v_uid AND status = 'pending';
  IF v_claim IS NOT NULL THEN RETURN jsonb_build_object('ok', TRUE, 'claim_id', v_claim); END IF;

  INSERT INTO guest_claims (game_id, guest_id, guest_name, user_id)
  VALUES (p_game_id, p_guest_id, v_guest, v_uid)
  RETURNING id INTO v_claim;

  SELECT name INTO v_name FROM profiles WHERE id = v_uid;
  SELECT name INTO v_group FROM organizations WHERE id = v_game.organization_id;
  INSERT INTO notifications (user_id, kind, game_id, actor_id, data)
  SELECT m.user_id, 'mix_guest_claim', p_game_id, v_uid,
         jsonb_build_object('claim_id', v_claim, 'guest_id', p_guest_id, 'guest_name', v_guest,
                            'user_name', v_name, 'group_name', v_group,
                            'game_title', v_game.title, 'game_date', v_game.date)
    FROM memberships m
   WHERE m.organization_id = v_game.organization_id AND m.is_admin AND m.user_id <> v_uid;

  RETURN jsonb_build_object('ok', TRUE, 'claim_id', v_claim);
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_guest_spot(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_guest_spot(UUID, UUID) TO authenticated;

-- ── 3. Responder (admin) ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.answer_guest_claim(p_claim_id UUID, p_accept BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_c    guest_claims%ROWTYPE;
  v_game games%ROWTYPE;
  r      RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'no_session'; END IF;
  SELECT * INTO v_c FROM guest_claims WHERE id = p_claim_id FOR UPDATE;
  IF v_c.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT * INTO v_game FROM games WHERE id = v_c.game_id;
  IF v_game.id IS NULL OR NOT is_org_admin(v_game.organization_id) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF v_c.status <> 'pending' THEN RAISE EXCEPTION 'not_pending'; END IF;

  IF COALESCE(p_accept, FALSE) THEN
    -- A troca de sempre (as mesmas regras e erros: already_in_game, bad_status…).
    PERFORM admin_swap_guest_for_account(v_c.game_id, v_c.guest_id, v_c.user_id);
    UPDATE guest_claims SET status = 'accepted', decided_at = NOW(), decided_by = auth.uid() WHERE id = v_c.id;
    -- Os outros pedidos para o mesmo convidado ficam recusados.
    FOR r IN
      UPDATE guest_claims SET status = 'declined', decided_at = NOW(), decided_by = auth.uid()
       WHERE guest_id = v_c.guest_id AND status = 'pending' AND id <> v_c.id
      RETURNING id, user_id
    LOOP
      INSERT INTO notifications (user_id, kind, game_id, data)
      VALUES (r.user_id, 'mix_guest_claim_declined', v_c.game_id,
              jsonb_build_object('claim_id', r.id, 'guest_id', v_c.guest_id, 'guest_name', v_c.guest_name,
                                 'game_title', v_game.title, 'game_date', v_game.date));
    END LOOP;
    INSERT INTO notifications (user_id, kind, game_id, data)
    VALUES (v_c.user_id, 'mix_guest_claim_accepted', v_c.game_id,
            jsonb_build_object('claim_id', v_c.id, 'guest_id', v_c.guest_id, 'guest_name', v_c.guest_name,
                               'game_title', v_game.title, 'game_date', v_game.date));
    RETURN jsonb_build_object('ok', TRUE, 'accepted', TRUE);
  END IF;

  UPDATE guest_claims SET status = 'declined', decided_at = NOW(), decided_by = auth.uid() WHERE id = v_c.id;
  INSERT INTO notifications (user_id, kind, game_id, data)
  VALUES (v_c.user_id, 'mix_guest_claim_declined', v_c.game_id,
          jsonb_build_object('claim_id', v_c.id, 'guest_id', v_c.guest_id, 'guest_name', v_c.guest_name,
                             'game_title', v_game.title, 'game_date', v_game.date));
  RETURN jsonb_build_object('ok', TRUE, 'accepted', FALSE);
END;
$function$;
REVOKE ALL ON FUNCTION public.answer_guest_claim(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.answer_guest_claim(UUID, BOOLEAN) TO authenticated;

-- ── 4. Ver os pedidos ───────────────────────────────────────────────────
-- Admin: os pendentes do mix. Os outros: só os seus (pendentes ou já
-- respondidos), para o ecrã saber o que mostrar.
CREATE OR REPLACE FUNCTION public.list_guest_claims(p_game_id UUID)
RETURNS TABLE(claim_id UUID, guest_id UUID, guest_name TEXT, user_id UUID, user_name TEXT, avatar_url TEXT,
              created_at TIMESTAMPTZ, status TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_admin BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'no_session'; END IF;
  SELECT is_org_admin(g.organization_id) INTO v_admin FROM games g WHERE g.id = p_game_id;
  RETURN QUERY
    SELECT c.id, c.guest_id, c.guest_name, c.user_id, p.name, p.avatar_url, c.created_at, c.status
      FROM guest_claims c JOIN profiles p ON p.id = c.user_id
     WHERE c.game_id = p_game_id
       AND ((COALESCE(v_admin, FALSE) AND c.status = 'pending') OR c.user_id = auth.uid())
     ORDER BY c.created_at;
END;
$function$;
REVOKE ALL ON FUNCTION public.list_guest_claims(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_guest_claims(UUID) TO authenticated;

-- ── 5. Ajuda: os convidados com o meu nome ──────────────────────────────
CREATE OR REPLACE FUNCTION public.my_guest_name_matches(p_game_id UUID)
RETURNS TABLE(guest_id UUID, guest_name TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT gg.id, gg.name
    FROM game_guests gg
    JOIN profiles me ON me.id = auth.uid()
   WHERE gg.game_id = p_game_id
     AND name_match_key(gg.name) IS NOT NULL
     AND name_match_key(gg.name) = name_match_key(me.name);
$function$;
REVOKE ALL ON FUNCTION public.my_guest_name_matches(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_guest_name_matches(UUID) TO authenticated;

COMMIT;

-- Verificar depois de correr (false, false):
--   SELECT has_function_privilege('anon', 'public.claim_guest_spot(uuid,uuid)', 'EXECUTE'),
--          has_table_privilege('authenticated', 'public.guest_claims', 'SELECT');
