-- ═════════════════════════════════════════════════════════════════════════
-- Vouchers para todos os vencedores do mix, com ou sem conta
--
-- PORQUÊ. Renato, 7 out (falado com o Francisco): o clube tem de ver TODOS
-- os vouchers, também de quem ganhou sem estar na app — senão nem sabe que
-- essa pessoa ganhou. Desfaz migration_vouchers_so_com_conta.sql (30 set).
-- Spec: docs/superpowers/specs/2026-10-07-vouchers-sem-conta-design.md
--
-- O QUE FAZ
--   1. vouchers: user_id passa a opcional; guest_id (game_guests) e
--      guest_name (o nome no momento do voucher).
--   2. award_mix_vouchers(jogo, dupla): voucher aos dois da dupla, com ou
--      sem conta. revoke_unused_mix_vouchers_of_guests(jogo, dupla): nas
--      correções, tira os por usar de convidados que deixaram de ganhar.
--   3. Cada função cujo corpo vivo faz INSERT INTO vouchers passa a chamar
--      award_mix_vouchers (sai o filtro voucher_eligible).
--   4. juntar_convidado (se existir): anula os vouchers por usar do
--      convidado antes de os passar — um voucher sem conta nunca chega a
--      uma conta.
--   5. list_club_vouchers: também quem não tem conta, e has_account.
--
-- ROBÔ. O WhatsApp bot precisa de redeploy manual na EC2 para a alteração
-- em voucherNotices.js (vouchers sem conta são ignorados no aviso). A ordem
-- não importa: com o robô antigo e esta migração, os avisos a convidados
-- ficam simplesmente desligados até ao redeploy.
--   Os anulados a 30 set ficam como estão. Os torneios continuam sem vouchers.
--
-- CORRER PRIMEIRO: migration_mix_guest_sem_conta.sql,
-- migration_vouchers_so_com_conta.sql, migration_finalize_mix_com_convidados.sql.
-- Pode-se correr mais do que uma vez.
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0. Peças de que depende ──────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.game_guests') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'teams' AND column_name = 'player1_guest_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'vouchers' AND column_name = 'annulled_reason')
     OR to_regprocedure('public.voucher_eligible(uuid)') IS NULL
     OR to_regprocedure('public.list_club_vouchers(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Faltam migrações anteriores (ver CORRER PRIMEIRO). Parar e ler.';
  END IF;
END $$;

-- ── 1. Colunas ───────────────────────────────────────────────────────────
ALTER TABLE vouchers ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS guest_id UUID REFERENCES game_guests(id) ON DELETE SET NULL;
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS guest_name TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vouchers_user_or_guest') THEN
    ALTER TABLE vouchers ADD CONSTRAINT vouchers_user_or_guest
      CHECK (user_id IS NOT NULL OR guest_name IS NOT NULL);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS vouchers_game_guest_key
  ON vouchers (game_id, guest_id) WHERE guest_id IS NOT NULL;

-- ── 2. Dar e tirar ───────────────────────────────────────────────────────
-- Quem chama já verificou games.has_voucher.
CREATE OR REPLACE FUNCTION public.award_mix_vouchers(p_game_id UUID, p_winner_team_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org UUID;
BEGIN
  SELECT organization_id INTO v_org FROM games WHERE id = p_game_id;

  -- Com perfil (conta ou perfil antigo sem conta): todos, sem filtro.
  INSERT INTO vouchers (game_id, user_id, organization_id)
  SELECT p_game_id, w.pid, v_org
    FROM teams t
    CROSS JOIN LATERAL (VALUES (t.player1_id), (t.player2_id)) AS w(pid)
   WHERE t.id = p_winner_team_id AND w.pid IS NOT NULL
  ON CONFLICT DO NOTHING;

  -- Convidados sem conta (game_guests): o nome fica guardado no voucher.
  INSERT INTO vouchers (game_id, guest_id, guest_name, organization_id)
  SELECT p_game_id, gg.id, gg.name, v_org
    FROM teams t
    CROSS JOIN LATERAL (VALUES (t.player1_guest_id), (t.player2_guest_id)) AS w(gid)
    JOIN game_guests gg ON gg.id = w.gid
   WHERE t.id = p_winner_team_id
  ON CONFLICT DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.award_mix_vouchers(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- Correções: os convidados que deixaram de ganhar perdem o voucher POR USAR
-- (os com conta já são tratados pelo laço de cada correção).
CREATE OR REPLACE FUNCTION public.revoke_unused_mix_vouchers_of_guests(p_game_id UUID, p_winner_team_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM vouchers v
   WHERE v.game_id = p_game_id
     AND v.guest_id IS NOT NULL
     AND v.status = 'por_usar'
     AND v.guest_id NOT IN (
       SELECT w.gid
         FROM teams t
         CROSS JOIN LATERAL (VALUES (t.player1_guest_id), (t.player2_guest_id)) AS w(gid)
        WHERE t.id = p_winner_team_id AND w.gid IS NOT NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_unused_mix_vouchers_of_guests(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ── 3. Quem dá vouchers passa a chamar award_mix_vouchers ────────────────
DO $$
DECLARE
  c_mau CONSTANT TEXT :=
    'INSERT INTO vouchers \(game_id, user_id, organization_id\)\s+SELECT (p_game_id|v_game\.id),[^;]*WHERE id = (p_[a-z_]+)[^;]*ON CONFLICT \(game_id, user_id\) DO NOTHING;';
  c_esperadas CONSTANT TEXT[] := ARRAY['finalize_mix', 'correct_finished_mix_match',
                                       'finalize_americano_mix', 'correct_finished_americano_match'];
  f      RECORD;
  v_def  TEXT;
  v_bom  TEXT;
  v_n    INTEGER;
  v_feitas TEXT[] := '{}';
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig, p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname NOT IN ('award_mix_vouchers', 'revoke_unused_mix_vouchers_of_guests')
       AND (p.prosrc ~ 'INSERT INTO vouchers' OR p.prosrc ~ 'award_mix_vouchers')
  LOOP
    IF NOT (f.proname = ANY (c_esperadas)) THEN
      RAISE EXCEPTION '% dá vouchers e esta migração não a conhece. Parar e ler.', f.sig;
    END IF;
    v_def := pg_get_functiondef(f.sig::regprocedure);
    IF v_def LIKE '%award_mix_vouchers%' THEN
      RAISE NOTICE '%: já estava', f.sig;
      v_feitas := v_feitas || f.proname::text;
      CONTINUE;
    END IF;
    v_n := (SELECT count(*) FROM regexp_matches(v_def, c_mau, 'g'));
    IF v_n <> 1 THEN
      RAISE EXCEPTION '%: o INSERT INTO vouchers aparece % vezes (esperado 1). Parar e ler.', f.sig, v_n;
    END IF;
    v_bom := CASE WHEN f.proname LIKE 'correct_%'
                  THEN 'PERFORM revoke_unused_mix_vouchers_of_guests(\1, \2);
    PERFORM award_mix_vouchers(\1, \2);'
                  ELSE 'PERFORM award_mix_vouchers(\1, \2);' END;
    EXECUTE regexp_replace(v_def, c_mau, v_bom);
    RAISE NOTICE '%: trocada', f.sig;
    v_feitas := v_feitas || f.proname::text;
  END LOOP;

  IF NOT ('finalize_mix' = ANY (v_feitas)) OR NOT ('correct_finished_mix_match' = ANY (v_feitas)) THEN
    RAISE EXCEPTION 'finalize_mix e correct_finished_mix_match tinham de estar entre as trocadas (%). Parar e ler.', v_feitas;
  END IF;
END $$;

-- ── 4. juntar_convidado: um voucher sem conta não passa para a conta ─────
DO $$
DECLARE
  c_mau CONSTANT TEXT := '(-- ── a\) Tudo o que aponta para o convidado)';
  c_bom CONSTANT TEXT := '-- Vouchers por usar do convidado: anulados, não passam (Renato, 7 out).
  UPDATE vouchers
     SET status = ''anulado'', annulled_at = NOW(),
         annulled_reason = ''Criado sem conta: gerido pelo clube, não passa para a conta.''
   WHERE user_id = p_convidado AND status = ''por_usar'';

  \1';
  v_def TEXT;
BEGIN
  IF to_regprocedure('public.juntar_convidado(uuid, uuid)') IS NULL THEN
    RAISE NOTICE 'juntar_convidado não existe: nada a trocar';
    RETURN;
  END IF;
  v_def := pg_get_functiondef('public.juntar_convidado(uuid, uuid)'::regprocedure);
  IF v_def LIKE '%gerido pelo clube%' THEN
    RAISE NOTICE 'juntar_convidado: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'juntar_convidado: o comentário «a) Tudo o que aponta…» não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(v_def, c_mau, c_bom);
END $$;

-- ── 5. Lista do clube: também quem não tem conta ────────────────────────
-- Muda o tipo de retorno (has_account): DROP + CREATE, permissões repostas.
DROP FUNCTION public.list_club_vouchers(UUID);
CREATE FUNCTION public.list_club_vouchers(p_organization_id UUID)
RETURNS TABLE (
  voucher_id UUID, status TEXT, created_at TIMESTAMPTZ, used_at TIMESTAMPTZ,
  game_id UUID, game_title TEXT, game_date TIMESTAMPTZ, prize TEXT,
  player_name TEXT, contact_shared_at TIMESTAMPTZ, email TEXT, phone TEXT,
  has_account BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT v.id, v.status, v.created_at, v.used_at,
         g.id, g.title, g.date, g.prize,
         COALESCE(p.name, v.guest_name), v.contact_shared_at,
         -- o contacto só de quem aceitou partilhar com ESTE clube
         CASE WHEN v.contact_shared_at IS NOT NULL
               AND p.email NOT LIKE 'guest-%@whatsapp.alinho.pt'
               AND p.email NOT LIKE '%@invalid.alinho.pt'
              THEN p.email END,
         NULL::text,
         (v.user_id IS NOT NULL AND voucher_eligible(v.user_id))
    FROM vouchers v
    JOIN games g ON g.id = v.game_id
    LEFT JOIN profiles p ON p.id = v.user_id
   WHERE v.organization_id = p_organization_id
     AND v.status <> 'anulado'
     AND EXISTS (SELECT 1 FROM memberships m
                  WHERE m.organization_id = p_organization_id AND m.user_id = auth.uid() AND m.is_admin)
   ORDER BY v.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.list_club_vouchers(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_club_vouchers(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_club_vouchers(UUID) TO authenticated;

COMMIT;

-- Verificar depois de correr (dev primeiro):
-- V1  SELECT column_name, is_nullable FROM information_schema.columns
--      WHERE table_name = 'vouchers' AND column_name IN ('user_id', 'guest_id', 'guest_name');
--      -- user_id YES, guest_id YES, guest_name YES
-- V2  SELECT proname FROM pg_proc WHERE prosrc ~ 'award_mix_vouchers'
--        AND proname NOT IN ('award_mix_vouchers');
--      -- finalize_mix, correct_finished_mix_match (+ as do americano, se davam vouchers)
--     SELECT proname FROM pg_proc WHERE prosrc ~ 'INSERT INTO vouchers'
--        AND prosrc ~ 'voucher_eligible';   -- 0 linhas
-- V3  Num mix com voucher e um convidado sem conta na dupla vencedora,
--     depois de «Terminar»:
--     SELECT user_id, guest_id, guest_name, status FROM vouchers WHERE game_id = '<mix>';
--      -- 2 linhas: uma com user_id, outra com guest_id + guest_name
--     SELECT award_mix_vouchers('<mix>', '<dupla vencedora>');  -- outra vez
--     SELECT count(*) FROM vouchers WHERE game_id = '<mix>';    -- continua 2
-- V4  Corrigir o resultado para outra dupla (no ecrã) e:
--     SELECT user_id, guest_id, status FROM vouchers WHERE game_id = '<mix>';
--      -- o convidado da dupla antiga sumiu (se estava por usar); a nova tem os seus
-- V5  Como admin do clube, na app: Gerir clube → Vouchers mostra o convidado
--     com a nota «Este jogador não está na app…».
--     SELECT player_name, has_account FROM list_club_vouchers('<org>');  -- (no SQL Editor auth.uid() é nulo: 0 linhas; ver no ecrã)
