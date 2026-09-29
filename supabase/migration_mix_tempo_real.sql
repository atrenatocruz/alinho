-- ═════════════════════════════════════════════════════════════════════════
-- Mix: resultados em tempo real para quem tem o mix aberto (Renato, 29 set).
--
-- «Se eu atualizar um resultado e houver outro admin com a app nos
-- resultados aberta, o resultado não atualiza.»
--
-- A página do mix (GameDetails.jsx) já está à escuta de mudanças em
-- participants, games e matches. Mas o Supabase só envia as mudanças das
-- tabelas que estão na publicação `supabase_realtime`, e só lá foram postas
-- participants e games (migration_whatsapp_bot.sql, para o bot). Os
-- resultados (matches) nunca chegavam: quem tinha o mix aberto só os via
-- ao sair da app e voltar.
--
-- Aqui:
--   · matches e teams entram na publicação (teams: o sobe e desce com
--     parceiros que trocam cria duplas novas a cada ronda);
--   · REPLICA IDENTITY FULL nas duas, para um DELETE também levar o
--     game_id — sem isso o filtro `game_id=eq.<id>` da página não apanha
--     um jogo ou uma dupla apagados (a mesma razão de participants, no
--     migration_whatsapp_bot.sql).
--
-- O tempo real respeita as mesmas regras de RLS que uma leitura normal:
-- cada pessoa só recebe mudanças de jogos que já podia ver.
--
-- Seguro de correr mais do que uma vez.
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE public.matches REPLICA IDENTITY FULL;
ALTER TABLE public.teams REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.matches;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.teams;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
