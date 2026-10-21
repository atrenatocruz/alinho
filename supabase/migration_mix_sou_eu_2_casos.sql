-- ═════════════════════════════════════════════════════════════════════════
-- «Sou eu» (2): um pedido por convidado e os casos em que o pedido cai
--
-- PORQUÊ. Desenho aprovado pelo Francisco a 21 out
-- (design-handoff/2026-10-21-sou-eu/SPEC.md), depois da primeira versão
-- (migration_mix_sou_eu.sql). Corre por cima dela.
--
-- O QUE MUDA
--   · Um pedido aberto por convidado de cada vez: se outra pessoa já pediu,
--     claim_guest_spot dá 'already_claimed'. Quem já pediu recebe o mesmo
--     pedido, como antes. No máximo 3 pedidos abertos por pessoa
--     ('too_many_claims'), para ninguém encher o sino dos admins.
--   · list_guest_claims: quem não é admin vê também que há um pedido aberto
--     de outra pessoa (status 'pending_other', só com o convidado e sem quem
--     pediu), para o ecrã não mostrar «Sou eu» nesse convidado (Dev 2).
--   · O pedido cai (estado 'cancelled'):
--       - se o mix terminar ou for cancelado: sem aviso;
--       - se o organizador trocar o convidado por outra conta ou o tirar do
--         mix: quem pediu recebe o aviso de recusa (mix_guest_claim_declined).
--   · Aceitar marca o pedido antes da troca (assim a troca não o faz cair).
--
-- COMPATIBILIDADE. Só acrescenta (as funções têm as mesmas assinaturas).
--
-- Dev 3, 21 out 2026 · ecrã: Dev 2
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.guest_claims') IS NULL THEN
    RAISE EXCEPTION 'Falta migration_mix_sou_eu.sql. Parar.';
  END IF;
END $$;

-- ── 1. O estado «caiu» e um pedido aberto por convidado ─────────────────
ALTER TABLE public.guest_claims DROP CONSTRAINT IF EXISTS guest_claims_status_check;
ALTER TABLE public.guest_claims ADD CONSTRAINT guest_claims_status_check
  CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled'));

-- Se já houver dois abertos para o mesmo convidado, fica o mais antigo.
UPDATE public.guest_claims c SET status = 'cancelled', decided_at = NOW()
 WHERE c.status = 'pending'
   AND EXISTS (SELECT 1 FROM public.guest_claims o WHERE o.guest_id = c.guest_id AND o.status = 'pending'
                 AND (o.created_at, o.id) < (c.created_at, c.id));
CREATE UNIQUE INDEX IF NOT EXISTS guest_claims_one_pending_per_guest
  ON public.guest_claims (guest_id) WHERE status = 'pending';

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
  -- Um pedido por convidado de cada vez.
  IF EXISTS (SELECT 1 FROM guest_claims WHERE guest_id = p_guest_id AND status = 'pending') THEN
    RAISE EXCEPTION 'already_claimed';
  END IF;
  -- Contra avisos em série (SI, 21 out): no máximo 3 pedidos abertos por pessoa.
  IF (SELECT count(*) FROM guest_claims WHERE user_id = v_uid AND status = 'pending') >= 3 THEN
    RAISE EXCEPTION 'too_many_claims';
  END IF;

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
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'no_session'; END IF;
  SELECT * INTO v_c FROM guest_claims WHERE id = p_claim_id FOR UPDATE;
  IF v_c.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT * INTO v_game FROM games WHERE id = v_c.game_id;
  IF v_game.id IS NULL OR NOT is_org_admin(v_game.organization_id) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF v_c.status <> 'pending' THEN RAISE EXCEPTION 'not_pending'; END IF;

  IF COALESCE(p_accept, FALSE) THEN
    -- Primeiro marca (a troca apaga o convidado, e isso faria cair um pedido aberto).
    UPDATE guest_claims SET status = 'accepted', decided_at = NOW(), decided_by = auth.uid() WHERE id = v_c.id;
    PERFORM admin_swap_guest_for_account(v_c.game_id, v_c.guest_id, v_c.user_id);
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
-- Admin: os abertos do mix. Os outros: os seus (em qualquer estado) e, dos
-- abertos de outras pessoas, só o convidado (sem quem pediu).
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
  IF COALESCE(v_admin, FALSE) THEN
    RETURN QUERY
      SELECT c.id, c.guest_id, c.guest_name, c.user_id, p.name, p.avatar_url, c.created_at, c.status
        FROM guest_claims c JOIN profiles p ON p.id = c.user_id
       WHERE c.game_id = p_game_id AND c.status = 'pending'
       ORDER BY c.created_at;
  ELSE
    RETURN QUERY
      SELECT CASE WHEN c.user_id = auth.uid() THEN c.id END, c.guest_id, c.guest_name,
             CASE WHEN c.user_id = auth.uid() THEN c.user_id END,
             CASE WHEN c.user_id = auth.uid() THEN p.name END,
             CASE WHEN c.user_id = auth.uid() THEN p.avatar_url END,
             c.created_at,
             CASE WHEN c.user_id = auth.uid() THEN c.status ELSE 'pending_other' END
        FROM guest_claims c JOIN profiles p ON p.id = c.user_id
       WHERE c.game_id = p_game_id AND (c.user_id = auth.uid() OR c.status = 'pending')
       ORDER BY c.created_at;
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.list_guest_claims(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_guest_claims(UUID) TO authenticated;

-- ── 5. O pedido cai ─────────────────────────────────────────────────────
-- O mix terminou ou foi cancelado: cai sem aviso.
CREATE OR REPLACE FUNCTION public.guest_claims_drop_on_game_end()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  UPDATE guest_claims SET status = 'cancelled', decided_at = NOW()
   WHERE game_id = NEW.id AND status = 'pending';
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.guest_claims_drop_on_game_end() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS games_guest_claims_drop ON public.games;
CREATE TRIGGER games_guest_claims_drop
  AFTER UPDATE OF status ON public.games
  FOR EACH ROW WHEN (NEW.status IN ('finished', 'cancelled') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.guest_claims_drop_on_game_end();

-- O convidado saiu do mix (trocado por outra conta ou tirado): cai, com o
-- aviso de recusa a quem pediu.
CREATE OR REPLACE FUNCTION public.guest_claims_drop_on_guest_gone()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    UPDATE guest_claims SET status = 'cancelled', decided_at = NOW()
     WHERE guest_id = OLD.id AND status = 'pending'
    RETURNING id, user_id, game_id, guest_id, guest_name
  LOOP
    INSERT INTO notifications (user_id, kind, game_id, data)
    SELECT r.user_id, 'mix_guest_claim_declined', r.game_id,
           jsonb_build_object('claim_id', r.id, 'guest_id', r.guest_id, 'guest_name', r.guest_name,
                              'game_title', g.title, 'game_date', g.date)
      FROM games g WHERE g.id = r.game_id;
  END LOOP;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.guest_claims_drop_on_guest_gone() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS game_guests_claims_drop ON public.game_guests;
CREATE TRIGGER game_guests_claims_drop
  AFTER DELETE ON public.game_guests
  FOR EACH ROW EXECUTE FUNCTION public.guest_claims_drop_on_guest_gone();

COMMIT;

-- Verificar depois de correr (1, 2):
--   SELECT count(*) FROM pg_indexes WHERE indexname = 'guest_claims_one_pending_per_guest';
--   SELECT count(*) FROM pg_trigger WHERE tgname IN ('games_guest_claims_drop', 'game_guests_claims_drop');
