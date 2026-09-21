-- ════════════════════════════════════════════════════════════════════════
-- URGENTE: desbloquear a criação de conta em produção — "Nível inválido".
--
-- O ecrã "Escolher Nível" foi para o main a 19 set (commit 30cca17, Trello
-- #288) e passou a enviar as chaves n1…n6/iniciante, mas em produção a
-- função complete_rating_onboarding só aceita iniciado/regular/avancado.
-- Quem cria conta agora leva "Nível inválido" e fica preso no ecrã: sem
-- rating_onboarded_at, a app volta a mostrar o mesmo ecrã a cada entrada.
-- A 21 set havia 1 conta presa; as outras 4 desde o deploy escaparam por
-- terem a app antiga em cache (âncoras 900/1100). À medida que a cache
-- expira, passa a apanhar toda a gente.
--
-- Este ficheiro é SÓ o bloco 2 de migration_elo_entry_levels.sql, copiado
-- sem alterações. NÃO traz as mudanças de cálculo do Elo desse ficheiro
-- (apply_elo_pairing, elo_k_factor), que continuam à espera do parecer do
-- Renato e do Ruben no cartão #288. Correr este ficheiro não condiciona
-- essa decisão: se depois correrem o #288 inteiro, esta função é
-- substituída por uma igual.
--
-- Efeito: contas já classificadas não mudam (a função só toca em
-- rating_onboarded_at nulo). Quem está preso escolhe o nível outra vez e
-- entra. É seguro re-correr.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- ── 2. Entrada do nível 1 a Iniciante ─────────────────────────────────────
CREATE OR REPLACE FUNCTION complete_rating_onboarding(p_level TEXT)
RETURNS void AS $$
DECLARE
  v_anchor INTEGER;
BEGIN
  v_anchor := CASE p_level
    WHEN 'n1' THEN 1900
    WHEN 'n2' THEN 1700
    WHEN 'n3' THEN 1500
    WHEN 'n4' THEN 1300
    WHEN 'n5' THEN 1100
    WHEN 'n6' THEN 850
    WHEN 'iniciante' THEN 600
    -- chaves antigas (app em cache), valores antigos
    WHEN 'iniciado' THEN 700
    WHEN 'regular'  THEN 900
    WHEN 'avancado' THEN 1100
  END;
  IF v_anchor IS NULL THEN
    RAISE EXCEPTION 'Nível inválido';
  END IF;

  -- Só contas ainda não classificadas: quem já está não muda. Mantém os
  -- deltas de jogos feitos antes de escolher o nível (baseline 900).
  UPDATE profiles
  SET rating = GREATEST(0, v_anchor + (COALESCE(rating, 900) - 900)),
      rating_anchor = v_anchor,
      rating_onboarded_at = NOW()
  WHERE id = auth.uid() AND rating_onboarded_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION complete_rating_onboarding(TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION complete_rating_onboarding(TEXT) TO authenticated;

-- ── Verificação (deve devolver 0 linhas, ou seja, ninguém preso): ────────
-- SELECT count(*) FROM profiles WHERE rating_onboarded_at IS NULL;
