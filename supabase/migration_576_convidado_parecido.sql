-- ═════════════════════════════════════════════════════════════════════════
-- Contas repetidas (Trello #576): «Já estás neste mix como X? És tu?»
--
-- PORQUÊ. Quem entra num mix pelo WhatsApp fica como convidado do robô
-- (guest-…@whatsapp.alinho.pt), com o nome que tem no WhatsApp. Se depois
-- se inscreve no mesmo mix pela app, com a conta dele, a mesma pessoa ocupa
-- dois lugares (caso do A2N, 26 set: «J. S. S. R.» e «João Silva Santos
-- Rodrigues»). O link pessoal pelo robô foi recusado (risco de o WhatsApp
-- banir o bot); o Francisco aprovou (26 set, pelo PO) esta alternativa: a
-- app pergunta antes de inscrever, e não duplica.
--
-- O QUE FAZ. whatsapp_lookalike_in_game(p_game_id): para quem está a
-- entrar (auth.uid(), com o nome do seu perfil), devolve os convidados do
-- robô inscritos nesse mix com nome parecido:
-- [{participant_id, guest_user_id, name, as_partner}] — o que já aparece na
-- lista do mix, mais nada (privacidade).
--
-- «PARECIDO». Os nomes comparam-se sem acentos, maiúsculas nem pontuação,
-- palavra a palavra. As palavras do convidado têm de aparecer pela mesma
-- ordem no nome da pessoa, cada uma igual ou só a inicial, e a primeira
-- tem de bater com o primeiro nome:
--   «J. S. S. R.»     ≈ «João Silva Santos Rodrigues»   (iniciais)
--   «Paulo Henriques» = «Paulo Henriques»
--   «Paulo H»         ≈ «Paulo Henriques»
--   «João»            ≈ «João Silva»   (só o primeiro nome — é só uma pergunta)
--   «Silva»           ≠ «João Silva»   (tem de começar pelo primeiro nome)
-- Um falso «parecido» custa um «Não sou eu»; um que falhe custa uma
-- inscrição repetida — por isso a regra é larga.
--
-- Dev 3, 26 set 2026 · nome da função combinado com o Dev 2 (ecrã)
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- Palavras de um nome: minúsculas, sem acentos, só letras.
CREATE OR REPLACE FUNCTION public.name_words(p_name TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(w ORDER BY n), '{}')
    FROM regexp_split_to_table(
           regexp_replace(
             translate(lower(COALESCE(p_name, '')),
                       'áàâãäéèêëíìîïóòôõöúùûüçñ',
                       'aaaaaeeeeiiiiooooouuuucn'),
             '[^a-z]+', ' ', 'g'),
           ' ') WITH ORDINALITY AS t(w, n)
   WHERE w <> '';
$$;

-- O nome do convidado «cabe» no nome da pessoa (ver a regra no topo).
CREATE OR REPLACE FUNCTION public.names_look_alike(p_guest TEXT, p_person TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  g TEXT[] := name_words(p_guest);
  u TEXT[] := name_words(p_person);
  i INTEGER := 1;   -- palavra do convidado
  j INTEGER := 1;   -- palavra da pessoa
  ng INTEGER := cardinality(g);
  nu INTEGER := cardinality(u);
BEGIN
  IF ng = 0 OR nu = 0 THEN RETURN FALSE; END IF;
  WHILE i <= ng AND j <= nu LOOP
    IF g[i] = u[j] OR (length(g[i]) = 1 AND left(u[j], 1) = g[i]) THEN
      i := i + 1;
    ELSIF i = 1 THEN
      RETURN FALSE;   -- a primeira tem de bater com o primeiro nome
    END IF;
    j := j + 1;
  END LOOP;
  RETURN i > ng;
END;
$$;

REVOKE ALL ON FUNCTION public.name_words(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.names_look_alike(TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- Para o ecrã de entrar num mix (Dev 2; nome e forma dele). Uma linha por
-- inscrição: o convidado inscrito ele próprio (as_partner false) ou como
-- parceiro de alguém (as_partner true). Só inscrições confirmadas ou
-- suplentes; os convidados já juntados a uma conta deixaram de estar lá.
CREATE OR REPLACE FUNCTION public.whatsapp_lookalike_in_game(p_game_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'participant_id', p.id, 'guest_user_id', gp.id, 'name', gp.name,
           'as_partner', COALESCE(p.partner_id = gp.id, FALSE)) ORDER BY gp.name), '[]'::jsonb)
    FROM profiles me
    JOIN participants p ON p.game_id = p_game_id AND p.status IN ('confirmed', 'waitlisted')
    JOIN profiles gp ON gp.id IN (p.user_id, p.partner_id)
                    AND gp.email LIKE 'guest-%@whatsapp.alinho.pt' AND gp.id <> me.id
   WHERE me.id = auth.uid()
     AND me.email NOT LIKE 'guest-%@whatsapp.alinho.pt'
     AND names_look_alike(gp.name, me.name);
$$;

REVOKE ALL ON FUNCTION public.whatsapp_lookalike_in_game(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.whatsapp_lookalike_in_game(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_lookalike_in_game(UUID) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT names_look_alike('J. S. S. R.', 'João Silva Santos Rodrigues');   -- true
--   SELECT names_look_alike('Silva', 'João Silva');                          -- false
--   SELECT has_function_privilege('anon', 'public.whatsapp_lookalike_in_game(uuid)', 'EXECUTE');  -- false
