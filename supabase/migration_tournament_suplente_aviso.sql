-- ═════════════════════════════════════════════════════════════════════════
-- #548 — Torneio: suplente que sobe para dentro recebe aviso no sino
-- (plano aprovado pelo Francisco a 25 set 2026).
--
-- O que se passava: quando alguém desiste, é tirado pelo organizador ou o
-- organizador escolhe um suplente no fecho, o suplente passa a inscrito sem
-- que ninguém lhe diga. Se o parceiro ainda tiver de aceitar, os 3 dias do
-- convite correm sem ele saber.
--
-- O que faz: um só sítio que avisa, seja qual for o caminho da subida — um
-- trigger AFTER UPDATE em tournament_entries, à parte do
-- tournament_entries_guard do Renato (não lhe mexe).
--
--   · Quando: a inscrição estava `suplente` e passa a um estado de quem
--     está dentro (convite, sem_parceiro, por_validar, validada,
--     selecionada), COM A CATEGORIA A RECEBER INSCRIÇÕES nesse momento.
--       - tournament_promote_waitlist (desistência, tirar inscrição): só
--         corre com a categoria em `inscricoes` → avisa.
--       - Fechar inscrições com um suplente escolhido para dentro: a
--         categoria só passa a `fechada` depois de marcar as escolhidas →
--         avisa.
--       - Reabrir inscrições (#517): os suplentes voltam a inscritos AINDA
--         com a categoria fechada (é assim de propósito, ver o ponto 3 de
--         migration_tournament_reopen_category.sql) → NÃO avisa. Aí o
--         lugar não está garantido: o organizador volta a escolher no fecho.
--   · Quem: quem da dupla tem conta. O parceiro que ainda tem de aceitar
--     (a inscrição sobe para `convite`) já vê o convite no sino, com o
--     prazo (list_my_tournament_invites) — não se duplica.
--   · O quê: kind `tournament_promoted`, com o torneio, a categoria, o
--     nome do parceiro e, se falta o parceiro aceitar, até quando.
--     O ecrã do sino lê tudo de `data`.
--   · Um aviso por pessoa e inscrição enquanto não for lido: subir, voltar
--     a suplente e subir outra vez não dá dois.
--
-- O bot de WhatsApp não pega nestes avisos (filtra por kind de mix e liga
-- a games) — fica para quando o robô souber de torneios.
--
-- Corre em qualquer ordem com o #515 (migration_tournament_entries_sem_conta
-- .sql): o nome do jogador 1 sem conta lê-se por to_jsonb(NEW), que não
-- falha se a coluna ainda não existir.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

-- ── 0. Peças de que depende ─────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.notifications') IS NULL THEN
    RAISE EXCEPTION 'Não existe a tabela notifications (migration_mix_notices.sql). Parar e ler.';
  END IF;
  IF to_regclass('public.tournament_entries') IS NULL THEN
    RAISE EXCEPTION 'Não existe a tabela tournament_entries. Parar e ler.';
  END IF;
END $$;

-- ── 1. O aviso ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION tournament_entry_promoted_notice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cat    tournament_categories%ROWTYPE;
  v_t      tournaments%ROWTYPE;
  v_row    JSONB := to_jsonb(NEW);
  v_p1     TEXT;
  v_p2     TEXT;
  v_user   UUID;
  v_other  TEXT;
  v_data   JSONB;
BEGIN
  SELECT * INTO v_cat FROM tournament_categories WHERE id = NEW.category_id;
  -- Reabrir (#517) passa os suplentes com a categoria ainda fechada: não se
  -- avisa, porque o lugar não está garantido.
  IF v_cat.status IS DISTINCT FROM 'inscricoes' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_t FROM tournaments WHERE id = v_cat.tournament_id;

  -- Nomes: quem tem conta pelo perfil; quem não tem, pelo nome escrito.
  v_p1 := COALESCE((SELECT name FROM profiles WHERE id = NEW.player1_id), v_row->>'guest1_name');
  v_p2 := COALESCE((SELECT name FROM profiles WHERE id = NEW.player2_id), NEW.guest_name);

  FOR v_user, v_other IN
    SELECT NEW.player1_id, v_p2 WHERE NEW.player1_id IS NOT NULL
    UNION ALL
    -- O parceiro só se avisa aqui se já tiver aceitado; se ainda não, o
    -- convite no sino já lhe diz o que fazer e até quando.
    SELECT NEW.player2_id, v_p1 WHERE NEW.player2_id IS NOT NULL AND NEW.partner_accepted_at IS NOT NULL
  LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM notifications
       WHERE user_id = v_user AND kind = 'tournament_promoted' AND read_at IS NULL
         AND data->>'entry_id' = NEW.id::text);

    v_data := jsonb_build_object(
      'entry_id',        NEW.id,
      'status',          NEW.status,
      'tournament_id',   v_t.id,
      'tournament_slug', v_t.slug,
      'tournament_name', v_t.name,
      'category_id',     v_cat.id,
      'category_code',   v_cat.code,
      'category_name',   v_cat.name,
      'partner_name',    v_other,
      -- Falta o parceiro dizer que sim (só acontece a quem inscreveu).
      'partner_pending', NEW.status = 'convite',
      'respond_by',      CASE WHEN NEW.status = 'convite' THEN NEW.respond_by END);

    INSERT INTO notifications (user_id, kind, actor_id, data)
    VALUES (v_user, 'tournament_promoted', auth.uid(), v_data);
  END LOOP;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION tournament_entry_promoted_notice() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS tournament_entries_promoted_notice ON tournament_entries;
CREATE TRIGGER tournament_entries_promoted_notice
  AFTER UPDATE OF status ON tournament_entries
  FOR EACH ROW
  WHEN (OLD.status = 'suplente'
        AND NEW.status IN ('convite', 'sem_parceiro', 'por_validar', 'validada', 'selecionada'))
  EXECUTE FUNCTION tournament_entry_promoted_notice();

-- ── 2. Confirmação ──────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'tournament_entries_promoted_notice'
                    AND tgrelid = 'public.tournament_entries'::regclass) THEN
    RAISE EXCEPTION 'O aviso não ficou ligado. Parar e ler.';
  END IF;
  RAISE NOTICE '#548: aviso ao suplente que sobe ligado.';
END $$;
