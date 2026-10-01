-- ════════════════════════════════════════════════════════════════════════
-- CONFIRMAÇÃO DO NÚMERO POR SMS (decisão Ruben, 1 out 2026)
--
-- O fluxo invertido do #537 («manda TU o código ao robô numa privada») é
-- estranho para utilizadores normais e depende do robô estar vivo. Passa a
-- OTP clássico: a app envia-te um SMS com o código (edge function
-- send-otp, Twilio) e tu escreve-lo na app. O phone_hash e todo o matching
-- ficam exatamente como estavam — só muda como se prova a posse do número.
--
-- Peças:
--   · phone_verifications/start_phone_verification (#537): reutilizados
--     tal-e-qual — geração do código, validade 15 min, limite 5/h. A edge
--     function chama start_phone_verification COM O JWT do utilizador e
--     envia o código por SMS; o código nunca passa pelo browser.
--   · apply_phone_confirmation (novo, interno): o efeito de confirmar —
--     marcar verificado, «um número confirmado numa conta só», e a adoção
--     das inscrições-convidado em jogos abertos. Partilhado pelos dois
--     caminhos.
--   · confirm_phone_with_code (novo, authenticated): o utilizador digita o
--     código na app. Com travão de tentativas (5 por pedido) — sem ele,
--     1M combinações em 15 min davam para «confirmar» um número alheio.
--   · confirm_phone_from_whatsapp: reescrita a usar o helper; o caminho do
--     robô continua a funcionar como alternativa (e é o único que não
--     custa SMS).
--
-- Antes de usar: configurar na edge function send-otp os secrets
-- TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (e PHONE_HASH_SECRET,
-- o mesmo do hash-phone), por ambiente.
--
-- Correr este ficheiro inteiro no Supabase → SQL Editor (depois de
-- migration_mix_guest_sem_conta.sql). Transação única; re-corrível.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Travão de tentativas no código ────────────────────────────────────
ALTER TABLE phone_verifications ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;

-- ── 2. O efeito de confirmar, num sítio só ───────────────────────────────
-- Devolve quantas inscrições-convidado foram adotadas. NUNCA lança: a
-- adoção degrada para WARNING (confirmar o número não pode falhar por
-- causa de uma inscrição).
CREATE OR REPLACE FUNCTION apply_phone_confirmation(p_user_id UUID, p_phone_hash TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_adotadas INT := 0;
  n INT;
BEGIN
  UPDATE profiles SET phone_verified_at = now() WHERE id = p_user_id;
  -- Um número confirmado numa conta só: a última a confirmar fica com ele.
  UPDATE profiles SET phone_verified_at = NULL
   WHERE phone_hash = p_phone_hash AND id <> p_user_id AND phone_verified_at IS NOT NULL;

  -- Adoção (jogos abertos/fechados, ainda sem sorteio): a linha-convidado
  -- com este número passa a ser desta conta (migration_mix_guest_sem_conta).
  BEGIN
    UPDATE participants p SET user_id = p_user_id, guest_id = NULL
      FROM game_guests gg JOIN games g ON g.id = gg.game_id
     WHERE gg.id = p.guest_id AND gg.phone_hash = p_phone_hash
       AND g.status IN ('open', 'closed')
       AND NOT EXISTS (SELECT 1 FROM participants q
                        WHERE q.game_id = p.game_id
                          AND (q.user_id = p_user_id OR q.partner_id = p_user_id));
    GET DIAGNOSTICS n = ROW_COUNT;
    v_adotadas := v_adotadas + n;

    UPDATE participants p SET partner_id = p_user_id, partner_guest_id = NULL
      FROM game_guests gg JOIN games g ON g.id = gg.game_id
     WHERE gg.id = p.partner_guest_id AND gg.phone_hash = p_phone_hash
       AND g.status IN ('open', 'closed')
       AND p.user_id IS DISTINCT FROM p_user_id
       AND NOT EXISTS (SELECT 1 FROM participants q
                        WHERE q.game_id = p.game_id
                          AND (q.user_id = p_user_id OR q.partner_id = p_user_id));
    GET DIAGNOSTICS n = ROW_COUNT;
    v_adotadas := v_adotadas + n;

    DELETE FROM game_guests gg
     WHERE gg.phone_hash = p_phone_hash
       AND NOT EXISTS (SELECT 1 FROM participants p
                        WHERE p.guest_id = gg.id OR p.partner_guest_id = gg.id)
       AND NOT EXISTS (SELECT 1 FROM teams t
                        WHERE t.player1_guest_id = gg.id OR t.player2_guest_id = gg.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'adoção de inscrições-guest falhou para %: %', p_user_id, SQLERRM;
  END;

  RETURN v_adotadas;
END;
$$;
REVOKE ALL ON FUNCTION apply_phone_confirmation(UUID, TEXT) FROM public, anon, authenticated;

-- ── 3. O utilizador digita o código na app ───────────────────────────────
CREATE OR REPLACE FUNCTION confirm_phone_with_code(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ver phone_verifications%ROWTYPE;
  v_hash TEXT;
  v_adotadas INT;
  v_result JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_session');
  END IF;

  -- O pedido mais recente ainda válido DESTE utilizador (o código compara-se
  -- depois — assim as tentativas erradas também contam e gastam o travão).
  SELECT * INTO v_ver FROM phone_verifications
   WHERE user_id = auth.uid() AND confirmed_at IS NULL AND expires_at > now()
   ORDER BY created_at DESC LIMIT 1;
  IF v_ver.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'code');
  END IF;

  IF v_ver.attempts >= 5 THEN
    -- Queima o pedido: só com um código novo (e novo SMS) se tenta outra vez.
    UPDATE phone_verifications SET expires_at = now() WHERE id = v_ver.id;
    RETURN jsonb_build_object('ok', false, 'reason', 'too_many');
  END IF;
  UPDATE phone_verifications SET attempts = attempts + 1 WHERE id = v_ver.id;

  IF v_ver.code <> trim(p_code) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'code');
  END IF;

  -- O telemóvel do perfil mudou depois de pedir o código: não vale.
  SELECT p.phone_hash INTO v_hash FROM profiles p WHERE p.id = auth.uid();
  IF v_hash IS DISTINCT FROM v_ver.phone_hash THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'phone_changed');
  END IF;

  v_adotadas := apply_phone_confirmation(auth.uid(), v_hash);
  v_result := jsonb_build_object('ok', true, 'adopted', v_adotadas, 'via', 'sms');
  UPDATE phone_verifications SET confirmed_at = now(), result = v_result WHERE id = v_ver.id;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION confirm_phone_with_code(TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION confirm_phone_with_code(TEXT) TO authenticated;

-- ── 4. O caminho do robô passa a usar o mesmo helper ─────────────────────
-- Igual à versão de migration_mix_guest_sem_conta.sql, com o bloco de
-- confirmar+adotar substituído pelo apply_phone_confirmation.
CREATE OR REPLACE FUNCTION confirm_phone_from_whatsapp(p_phone_hash TEXT, p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $f$
DECLARE
  v_ver      phone_verifications%ROWTYPE;
  v_nome     TEXT;
  v_hash     TEXT;
  v_adotadas INT;
  v_result   JSONB;
BEGIN
  SELECT * INTO v_ver FROM phone_verifications
   WHERE phone_hash = p_phone_hash AND code = trim(p_code)
     AND confirmed_at IS NULL AND expires_at > now()
   ORDER BY created_at DESC LIMIT 1;
  IF v_ver.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'code');
  END IF;

  SELECT p.name, p.phone_hash INTO v_nome, v_hash FROM profiles p WHERE p.id = v_ver.user_id;
  IF v_hash IS DISTINCT FROM p_phone_hash THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'phone_changed');
  END IF;

  v_adotadas := apply_phone_confirmation(v_ver.user_id, p_phone_hash);

  -- 'merged'/'failed' mantêm-se no retorno (sempre vazios) para o bot no
  -- ar não partir; o bot novo lê 'adopted'.
  v_result := jsonb_build_object('ok', true, 'name', v_nome,
                                 'merged', 0, 'failed', '[]'::jsonb,
                                 'adopted', v_adotadas, 'via', 'whatsapp');
  UPDATE phone_verifications SET confirmed_at = now(), result = v_result WHERE id = v_ver.id;
  RETURN v_result;
END $f$;

REVOKE ALL ON FUNCTION confirm_phone_from_whatsapp(TEXT, TEXT) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION confirm_phone_from_whatsapp(TEXT, TEXT) TO service_role;

COMMIT;

-- ── Verificação pós-migração ─────────────────────────────────────────────
-- SELECT to_regprocedure('confirm_phone_with_code(text)');       -- não-nulo
-- SELECT to_regprocedure('apply_phone_confirmation(uuid,text)'); -- não-nulo
-- SELECT count(*) FROM information_schema.columns
--  WHERE table_name = 'phone_verifications' AND column_name = 'attempts'; -- 1
