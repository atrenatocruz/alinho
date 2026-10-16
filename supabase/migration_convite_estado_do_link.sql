-- ═════════════════════════════════════════════════════════════════════════
-- Links de convite: o estado do link, sem sessão e sem dados de ninguém
--
-- PORQUÊ. Revisão do site pelo PO (print 15), via Bugs, 13 out: abrir
-- /convite/<código que não existe> sem sessão mostrava «Guardaram-te um
-- lugar» e «Criar conta». Sem sessão não havia forma de saber se o convite
-- existe: o get_partner_invite só serve a quem tem sessão (e bem, porque
-- devolve nomes). Ecrã: Bugs.
--
-- O QUE FAZ. invite_link_status(p_kind, p_token) → 'pending' | 'claimed' |
-- 'expired' | 'not_found'. Só o estado; nada de nomes, jogos ou datas.
--   · 'mix': partner_invites — 'expired' se ainda por usar e já passou o
--     prazo (como o get_partner_invite); 'claimed' se já foi usado;
--   · 'tournament': o link do parceiro ou do jogador 1 (invite_token,
--     invite_token_player1) numa inscrição que não desistiu — 'expired' se a
--     categoria já não está em inscrições; ao ficar com o lugar o link
--     apaga-se, por isso um link já usado dá 'not_found';
--   · 'friends': private_match_invitees.invite_token — 'claimed' se já tem
--     conta; 'not_found' se recusou;
--   · qualquer outra coisa: 'not_found'.
-- Aberta a anon e a authenticated: o token é comprido e não se adivinha, e a
-- resposta não diz nada de ninguém.
--
-- Dev 3, 13 out 2026 · ecrã: Bugs
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.invite_link_status(p_kind TEXT, p_token TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT COALESCE(CASE
    WHEN NULLIF(btrim(p_token), '') IS NULL THEN 'not_found'
    WHEN p_kind = 'mix' THEN (
      SELECT CASE WHEN i.status = 'pending' AND i.expires_at < TIMEZONE('utc', NOW()) THEN 'expired'
                  WHEN i.status = 'pending' THEN 'pending'
                  WHEN i.status = 'claimed' THEN 'claimed'
                  ELSE 'not_found' END
        FROM partner_invites i WHERE i.token = p_token LIMIT 1)
    WHEN p_kind = 'tournament' THEN (
      SELECT CASE WHEN c.status <> 'inscricoes' THEN 'expired' ELSE 'pending' END
        FROM tournament_entries e JOIN tournament_categories c ON c.id = e.category_id
       WHERE (e.invite_token = p_token OR e.invite_token_player1 = p_token) AND e.status <> 'desistiu'
       LIMIT 1)
    WHEN p_kind = 'friends' THEN (
      SELECT CASE WHEN i.status = 'declined' THEN 'not_found'
                  WHEN i.user_id IS NOT NULL THEN 'claimed'
                  ELSE 'pending' END
        FROM private_match_invitees i WHERE i.invite_token = p_token LIMIT 1)
  END, 'not_found');
$function$;
REVOKE ALL ON FUNCTION public.invite_link_status(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_link_status(TEXT, TEXT) TO anon, authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT invite_link_status('mix', 'nao-existe');  -- not_found
--   SELECT has_function_privilege('anon', 'public.invite_link_status(text,text)', 'EXECUTE');  -- true (de propósito)
