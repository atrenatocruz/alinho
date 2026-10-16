-- ═════════════════════════════════════════════════════════════════════════
-- Jogos entre amigos: o aviso do convite mostra a hora de agora
--
-- PORQUÊ. QA, 13 out (ponto c, via Dev 2): o aviso do convite no sino
-- ('friend_match_invite') guarda o dia, a hora e o sítio do momento em que
-- foi criado. Depois de se mudar a hora no Editar, continuava a mostrar a
-- antiga.
--
-- O QUE FAZ. Quando o dia, a hora ou o sítio de uma sessão entre amigos
-- mudam (por qualquer caminho: Editar, ou outro), os avisos de convite
-- desse jogo passam a ter os valores novos (scheduled_date, scheduled_time,
-- location). Gatilho AFTER UPDATE em private_matches, só nas sessões; nunca
-- faz falhar a gravação.
--
-- Dev 3, 13 out 2026 · ecrã: Dev 2
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.friend_match_invite_notice_follow()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  BEGIN
    UPDATE notifications
       SET data = data || jsonb_build_object('scheduled_date', NEW.scheduled_date,
                                             'scheduled_time', NEW.scheduled_time,
                                             'location', NEW.location)
     WHERE kind = 'friend_match_invite' AND data->>'match_id' = NEW.id::text;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'friend_match_invite_notice_follow (%): %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.friend_match_invite_notice_follow() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS friend_match_invite_notice_follow ON private_matches;
CREATE TRIGGER friend_match_invite_notice_follow
  AFTER UPDATE OF scheduled_date, scheduled_time, location ON private_matches
  FOR EACH ROW
  WHEN (NEW.is_friend_session
        AND (NEW.scheduled_date IS DISTINCT FROM OLD.scheduled_date
             OR NEW.scheduled_time IS DISTINCT FROM OLD.scheduled_time
             OR NEW.location IS DISTINCT FROM OLD.location))
  EXECUTE FUNCTION friend_match_invite_notice_follow();

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM pg_trigger WHERE tgname = 'friend_match_invite_notice_follow';  -- 1
