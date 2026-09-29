-- ═════════════════════════════════════════════════════════════════════════
-- Tempo real: participants e games na publicação, onde ainda não estão
-- (Renato, 29 set 2026).
--
-- Visto em dev depois da migration_mix_tempo_real.sql: matches e teams já
-- estavam na publicação `supabase_realtime`, mas participants e games não
-- — a migration_whatsapp_bot.sql, que as põe lá, só correu onde o bot
-- corre. E basta UMA tabela fora da publicação para o Supabase recusar o
-- canal todo («Unable to subscribe to changes with given parameters»):
-- a página do mix ouvia as quatro no mesmo canal, por isso os resultados
-- também não chegavam. (O código passou a usar um canal por tabela; isto é
-- para as entradas/saídas e o estado do mix também chegarem em tempo real.)
--
-- É o mesmo que os passos 3 e 4 da migration_whatsapp_bot.sql. Onde essa
-- já correu (produção), isto não muda nada.
--
-- Seguro de correr mais do que uma vez.
-- ═════════════════════════════════════════════════════════════════════════

-- Um DELETE também leva o game_id (o filtro da página e do bot usam-no).
ALTER TABLE public.participants REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.participants;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.games;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
