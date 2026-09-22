-- Privacidade por defeito: "clubes" e "atividade" passam a "amigos"
-- Decisão do Francisco, 22 set 2026 (cartão #318). Os números (jogos, kudos,
-- XP) ficam públicos, como já estava proposto — só ONDE e QUANDO alguém
-- joga é que passa a exigir amizade mútua (is_mutual_follow).
--
-- A parte de imposição já existe e está viva: get_player_profile e
-- get_player_match_history já chamam can_view_section(...), que já trata
-- 'friends' como amigo mútuo. Esta migração só muda o valor por omissão —
-- não muda nenhuma função.
--
-- Esta migração faz as duas coisas: muda o valor de fábrica das CONTAS
-- NOVAS (a partir de agora, incluindo as do Smash Cup) e atualiza as 98
-- contas que já existem e nunca mexeram nisto (estavam nos 3 campos a
-- 'public' — nenhuma tinha escolhido isso de propósito, é só o valor de
-- fábrica antigo). O único perfil que já tinha escolhido 'private' por
-- sua conta não é tocado (a condição WHERE exige os 3 campos em 'public').
--
-- Confirmado a 22 set: 98 de 99 perfis nos 3 campos a 'public'; 1 já
-- 'private' nos 3. Depois desta migração, confirmar:
--   SELECT activity_visibility, clubs_visibility, count(*) FROM profiles GROUP BY 1,2;
-- Esperado: 98 em 'friends'/'friends', 1 em 'private'/'private'.

ALTER TABLE profiles ALTER COLUMN activity_visibility SET DEFAULT 'friends';
ALTER TABLE profiles ALTER COLUMN clubs_visibility SET DEFAULT 'friends';
-- results_visibility fica como estava (default 'public') — decisão do Francisco.

UPDATE profiles
SET activity_visibility = 'friends', clubs_visibility = 'friends'
WHERE activity_visibility = 'public' AND clubs_visibility = 'public' AND results_visibility = 'public';
