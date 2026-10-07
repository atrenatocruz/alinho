-- ═════════════════════════════════════════════════════════════════════════
-- As horas do WhatsApp de um evento, para o Editar
--
-- PORQUÊ. Auditoria do Dev 4 (design-handoff/2026-10-07-editar-tem-tudo/
-- AUDITORIA.md, ponto 1): no Editar do jogo em aberto, o campo das horas do
-- WhatsApp enchia-se com as do ÚLTIMO evento do clube
-- (default_whatsapp_post_times, que é para o Criar), e ao guardar ficavam
-- por cima das desta publicação. Faltava ler as horas do próprio evento.
-- Vale também para o Editar do mix, da série, do torneio e da turma.
--
-- O QUE FAZ. get_event_whatsapp_post_times(p_kind, p_id) → text[] 'HH:MM':
-- as horas com que o robô vai mesmo publicar ESTE evento:
--   · as que o evento tem guardadas ([] = sem lembretes);
--   · se não tem nenhumas guardadas (null), as do clube no Gerir, que é o
--     que o robô usa nesse caso.
-- kind: 'mix' | 'open_slot' (id do jogo) | 'mix_series' (id da série) |
-- 'tournament' | 'lesson' (id da turma), como o set_event_whatsapp_post_times.
-- Só membros do clube do evento; senão NULL (como o default_…). O ecrã
-- compara com o que a pessoa escolhe e só grava se mudar.
--
-- Dev 3, 7 out 2026 · ecrã: Dev 4
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.get_event_whatsapp_post_times(p_kind TEXT, p_id UUID)
RETURNS TEXT[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_org   UUID;
  v_times TIME[];
BEGIN
  IF p_kind IN ('mix', 'open_slot') THEN
    SELECT organization_id, whatsapp_post_times INTO v_org, v_times FROM games WHERE id = p_id;
  ELSIF p_kind = 'mix_series' THEN
    SELECT organization_id, whatsapp_post_times INTO v_org, v_times FROM game_recurrences WHERE id = p_id;
  ELSIF p_kind = 'tournament' THEN
    SELECT organization_id, whatsapp_post_times INTO v_org, v_times FROM tournaments WHERE id = p_id;
  ELSIF p_kind = 'lesson' THEN
    SELECT organization_id, whatsapp_post_times INTO v_org, v_times FROM lesson_series WHERE id = p_id;
  ELSE
    RETURN NULL;
  END IF;

  IF v_org IS NULL
     OR NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = v_org AND user_id = auth.uid()) THEN
    RETURN NULL;
  END IF;

  RETURN whatsapp_times_text(COALESCE(v_times, club_whatsapp_post_times(v_org)));
END;
$function$;
REVOKE ALL ON FUNCTION public.get_event_whatsapp_post_times(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_event_whatsapp_post_times(TEXT, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_event_whatsapp_post_times(TEXT, UUID) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT has_function_privilege('anon', 'public.get_event_whatsapp_post_times(text,uuid)', 'EXECUTE');  -- false
