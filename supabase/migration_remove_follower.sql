-- ════════════════════════════════════════════════════════════════════════
-- Migration: remover um seguidor já aceite.
--
-- O Francisco (17 set 2026): "falta remover seguidor (hoje não dá para
-- tirar alguém que já te segue)".
--
-- O QUE MUDA
-- `migration_instagram_follow_system.sql` deixou isto de fora de propósito
-- ("remove follower is a distinct feature, out of scope for this
-- migration"). A política de DELETE só deixava quem é seguido apagar linhas
-- `pending` (recusar um pedido). Passa a deixar apagar também as
-- `accepted` — é o "remover seguidor".
--
-- Continua a não haver forma de mexer na linha de outra pessoa: só o
-- seguidor (`follower_id`) ou o seguido (`followed_id`) podem apagar.
-- Ninguém pode apagar uma relação entre terceiros.
--
-- Não avisa a pessoa removida (o mesmo que o Instagram faz), e ela pode
-- voltar a seguir depois — se a conta for privada, com novo pedido, porque
-- a função `follow` continua a criar `pending` nesse caso.
--
-- Efeito colateral deliberado: deixar de haver follow mútuo faz as duas
-- pessoas deixarem de ser "amigos" (`is_mutual_follow`), e portanto o que
-- estiver limitado a amigos deixa de ser visível. É o comportamento
-- esperado de remover alguém.
--
-- Correr este ficheiro inteiro em Supabase → SQL Editor → New query → Run,
-- ANTES de o código chegar a `dev` ou `main`.
-- ════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Follower can always leave; followed party can only decline while pending" ON follows;

CREATE POLICY "Either party can end a follow"
  ON follows FOR DELETE TO authenticated
  USING (auth.uid() = follower_id OR auth.uid() = followed_id);
