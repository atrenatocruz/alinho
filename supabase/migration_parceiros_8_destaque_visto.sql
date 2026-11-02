-- ═════════════════════════════════════════════════════════════════════════
-- Parceiros 8: o cartão grande do parceiro na Home só uma vez por pessoa
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- Cartão: #753 — https://trello.com/c/obQpRsfs
-- ORDEM: depois das migrações que criaram partners (parceiros 1 a 7, já
-- corridas em produção a 1 nov). Revista pelo Dev 3 a 2 nov.
-- Dev 4, 2 nov 2026.
--
-- PORQUÊ. SPEC design-handoff/2026-11-01-parceiro-na-home (aprovada pelo
-- Francisco a 2 nov; plano aprovado no mesmo dia; cartão #753). A primeira vez
-- que alguém vê um parceiro na Home, o cartão aparece em grande; depois passa
-- a uma linha. Tem de valer de um aparelho para o outro, por isso a marca fica
-- na base e não só no navegador.
--
-- O QUE FAZ
--   1. partner_highlight_seen (user_id, partner_id, seen_at): «esta pessoa já
--      viu o destaque deste parceiro». Só isto: nada de contagens (essas são
--      do partner_track, sem guardar quem foi) e ninguém a lê a não ser o
--      próprio. Apaga-se com a conta e com o parceiro.
--   2. my_partner_highlights_seen(): os ids dos parceiros que eu já vi em
--      destaque.
--   3. mark_partner_highlight_seen(p_partner_id): marca o meu; a segunda vez
--      não faz nada. Nunca dá erro com um id que não existe.
--
-- A tabela fica fechada a toda a gente (sem GRANT); só as duas funções lhe
-- mexem, e só na linha de quem chama. Só para quem tem sessão.
-- Sem esta migração a app continua a funcionar: guarda a marca só no aparelho.
-- Só acrescenta; não muda nada do que existe.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.partner_highlight_seen (
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  partner_id UUID NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, partner_id)
);

ALTER TABLE public.partner_highlight_seen ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.partner_highlight_seen FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.my_partner_highlights_seen()
RETURNS UUID[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  SELECT COALESCE(array_agg(partner_id), '{}')
  FROM public.partner_highlight_seen
  WHERE user_id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.mark_partner_highlight_seen(p_partner_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  IF auth.uid() IS NULL OR p_partner_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.partners WHERE id = p_partner_id) THEN
    RETURN;
  END IF;
  INSERT INTO public.partner_highlight_seen (user_id, partner_id)
  VALUES (auth.uid(), p_partner_id)
  ON CONFLICT (user_id, partner_id) DO NOTHING;
END;
$function$;

REVOKE ALL ON FUNCTION public.my_partner_highlights_seen() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_partner_highlights_seen() TO authenticated;
REVOKE ALL ON FUNCTION public.mark_partner_highlight_seen(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_partner_highlight_seen(UUID) TO authenticated;

COMMIT;

-- Verificação (SI):
-- SELECT has_table_privilege('anon','public.partner_highlight_seen','SELECT'),
--        has_table_privilege('authenticated','public.partner_highlight_seen','SELECT');
--   → false, false
-- SELECT proname, has_function_privilege('anon',oid,'EXECUTE'), has_function_privilege('authenticated',oid,'EXECUTE')
--   FROM pg_proc WHERE proname IN ('my_partner_highlights_seen','mark_partner_highlight_seen');
--   → false, true nas duas
