-- ════════════════════════════════════════════════════════════════════════
-- Migration: nacionalidade no perfil — Trello #191.
--
-- Decisão do Francisco (9 set 2026): campo no editar perfil, também
-- oferecido na criação do perfil, e **nunca obrigatório**. Só texto, sem
-- bandeiras.
--
-- Guarda o código ISO 3166-1 alpha-2 ('PT', 'BR', 'ES'), nunca o nome do
-- país: o nome muda com o idioma da app, o código não. Mesma escolha que
-- `profiles.language` já faz ao guardar 'pt'/'en'. Os nomes traduzidos vêm
-- do Intl.DisplayNames do navegador (src/lib/countries.js) — daí não ser
-- preciso manter ~250 países × 2 idiomas nos ficheiros de tradução.
--
-- NULLABLE e sem valor por omissão, de propósito: não é obrigatório, e
-- ninguém deve ser assumido português só por ser o mercado inicial.
--
-- O CHECK valida apenas a FORMA (duas maiúsculas), não a lista de países.
-- Validar a lista aqui obrigaria a uma migration sempre que a ISO mudasse,
-- e a lista real vive no cliente, onde é usada.
--
-- Sem alterações a RLS: coluna nova numa tabela cujas políticas já são ao
-- nível da linha. Quem pode ler/escrever o seu próprio perfil continua a
-- poder, e quem podia ver perfis de colegas de clube passa a ver também
-- este campo — que é exactamente a intenção (mostrar o país no perfil).
--
-- Correr este ficheiro todo no Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS nationality TEXT
  CHECK (nationality IS NULL OR nationality ~ '^[A-Z]{2}$');

COMMENT ON COLUMN profiles.nationality IS
  'Nacionalidade escolhida pelo jogador, em ISO 3166-1 alpha-2. NULL = não indicada; o campo é opcional e nunca foi preenchido automaticamente.';
