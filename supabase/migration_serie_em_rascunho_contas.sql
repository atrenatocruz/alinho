-- ═════════════════════════════════════════════════════════════════════════
-- Série em rascunho: os números antes de confirmar
--
-- PORQUÊ. Dev 1, 7 out: a pergunta do «Pausar» diz os números antes de
-- quem organiza confirmar: «A série fica em rascunho: N datas saem e N
-- pessoas inscritas recebem aviso.» Os números têm de bater sempre com os
-- que a pause_recurrence_to_draft devolve, por isso contam-se aqui, com a
-- mesma regra, e não no ecrã.
--
-- O QUE FAZ. preview_recurrence_pause(p_recurrence_id) → jsonb {dates,
-- people}, sem mudar nada:
--   · dates: datas da série com a hora no futuro, por abrir, abertas ou
--     cheias (as mesmas que a pausa põe em rascunho);
--   · people: os avisos que a pausa vai mandar: em cada uma dessas datas,
--     cada pessoa com conta inscrita, suplente ou com pedido (e o parceiro),
--     menos quem carrega no botão. Quem está em duas datas conta duas vezes
--     (recebe dois avisos), como na pausa.
--   Só o admin do clube ('not_allowed').
--
-- Precisa da migration_serie_em_rascunho.sql. Dev 3, 7 out 2026 · ecrã: Dev 1
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.preview_recurrence_pause(p_recurrence_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  gr       game_recurrences%ROWTYPE;
  v_dates  INTEGER;
  v_people INTEGER;
BEGIN
  SELECT * INTO gr FROM game_recurrences WHERE id = p_recurrence_id;
  IF gr.id IS NULL OR auth.uid() IS NULL OR NOT is_org_admin(gr.organization_id) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;

  SELECT count(*) INTO v_dates FROM games
   WHERE recurrence_id = gr.id AND date > NOW() AND status IN ('pending', 'open', 'closed');

  -- A mesma conta do aviso do unpublish_mix, data a data.
  SELECT count(*) INTO v_people FROM (
    SELECT DISTINCT g.id, who.u
      FROM games g
      JOIN participants p ON p.game_id = g.id AND p.status NOT IN ('declined', 'cancelled')
      CROSS JOIN LATERAL (VALUES (p.user_id), (p.partner_id)) AS who(u)
     WHERE g.recurrence_id = gr.id AND g.date > NOW() AND g.status IN ('pending', 'open', 'closed')
       AND who.u IS NOT NULL AND who.u <> auth.uid()
  ) x;

  RETURN jsonb_build_object('dates', v_dates, 'people', v_people);
END;
$function$;
REVOKE ALL ON FUNCTION public.preview_recurrence_pause(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.preview_recurrence_pause(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.preview_recurrence_pause(UUID) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT has_function_privilege('anon', 'public.preview_recurrence_pause(uuid)', 'EXECUTE');  -- false
