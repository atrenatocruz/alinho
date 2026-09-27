-- ═════════════════════════════════════════════════════════════════════════
-- Vouchers: partilhar o contacto com o clube (#556) e a lista do admin (#406)
--
-- PORQUÊ. Desenho aprovado pelo Francisco a 26 set
-- (design-handoff/2026-09-26-vouchers/SPEC.md); construção com o sim dele a
-- 27 set. Decisão de 25 set (#556, RGPD): o clube só recebe o contacto de
-- quem ganhou um voucher com o acordo da pessoa, dado no momento, por
-- clube, com data, e revogável. Nada vem escolhido à partida.
--
-- O QUE FAZ (nomes combinados com o Dev 1, que faz os ecrãs):
--   1. vouchers.contact_shared_at — quando o dono aceitou partilhar
--      (NULL = não partilha ou deixou de partilhar). O dono já o lê na
--      carteira (a política de SELECT de hoje não muda).
--   2. voucher_contact_consents — o histórico: quem, que voucher, que clube,
--      quando aceitou e quando deixou de partilhar. Ninguém lê diretamente.
--   3. share_voucher_contact(p_voucher_id) / unshare_voucher_contact(...):
--      só o dono, só em vouchers por usar.
--   4. Sem acordo, o voucher não se usa: mark_voucher_used («Usar» do
--      jogador) e admin_redeem_voucher («Dar baixa» / QR do admin) recusam
--      com 'contact_not_shared' (o SPEC só mostra «Usar», QR e «Dar baixa»
--      depois do sim). Trocam só a entrada do corpo VIVO (1 vez; «já estava»).
--   5. list_club_vouchers(p_organization_id): só admins do clube; os
--      vouchers do clube com o mix, o prémio e o nome; o email SÓ de quem
--      tem o acordo ativo.
--
-- TELEMÓVEL: fica de fora desta versão. A app nunca guardou o número
-- verdadeiro (só o phone_hash); guardá-lo para o clube é uma decisão por
-- tomar (Francisco, via PO). Até lá, a lista devolve phone = NULL.
--
-- Nota: a Política de Privacidade (#349) tem de passar a falar deste
-- contacto partilhado com o clube — não é deste ficheiro.
--
-- Dev 3, 27 set 2026 · depois de migration_vouchers.sql e
-- migration_voucher_qr_redemption.sql
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0. Peças de que depende ─────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.vouchers') IS NULL
     OR to_regprocedure('public.mark_voucher_used(uuid)') IS NULL
     OR to_regprocedure('public.admin_redeem_voucher(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Faltam os vouchers (migration_vouchers.sql / migration_voucher_qr_redemption.sql). Parar e ler.';
  END IF;
END $$;

-- ── 1. O estado de hoje, no próprio voucher ─────────────────────────────
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS contact_shared_at TIMESTAMPTZ;

-- ── 2. O histórico ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS voucher_contact_consents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id      UUID NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shared_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS voucher_contact_consents_voucher_idx ON voucher_contact_consents (voucher_id);
ALTER TABLE voucher_contact_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON voucher_contact_consents FROM anon, authenticated;

-- ── 3. Aceitar / deixar de partilhar ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.share_voucher_contact(p_voucher_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v vouchers%ROWTYPE;
BEGIN
  SELECT * INTO v FROM vouchers WHERE id = p_voucher_id AND user_id = auth.uid() FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'voucher_not_found'; END IF;
  IF v.status <> 'por_usar' THEN RAISE EXCEPTION 'voucher_already_used'; END IF;
  IF v.contact_shared_at IS NOT NULL THEN RETURN v.contact_shared_at; END IF;

  UPDATE vouchers SET contact_shared_at = NOW() WHERE id = p_voucher_id;
  INSERT INTO voucher_contact_consents (voucher_id, user_id, organization_id)
  VALUES (p_voucher_id, v.user_id, v.organization_id);
  RETURN NOW();
END;
$$;

CREATE OR REPLACE FUNCTION public.unshare_voucher_contact(p_voucher_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v vouchers%ROWTYPE;
BEGIN
  SELECT * INTO v FROM vouchers WHERE id = p_voucher_id AND user_id = auth.uid() FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'voucher_not_found'; END IF;
  UPDATE vouchers SET contact_shared_at = NULL WHERE id = p_voucher_id;
  UPDATE voucher_contact_consents SET revoked_at = NOW()
   WHERE voucher_id = p_voucher_id AND revoked_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.share_voucher_contact(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unshare_voucher_contact(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.share_voucher_contact(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unshare_voucher_contact(UUID) TO authenticated;

-- ── 4. Sem acordo, o voucher não se usa ─────────────────────────────────
-- mark_voucher_used (o «Usar» do jogador): trava logo a seguir ao BEGIN.
DO $$
DECLARE
  c_mau CONSTANT TEXT := '(AS \$function\$\s*BEGIN)';
  c_bom CONSTANT TEXT := '\1
  -- Sem acordo de partilhar o contacto, não se usa (#556, 27 set).
  IF EXISTS (SELECT 1 FROM vouchers WHERE id = p_voucher_id AND user_id = auth.uid()
              AND status = ''por_usar'' AND contact_shared_at IS NULL) THEN
    RAISE EXCEPTION ''contact_not_shared'';
  END IF;';
  v_def TEXT := pg_get_functiondef('public.mark_voucher_used(uuid)'::regprocedure);
  v_n   INTEGER;
BEGIN
  IF v_def LIKE '%contact_not_shared%' THEN
    RAISE NOTICE 'mark_voucher_used: já estava';
    RETURN;
  END IF;
  SELECT count(*) INTO v_n FROM regexp_matches(v_def, c_mau, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'mark_voucher_used: esperava o início do corpo 1 vez, encontrei %. Parar e ler.', v_n;
  END IF;
  EXECUTE regexp_replace(v_def, c_mau, c_bom);
END $$;

-- admin_redeem_voucher («Dar baixa» / QR): trava logo a seguir a ver que é admin.
DO $$
DECLARE
  c_mau CONSTANT TEXT := '(RAISE EXCEPTION ''Apenas admins podem validar este voucher'';\s*END IF;)';
  c_bom CONSTANT TEXT := '\1

  -- Sem acordo de partilhar o contacto, não se dá baixa (#556, 27 set).
  IF EXISTS (SELECT 1 FROM vouchers WHERE id = p_voucher_id
              AND status = ''por_usar'' AND contact_shared_at IS NULL) THEN
    RAISE EXCEPTION ''contact_not_shared'';
  END IF;';
  v_def TEXT := pg_get_functiondef('public.admin_redeem_voucher(uuid)'::regprocedure);
  v_n   INTEGER;
BEGIN
  IF v_def LIKE '%contact_not_shared%' THEN
    RAISE NOTICE 'admin_redeem_voucher: já estava';
    RETURN;
  END IF;
  SELECT count(*) INTO v_n FROM regexp_matches(v_def, c_mau, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'admin_redeem_voucher: esperava a verificação de admin 1 vez, encontrei %. Parar e ler.', v_n;
  END IF;
  EXECUTE regexp_replace(v_def, c_mau, c_bom);
END $$;

-- ── 5. A lista do admin ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_club_vouchers(p_organization_id UUID)
RETURNS TABLE (
  voucher_id UUID, status TEXT, created_at TIMESTAMPTZ, used_at TIMESTAMPTZ,
  game_id UUID, game_title TEXT, game_date TIMESTAMPTZ, prize TEXT,
  player_name TEXT, contact_shared_at TIMESTAMPTZ, email TEXT, phone TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT v.id, v.status, v.created_at, v.used_at,
         g.id, g.title, g.date, g.prize,
         p.name, v.contact_shared_at,
         -- o contacto só de quem aceitou partilhar com ESTE clube
         CASE WHEN v.contact_shared_at IS NOT NULL
               AND p.email NOT LIKE 'guest-%@whatsapp.alinho.pt'
               AND p.email NOT LIKE '%@invalid.alinho.pt'
              THEN p.email END,
         NULL::text
    FROM vouchers v
    JOIN games g ON g.id = v.game_id
    JOIN profiles p ON p.id = v.user_id
   WHERE v.organization_id = p_organization_id
     AND EXISTS (SELECT 1 FROM memberships m
                  WHERE m.organization_id = p_organization_id AND m.user_id = auth.uid() AND m.is_admin)
   ORDER BY v.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.list_club_vouchers(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_club_vouchers(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_club_vouchers(UUID) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.mark_voucher_used(uuid)'::regprocedure) LIKE '%contact_not_shared%';     -- true
--   SELECT pg_get_functiondef('public.admin_redeem_voucher(uuid)'::regprocedure) LIKE '%contact_not_shared%';  -- true
--   SELECT has_function_privilege('anon', 'public.list_club_vouchers(uuid)', 'EXECUTE');                        -- false
