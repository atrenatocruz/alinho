-- ════════════════════════════════════════════════════════════════════════
-- UM NÚMERO NUMA CONTA SÓ, SEM ESTADO «ASSOCIADO» (decisão Ruben, 1 out)
--
-- Com o OTP por SMS, «associado por verificar» é um estado morto: ou a
-- pessoa provou posse do número ou o número não está na conta. Por isso:
--
--   · profiles.phone_hash passa a ser escrito APENAS na confirmação
--     (apply_phone_confirmation), nunca antes — e o grant de UPDATE da
--     coluna ao cliente é revogado: o único caminho é o OTP. (O registo e
--     a edição de perfil deixam de ter campo de telemóvel na app.)
--   · O pedido de código deixa de ler o número do perfil:
--     start_phone_verification_for_hash(p_hash) recebe o alvo, guarda-o na
--     própria linha de phone_verifications (coluna que já existia para
--     isso) e aplica o mesmo rate-limit de 5/h — e é DENTRO dele, já
--     rate-limitado, que se recusa um número que pertence a outra conta
--     real (phone_taken): sem oráculo ilimitado de «este número está na
--     alinho?».
--   · Na confirmação, o número fica EM EXCLUSIVO: qualquer outra conta
--     real que o tivesse perde-o por completo (hash, verificado e JID).
--     As contas fantasma congeladas (guest-*@whatsapp / sem-conta+*) ficam
--     fora da regra — são a própria pessoa antes de ter conta e o matching
--     do legado precisa do hash; só perdem o «verificado», para o In
--     passar a bater na conta real.
--   · O caminho do robô (confirm_phone_from_whatsapp) continua válido e
--     ganha a mesma semântica: a prova de posse é a mensagem VIR do número
--     da linha de verificação — o perfil não precisa de hash prévio.
--
-- Pré-requisito: migration_otp_sms.sql. Substitui as funções de lá.
-- Correr este ficheiro inteiro no Supabase → SQL Editor. Transação única;
-- re-corrível.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. O cliente deixa de poder escrever phone_hash diretamente ──────────
-- (migration_fix_profiles_column_grants deu UPDATE por coluna; retira-se
-- só esta — o resto do perfil continua editável como antes.)
REVOKE UPDATE (phone_hash) ON profiles FROM authenticated;

-- ── 2. Pedir código para um número (sem tocar no perfil) ────────────────
CREATE OR REPLACE FUNCTION start_phone_verification_for_hash(p_hash TEXT)
RETURNS TABLE (code TEXT, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $f$
DECLARE
  v_code TEXT;
  v_exp  TIMESTAMPTZ := now() + interval '15 minutes';
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sem sessão.';
  END IF;
  IF p_hash IS NULL OR length(p_hash) < 32 THEN
    RAISE EXCEPTION 'invalid_phone';
  END IF;
  -- Nada de pedir códigos sem fim: 5 por hora chegam (regra do #537).
  IF (SELECT count(*) FROM phone_verifications pv
       WHERE pv.user_id = auth.uid() AND pv.created_at > now() - interval '1 hour') >= 5 THEN
    RAISE EXCEPTION 'Pediste muitos códigos. Espera um pouco e tenta outra vez.';
  END IF;
  -- Um número numa conta só: se já pertence (confirmado) a outra conta
  -- REAL, recusa. Depois do rate-limit, de propósito.
  IF EXISTS (
    SELECT 1 FROM profiles p
     WHERE p.phone_hash = p_hash AND p.id <> auth.uid()
       AND p.phone_verified_at IS NOT NULL
       AND p.email NOT LIKE 'guest-%@whatsapp.alinho.pt'
       AND p.email NOT LIKE 'sem-conta+%@invalid.alinho.pt'
  ) THEN
    RAISE EXCEPTION 'phone_taken';
  END IF;
  -- Um código aberto de cada vez: os anteriores deixam de valer.
  UPDATE phone_verifications pv SET expires_at = now()
   WHERE pv.user_id = auth.uid() AND pv.confirmed_at IS NULL AND pv.expires_at > now();

  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
  INSERT INTO phone_verifications (user_id, phone_hash, code, expires_at)
  VALUES (auth.uid(), p_hash, v_code, v_exp);
  RETURN QUERY SELECT v_code, v_exp;
END $f$;

-- Só a edge function chama isto (com o JWT do utilizador, para o
-- auth.uid() e o rate-limit) — mas o código devolvido nunca pode chegar ao
-- browser, por isso o EXECUTE fica para authenticated e a app simplesmente
-- não o chama. (Mesmo modelo do start_phone_verification original.)
REVOKE ALL ON FUNCTION start_phone_verification_for_hash(TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION start_phone_verification_for_hash(TEXT) TO authenticated;

-- ── 3. Confirmar escreve o número (hash) e o verificado de uma vez ──────
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
  -- Posse provada: o número entra na conta AGORA (não havia associação).
  UPDATE profiles SET phone_hash = p_phone_hash, phone_verified_at = now()
   WHERE id = p_user_id;

  -- Em exclusivo: as outras contas reais perdem-no por completo.
  UPDATE profiles
     SET phone_hash = NULL, phone_verified_at = NULL, whatsapp_jid = NULL
   WHERE phone_hash = p_phone_hash AND id <> p_user_id
     AND email NOT LIKE 'guest-%@whatsapp.alinho.pt'
     AND email NOT LIKE 'sem-conta+%@invalid.alinho.pt';

  -- Fantasmas congelados com o mesmo número: mantêm o hash (legado),
  -- perdem o «verificado» — o In passa a bater na conta real.
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

-- ── 4. O utilizador digita o código — o alvo vem da linha, não do perfil ─
CREATE OR REPLACE FUNCTION confirm_phone_with_code(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ver phone_verifications%ROWTYPE;
  v_adotadas INT;
  v_result JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_session');
  END IF;

  SELECT * INTO v_ver FROM phone_verifications
   WHERE user_id = auth.uid() AND confirmed_at IS NULL AND expires_at > now()
   ORDER BY created_at DESC LIMIT 1;
  IF v_ver.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'code');
  END IF;

  IF v_ver.attempts >= 5 THEN
    UPDATE phone_verifications SET expires_at = now() WHERE id = v_ver.id;
    RETURN jsonb_build_object('ok', false, 'reason', 'too_many');
  END IF;
  UPDATE phone_verifications SET attempts = attempts + 1 WHERE id = v_ver.id;

  IF v_ver.code <> trim(p_code) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'code');
  END IF;

  v_adotadas := apply_phone_confirmation(auth.uid(), v_ver.phone_hash);
  v_result := jsonb_build_object('ok', true, 'adopted', v_adotadas, 'via', 'sms');
  UPDATE phone_verifications SET confirmed_at = now(), result = v_result WHERE id = v_ver.id;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION confirm_phone_with_code(TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION confirm_phone_with_code(TEXT) TO authenticated;

-- ── 5. Caminho do robô: a prova é a mensagem VIR do número da linha ──────
CREATE OR REPLACE FUNCTION confirm_phone_from_whatsapp(p_phone_hash TEXT, p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $f$
DECLARE
  v_ver      phone_verifications%ROWTYPE;
  v_nome     TEXT;
  v_adotadas INT;
  v_result   JSONB;
BEGIN
  -- p_phone_hash é o hash do REMETENTE da mensagem privada (verify.js):
  -- se bate com o alvo guardado na linha, a posse está provada.
  SELECT * INTO v_ver FROM phone_verifications
   WHERE phone_hash = p_phone_hash AND code = trim(p_code)
     AND confirmed_at IS NULL AND expires_at > now()
   ORDER BY created_at DESC LIMIT 1;
  IF v_ver.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'code');
  END IF;

  SELECT p.name INTO v_nome FROM profiles p WHERE p.id = v_ver.user_id;
  v_adotadas := apply_phone_confirmation(v_ver.user_id, p_phone_hash);

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
-- SELECT to_regprocedure('start_phone_verification_for_hash(text)'); -- não-nulo
-- Com uma 2.ª conta, pedir código para um número já confirmado na 1.ª
-- → o SMS não sai e a app mostra «já está noutra conta» (phone_taken);
-- confirmar na conta certa limpa o número de qualquer outra conta real.
