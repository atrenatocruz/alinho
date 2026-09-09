-- ════════════════════════════════════════════════════════════════════════
-- Migration: nacionalidade e género no perfil de outro jogador — Trello
-- #191 / #202.
--
-- O Francisco: "é importante saber qual a nacionalidade da pessoa que
-- estamos a ver" e "é preciso mostrar no perfil se é feminino ou
-- masculino".
--
-- PORQUÊ UMA FUNÇÃO NOVA E NÃO ESTENDER get_player_profile
-- `get_player_profile` tem SETE definições espalhadas por migrations
-- (club_scoped_groups, comunidade_unified, friend_requests,
-- player_profile_details, player_profile_preferred_side, profile_privacy,
-- unified_player_profile) e daqui não é possível saber qual está viva na
-- base de dados. Recriá-la às cegas arriscava partir a página de perfil de
-- todos os jogadores.
--
-- Não é invenção minha: é o mesmo caminho que `get_player_xp` e
-- `get_player_trophies` já seguiram, e está lá escrito o motivo em
-- PlayerDetails.jsx — "RPC dedicado em vez de estender get_player_profile
-- (7 versões no repo)".
--
-- PRIVACIDADE
-- O género já é efectivamente público: aparece no badge M6/F6 em rankings,
-- mixes e listas de jogadores. Esta função não alarga isso, só o torna
-- legível no sítio onde faz falta.
-- A nacionalidade é uma exposição nova, e deliberada — foi pedida
-- explicitamente para o perfil de outro jogador. É um campo opcional que a
-- pessoa escolheu preencher; quem não o preencher devolve NULL e a app não
-- mostra nada.
-- Restrito a `authenticated`: ninguém sem sessão lê isto.
--
-- Correr este ficheiro todo no Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_player_public_extras(p_user_id UUID)
RETURNS TABLE (nationality TEXT, gender TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT p.nationality, p.gender
  FROM profiles p
  WHERE p.id = p_user_id;
$$;

REVOKE ALL ON FUNCTION get_player_public_extras(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION get_player_public_extras(UUID) TO authenticated;
