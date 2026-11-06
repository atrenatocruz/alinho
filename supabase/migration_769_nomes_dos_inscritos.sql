-- #769: quem vê um mix vê o nome de todos os inscritos, mesmo dos que não são
-- membros do grupo (regra do Francisco de 1 out: um perfil nunca desaparece).
--
-- Porquê uma função e não abrir a política de leitura de `profiles`: as colunas
-- de profiles estão todas abertas a authenticated (email, phone_hash, birthday…),
-- por isso abrir a linha abria também isso. Aqui só sai o que o ecrã do mix usa.
--
-- Quem pode pedir: o mesmo que pode ler as inscrições deste mix (política «Org
-- members can view participants»). Quem não é membro do grupo recebe zero linhas.
-- Só acrescenta: a app antiga não a chama.

CREATE OR REPLACE FUNCTION public.mix_people_shown(p_game_id uuid)
RETURNS TABLE (id uuid, name text, avatar_url text, preferred_side text, rating_games integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT pr.id, pr.name, pr.avatar_url, pr.preferred_side, pr.rating_games
    FROM profiles pr
   WHERE pr.id IN (
           SELECT unnest(ARRAY[p.user_id, p.partner_id]) FROM participants p WHERE p.game_id = p_game_id
           UNION
           SELECT unnest(ARRAY[t.player1_id, t.player2_id]) FROM teams t WHERE t.game_id = p_game_id
         )
     AND EXISTS (
           SELECT 1
             FROM games g
             JOIN memberships m ON m.organization_id = g.organization_id
            WHERE g.id = p_game_id AND m.user_id = auth.uid()
         );
$function$;

REVOKE ALL ON FUNCTION public.mix_people_shown(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mix_people_shown(uuid) TO authenticated;
