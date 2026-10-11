-- ═════════════════════════════════════════════════════════════════════════
-- Mix: aviso «🏆 <Evento> terminou. Ganharam <vencedores>.» (#622, ponto 4)
--
-- PORQUÊ. SPEC design-handoff/2026-10-11-vencedores-em-todos-os-jogos
-- (Francisco, 11 out), pedido do Dev 2. Quando um mix (ou um jogo em
-- aberto, que também é um games) termina, quem jogou e tem conta recebe um
-- aviso no sino. Tocar abre a página do jogo. O robô não manda nada (o
-- Francisco não quer mensagens novas no WhatsApp; o mixNotices.js do robô só
-- trata mix_joined, mix_removed e mix_partner_changed).
--
-- COMO, COM CUIDADO (PO). Não se mexe nas funções que fecham o mix e dão
-- os pontos (finalize_mix, finalize_americano_mix): um gatilho à parte, como
-- o do mix cancelado (games_notify_mix_cancelled), corre quando o estado
-- passa a 'finished' (ou 'completed'). Só escreve o aviso; não muda nada nas
-- contas; e qualquer erro dele é engolido (fica um WARNING), por isso o
-- aviso nunca faz falhar o fecho. São estes os dois únicos sítios que põem
-- um mix como terminado (o fecho automático da noite passa pelo
-- finalize_mix).
--
-- O AVISO. kind 'mix_finished', game_id = o mix, data = {game_title,
-- game_date, winners, winners_anonymous}:
--   · winners: os nomes curtos dos vencedores («Rita F. / Tiago L.»): a
--     dupla vencedora; no Americano, quem ficou com o «ganhou o mix» (com a
--     migration_americano_voucher.sql, o 1.º com desempate). Se algum
--     vencedor esconde os resultados (live_hides_results), winners = null e
--     winners_anonymous = true. Sem vencedor com conta (ex.: Americano ganho
--     por um convidado), winners = null e winners_anonymous = false.
--   · vai a cada pessoa com conta que jogou algum jogo do mix, uma vez só.
--
-- Dev 3, 11 out 2026 · ecrã: Dev 2
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.notify_mix_finished()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_ids   UUID[];
  v_names TEXT;
  v_hide  BOOLEAN := FALSE;
BEGIN
  BEGIN
    -- Quem ganhou.
    IF NEW.winner_team_id IS NOT NULL THEN
      SELECT array_remove(ARRAY[t.player1_id, t.player2_id], NULL),
             concat_ws(' / ', COALESCE(live_short_name(p1.name), g1.name), COALESCE(live_short_name(p2.name), g2.name))
        INTO v_ids, v_names
        FROM teams t
        LEFT JOIN profiles p1 ON p1.id = t.player1_id
        LEFT JOIN profiles p2 ON p2.id = t.player2_id
        LEFT JOIN game_guests g1 ON g1.id = t.player1_guest_id
        LEFT JOIN game_guests g2 ON g2.id = t.player2_guest_id
       WHERE t.id = NEW.winner_team_id;
    ELSE
      -- Americano (sem dupla vencedora): quem ficou com o «ganhou o mix».
      SELECT array_agg(s.user_id ORDER BY p.name), string_agg(live_short_name(p.name), ' / ' ORDER BY p.name)
        INTO v_ids, v_names
        FROM mix_player_stats s JOIN profiles p ON p.id = s.user_id
       WHERE s.game_id = NEW.id AND s.mix_won;
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(COALESCE(v_ids, '{}')) w WHERE live_hides_results(w)) THEN
      v_hide := TRUE;
      v_names := NULL;
    END IF;

    INSERT INTO notifications (user_id, kind, game_id, data)
    SELECT DISTINCT who.u, 'mix_finished', NEW.id,
           jsonb_build_object('game_title', NEW.title, 'game_date', NEW.date,
                              'winners', NULLIF(v_names, ''), 'winners_anonymous', v_hide)
      FROM matches m
      JOIN teams t ON t.id IN (m.team_a_id, m.team_b_id),
           LATERAL (VALUES (t.player1_id), (t.player2_id)) AS who(u)
     WHERE m.game_id = NEW.id AND who.u IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM notifications n
                        WHERE n.user_id = who.u AND n.kind = 'mix_finished' AND n.game_id = NEW.id);
  EXCEPTION WHEN OTHERS THEN
    -- O aviso nunca faz falhar o fecho do mix.
    RAISE WARNING 'notify_mix_finished (%): %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_mix_finished() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS games_notify_mix_finished ON games;
CREATE TRIGGER games_notify_mix_finished
  AFTER UPDATE OF status ON games
  FOR EACH ROW
  WHEN (NEW.status IN ('finished', 'completed') AND OLD.status IS DISTINCT FROM NEW.status
        AND OLD.status NOT IN ('finished', 'completed'))
  EXECUTE FUNCTION notify_mix_finished();

COMMIT;

-- Verificar depois de correr:
--   SELECT tgname FROM pg_trigger WHERE tgname = 'games_notify_mix_finished';                  -- 1 linha
--   SELECT has_function_privilege('anon', 'public.notify_mix_finished()', 'EXECUTE');            -- false
