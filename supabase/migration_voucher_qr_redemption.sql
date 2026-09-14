-- ════════════════════════════════════════════════════════════════════════
-- Migration: Voucher QR redemption. A second, admin-driven redemption
-- path alongside the existing self-service "Usar" button (mark_voucher_used,
-- migration_vouchers.sql) — a club admin scans (or manually types) a
-- voucher's id in GerirClube.jsx, sees its details (owner, mix, prize,
-- club), and on explicit confirmation calls this new RPC to redeem it on
-- the player's behalf.
--
-- mark_voucher_used is NOT modified by this migration — it stays exactly
-- as-is, still the only path for the self-service button. This file adds
-- one new function only; no new table, no new column, no RLS change (the
-- admin's read-before-confirm lookup already works today via the existing
-- "Own or org-mates vouchers" SELECT policy on vouchers).
--
-- NOT LIVE until run in Supabase → SQL Editor → New query → Run. A
-- migration file existing in this repo changes nothing on its own — the
-- GerirClube.jsx "Ler QR code" redeem screen's confirm step depends on
-- this having actually been pasted in and executed there. (The screen's
-- lookup step, and the player-facing QR modal, work without it — only the
-- final confirm call needs this RPC.)
--
-- See docs/superpowers/specs/2026-09-14-voucher-qr-redemption-design.md
-- for the full design and the reasoning behind each decision below.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_redeem_voucher(p_voucher_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id FROM vouchers WHERE id = p_voucher_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Voucher não encontrado';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM memberships
    WHERE organization_id = v_org_id AND user_id = auth.uid() AND is_admin
  ) THEN
    RAISE EXCEPTION 'Apenas admins podem validar este voucher';
  END IF;

  UPDATE vouchers
  SET status = 'usado', used_at = NOW()
  WHERE id = p_voucher_id
    AND status = 'por_usar';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Voucher não encontrado ou já usado';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION admin_redeem_voucher(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION admin_redeem_voucher(UUID) TO authenticated;

-- ── Manual verification (run once this migration is live) ───────────────
-- These checks depend on a human pasting this file into a real Supabase
-- project's SQL Editor first, against a voucher already created by the
-- existing vouchers-wallet flow.
--
-- 1. Redeem, as an admin of the voucher's own organization:
-- SELECT admin_redeem_voucher('<voucher id, currently por_usar>');
-- SELECT status, used_at FROM vouchers WHERE id = '<that voucher id>';
-- Expect: status = 'usado', used_at set.
--
-- 2. Redeem again — expect an exception ("Voucher não encontrado ou já usado").
--
-- 3. Redeem a DIFFERENT por_usar voucher as an admin of a DIFFERENT
--    organization than that voucher's own — expect an exception
--    ("Apenas admins podem validar este voucher").
--
-- 4. Redeem as a non-admin member of the voucher's own organization —
--    expect the same "Apenas admins podem validar este voucher" exception.
--
-- 5. Redeem a nonexistent id — expect "Voucher não encontrado".
--
-- 6. Race: as the voucher's own owner, call mark_voucher_used(id); as an
--    admin, call admin_redeem_voucher(id) on the same voucher shortly
--    after — confirm exactly one call succeeds and the other raises, and
--    the final row state is status='usado' with used_at set exactly once
--    (not overwritten by the losing call).
