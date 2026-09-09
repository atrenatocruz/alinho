-- ════════════════════════════════════════════════════════════════════════
-- Migration: coordenadas do local — Trello #203.
--
-- Pré-requisito do mapa por proximidade na Home (#205). Hoje `location` é
-- um TEXT solto em `games` e `organizations`: o autocompletar do Google
-- devolve a geometria do sítio e a app deitava-a fora, guardando só
-- "Nome - Morada formatada". Sem latitude/longitude não há mapa, nem
-- ordenação por distância, nem "mixes perto de mim".
--
-- NUMERIC(9,6) chega e sobra: latitude vai de -90 a 90 e longitude de -180
-- a 180, portanto 3 dígitos inteiros bastam, e 6 casas decimais dão ~11 cm
-- de resolução — muito acima do que uma morada de clube precisa. Escolhido
-- NUMERIC em vez de DOUBLE PRECISION pela mesma razão que price_per_player
-- é NUMERIC: valor exacto, sem surpresas de vírgula flutuante ao comparar.
--
-- NULLABLE de propósito. Tudo o que já existe fica sem coordenadas, e assim
-- continua — esta migration não inventa dados. Quem consumir isto tem de
-- lidar com o nulo (ver #205: decidir entre geocodificar o histórico ou
-- aceitar que só aparece no mapa o que for criado a partir de agora).
--
-- Sem alterações a RLS: são colunas novas em tabelas que já têm políticas,
-- e as políticas são ao nível da linha, não da coluna. Confirmado que não
-- há GRANTs por coluna em `games` nem em `organizations` que precisassem de
-- ser estendidos.
--
-- Correr este ficheiro todo no Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS latitude NUMERIC(9,6);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS longitude NUMERIC(9,6);

ALTER TABLE games ADD COLUMN IF NOT EXISTS latitude NUMERIC(9,6);
ALTER TABLE games ADD COLUMN IF NOT EXISTS longitude NUMERIC(9,6);

COMMENT ON COLUMN organizations.latitude IS
  'Latitude do local do clube, preenchida a partir do autocompletar do Google. NULL para clubes criados antes da migration #203.';
COMMENT ON COLUMN organizations.longitude IS
  'Longitude do local do clube. Ver latitude.';
COMMENT ON COLUMN games.latitude IS
  'Latitude do local do mix, preenchida a partir do autocompletar do Google. NULL para mixes criados antes da migration #203, e sempre que o admin escreveu a morada à mão em vez de a escolher da lista.';
COMMENT ON COLUMN games.longitude IS
  'Longitude do local do mix. Ver latitude.';
