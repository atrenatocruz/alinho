-- ═════════════════════════════════════════════════════════════════════════
-- O RANKING QUE SE VÊ DEIXA DE MOSTRAR CONTAS DE TESTE
-- (Dev 3, 24 set 2026) — cartão «#422».
--
-- Pode-se correr outra vez sem estragar. Não altera nem apaga nada do que
-- já existe: acrescenta duas funções novas.
--
-- ─────────────────────────────────────────────────────────────────────────
-- PORQUE É QUE NÃO SE MEXE NA `get_global_rankings`
-- ─────────────────────────────────────────────────────────────────────────
-- Ela não é só o ranking. É também a tabela de pontos com que o bot
-- (`whatsapp-bot/src/autostart.js`) e o ecrã do mix (`GameDetails.jsx`,
-- quatro sítios) FORMAM AS DUPLAS. Quem sair dela passa a contar como 0
-- pontos na formação das duplas — foi o erro que o Renato corrigiu a 31 ago
-- (`migration_global_rankings_include_onboarded.sql`).
--
-- Por isso: a lista para formar duplas fica exatamente como está, e o que se
-- MOSTRA passa a vir destas duas funções novas, por cima das existentes.
--
-- ─────────────────────────────────────────────────────────────────────────
-- PORQUE É QUE DEVOLVEM `jsonb` E NÃO UMA TABELA
-- ─────────────────────────────────────────────────────────────────────────
-- Uma função que devolve TABLE(...) tem de repetir as colunas da outra, e as
-- colunas da `get_global_rankings` em produção já mudaram várias vezes à mão
-- (o próprio ficheiro de 31 ago avisa: «a forma tem de bater com a função
-- VIVA»). Se eu escrevesse as colunas daqui, ficavam certas no dia em que
-- se escrevessem e erradas no dia em que alguém mudasse a outra.
--
-- Devolvendo cada linha como `jsonb`, a função nova devolve EXATAMENTE o que
-- a de baixo devolver, seja qual for a versão que está no ar — só sem as
-- contas de teste. A app recebe os mesmos objetos que recebia.
--
-- A ordem mantém-se (`WITH ORDINALITY`): o ecrã conta com a lista já do
-- melhor para o pior.
--
-- ─────────────────────────────────────────────────────────────────────────
-- O QUE É UMA CONTA DE TESTE
-- ─────────────────────────────────────────────────────────────────────────
-- Duas marcas, e nenhuma é nova:
--   · `memberships.is_test` — a que a app já usa (a `search_any_player` e a
--     `get_organization_player_rankings` escondem por ela);
--   · o endereço `@ensaio.alinho.test` — o das contas que o
--     `seed_ensaio_torneio.sql` cria para o ensaio do torneio. Essas não têm
--     inscrição em clube nenhum (inscrever centenas num clube batia nos
--     limites do plano e enchia as listas de membros), por isso a primeira
--     marca não lhes pegava — e como têm jogos, entravam no ranking com
--     lugar. O `.test` é um terminal reservado: nenhum endereço verdadeiro
--     acaba assim.
--
-- ⚠️ Em produção, a 24 set, NENHUMA das contas de teste do topo estava
-- marcada. Sem as marcar, isto não esconde nada. A marcação vai à parte
-- (ver o fim do ficheiro), porque é mudar dados, não a estrutura.
--
-- ─────────────────────────────────────────────────────────────────────────
-- O QUE ESTE FICHEIRO NÃO FAZ
-- ─────────────────────────────────────────────────────────────────────────
-- Não tira do ranking quem nunca jogou. Essas pessoas têm de continuar a
-- aparecer no Global (decisão do Francisco, 24 set); o que muda é que só
-- ganham lugar nas listas Masculino e Feminino depois do primeiro jogo. Isso
-- é regra de ecrã e está em `src/lib/rankingScales.js`.
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_public_rankings()
RETURNS SETOF jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_jsonb(g) - 'ordinality'
    FROM get_global_rankings() WITH ORDINALITY AS g
   WHERE NOT EXISTS (
     SELECT 1 FROM memberships m WHERE m.user_id = g.user_id AND m.is_test
   )
     AND NOT EXISTS (
     SELECT 1 FROM profiles p WHERE p.id = g.user_id AND p.email LIKE '%@ensaio.alinho.test'
   )
   ORDER BY g.ordinality;
$$;

-- Os mesmos direitos da função de baixo: só quem tem sessão.
REVOKE ALL ON FUNCTION get_public_rankings() FROM public, anon;
GRANT EXECUTE ON FUNCTION get_public_rankings() TO authenticated;

-- A do ranking de assiduidade (XP) só se cria onde a `get_xp_rankings`
-- existe. Em produção existe; no `alinho-dev`, a 24 set, NÃO — o dev está
-- atrasado. Sem esta condição o ficheiro inteiro falhava no dev, e quem o
-- corresse lá ficava sem saber se a parte de cima tinha entrado.
DO $$
BEGIN
  IF to_regprocedure('get_xp_rankings(uuid)') IS NULL THEN
    RAISE NOTICE 'Sem get_xp_rankings nesta base de dados: get_public_xp_rankings não criada. A app continua a usar a antiga.';
    RETURN;
  END IF;

  EXECUTE $f$
    CREATE OR REPLACE FUNCTION get_public_xp_rankings(p_organization_id UUID DEFAULT NULL)
    RETURNS SETOF jsonb
    LANGUAGE sql
    STABLE SECURITY DEFINER
    SET search_path = public
    AS $b$
      SELECT to_jsonb(x) - 'ordinality'
        FROM get_xp_rankings(p_organization_id) WITH ORDINALITY AS x
       WHERE NOT EXISTS (
         SELECT 1 FROM memberships m WHERE m.user_id = x.user_id AND m.is_test
       )
         AND NOT EXISTS (
         SELECT 1 FROM profiles p WHERE p.id = x.user_id AND p.email LIKE '%@ensaio.alinho.test'
       )
       ORDER BY x.ordinality;
    $b$
  $f$;
  EXECUTE 'REVOKE ALL ON FUNCTION get_public_xp_rankings(UUID) FROM public, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION get_public_xp_rankings(UUID) TO authenticated';
END $$;

-- ═════════════════════════════════════════════════════════════════════════
-- À PARTE — MARCAR AS CONTAS DE TESTE QUE JÁ EXISTEM (dados, não estrutura)
-- ═════════════════════════════════════════════════════════════════════════
-- Confirmadas pelo Francisco a 24 set como contas de teste:
--   «teste ruben», «Teste ruben2», «testeruben», e a «Francisco Barros»
--   criada a 23 set às 12h32 (NÃO a conta principal dele, que é super admin).
--
-- Correr primeiro a pré-visualização e confirmar que aparecem as 4 contas
-- certas, e só essas. A «Francisco Barros» identifica-se pela data, porque
-- há duas com o mesmo nome — nunca pelo nome sozinho.
--
--   SELECT p.id, p.name, p.created_at, p.is_platform_admin,
--          (SELECT count(*) FROM memberships m WHERE m.user_id = p.id) AS inscricoes
--     FROM profiles p
--    WHERE lower(p.name) IN ('teste ruben', 'teste ruben2', 'testeruben')
--       OR (p.name = 'Francisco Barros' AND NOT p.is_platform_admin
--           AND p.created_at::date = DATE '2026-09-23');
--
-- ⚠️ Se alguma tiver `inscricoes = 0`, não há onde pôr a marca (a marca vive
-- na inscrição num clube). Nesse caso NÃO criar inscrições às cegas — dizer
-- ao Dev 3, que vê a melhor forma.
--
-- Depois de confirmado:
--
--   UPDATE memberships SET is_test = true
--    WHERE user_id IN (<os 4 ids da pré-visualização>);
