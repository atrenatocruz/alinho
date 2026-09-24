-- ════════════════════════════════════════════════════════════════════════
-- Migration: avisar também quem o admin inscreve num mix ABERTO
-- (Trello #534 — plano aprovado pelo Francisco a 24 set 2026).
-- Primeira metade do #534; a segunda (a trava na política dos admins) está
-- em migration_admin_adds_to_open_mix.sql e espera o acordo do Renato.
-- Esta corre sozinha, sem depender da outra: o «Adicionar jogador» com o mix
-- aberto já grava hoje (a política FOR ALL dos admins deixa); sem esta, a
-- pessoa inscrita não recebe aviso nenhum.
--
-- Precisa de migration_mix_notices.sql (tabela notifications), que já corre
-- em produção. Corpo copiado da função VIVA em produção a 24 set; só muda:
-- • o estado aceite: open/closed/in_progress (antes só in_progress);
-- • sem duplas feitas (antes de começar), o parceiro lê-se da inscrição;
-- • o aviso guarda o nome de quem inscreveu (actor_name), para o sino dizer
--   «O X inscreveu-te…».
-- Os grants não mudam (CREATE OR REPLACE mantém-nos).
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.notify_mix_changes(p_game_id uuid, p_changes jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_game games%ROWTYPE;
  v_change JSONB;
  v_user UUID;
  v_kind TEXT;
  v_in_mix BOOLEAN;
  v_partner UUID;
  v_partner_name TEXT;
  v_actor_name TEXT;
  v_data JSONB;
  v_pending notifications%ROWTYPE;
  v_count INTEGER := 0;
BEGIN
  SELECT * INTO v_game FROM games WHERE id = p_game_id;
  IF v_game.id IS NULL THEN
    RAISE EXCEPTION 'Mix não encontrado';
  END IF;
  IF NOT is_org_admin(v_game.organization_id) THEN
    RAISE EXCEPTION 'Só o admin do clube ou grupo pode avisar os jogadores';
  END IF;
  -- Trello #534: também antes de começar (aberto ou fechado por estar cheio).
  IF v_game.status NOT IN ('open', 'closed', 'in_progress') THEN
    RAISE EXCEPTION 'Só se avisa em mixes abertos ou a decorrer';
  END IF;

  SELECT name INTO v_actor_name FROM profiles WHERE id = auth.uid();

  FOR v_change IN SELECT * FROM jsonb_array_elements(COALESCE(p_changes, '[]'::jsonb)) LOOP
    v_user := NULLIF(v_change->>'user_id', '')::uuid;
    v_kind := v_change->>'kind';
    CONTINUE WHEN v_user IS NULL OR v_kind NOT IN ('mix_joined', 'mix_removed', 'mix_partner_changed');

    -- Confere com o estado real: não se avisa "entraste" a quem não está
    -- nem "saíste" a quem continua.
    v_in_mix := EXISTS (
      SELECT 1 FROM participants
      WHERE game_id = p_game_id AND status = 'confirmed' AND (user_id = v_user OR partner_id = v_user)
    );
    CONTINUE WHEN (v_kind = 'mix_removed') = v_in_mix;

    v_partner := NULL;
    v_partner_name := NULL;
    IF v_kind <> 'mix_removed' THEN
      SELECT CASE WHEN player1_id = v_user THEN player2_id ELSE player1_id END
        INTO v_partner
        FROM teams
       WHERE game_id = p_game_id AND (player1_id = v_user OR player2_id = v_user)
       LIMIT 1;
      -- Antes de começar ainda não há duplas: o parceiro é o da inscrição.
      IF v_partner IS NULL THEN
        SELECT CASE WHEN user_id = v_user THEN partner_id ELSE user_id END
          INTO v_partner
          FROM participants
         WHERE game_id = p_game_id AND status = 'confirmed'
           AND (user_id = v_user OR partner_id = v_user)
         LIMIT 1;
      END IF;
      IF v_partner IS NOT NULL THEN
        SELECT name INTO v_partner_name FROM profiles WHERE id = v_partner;
      END IF;
    END IF;

    v_data := jsonb_build_object(
      'game_title', v_game.title,
      'game_date', v_game.date,
      'partner_id', v_partner,
      'partner_name', v_partner_name,
      'actor_name', v_actor_name
    );

    -- Aviso anterior do mesmo jogador neste mix que ainda ninguém viu.
    SELECT * INTO v_pending
      FROM notifications
     WHERE user_id = v_user AND game_id = p_game_id
       AND kind IN ('mix_joined', 'mix_removed', 'mix_partner_changed')
       AND read_at IS NULL AND bot_processed_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1;

    IF v_pending.id IS NOT NULL THEN
      DELETE FROM notifications WHERE id = v_pending.id;
      IF v_pending.kind = 'mix_joined' AND v_kind = 'mix_removed' THEN
        CONTINUE; -- entrou e saiu: não há nada a dizer
      ELSIF v_pending.kind = 'mix_joined' THEN
        v_kind := 'mix_joined'; -- entrou e depois mudou de parceiro: continua "entraste"
      ELSIF v_pending.kind = 'mix_removed' AND v_kind = 'mix_joined' THEN
        v_kind := 'mix_partner_changed'; -- saiu e voltou: para ele só mudou a dupla
      END IF;
    END IF;

    INSERT INTO notifications (user_id, kind, game_id, actor_id, data)
    VALUES (v_user, v_kind, p_game_id, auth.uid(), v_data);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;
