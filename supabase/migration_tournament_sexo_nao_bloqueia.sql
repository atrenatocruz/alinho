-- ═════════════════════════════════════════════════════════════════════════
-- Torneios: o sexo deixa de bloquear inscrições. Decisão do Francisco,
-- 26 set, 02h (via PO; plano aprovado por ele no mesmo dia): «o sexo nunca
-- bloqueia, nem nos mixes nem nos torneios. O admin tira a pessoa se vir
-- que não é para ali. A app só pergunta "tens a certeza?"». O ecrã continua
-- a pedir o sexo, com «Agora não».
--
-- ⚖️ Desfaz regras do Renato (#19, #433, #493). Avança por decisão do
-- Francisco, como o Renato pediu («se eu disser para avançar, podes
-- avançar»). Aviso no #dev-updates.
--
-- O que muda (corpo vivo de cada função; troca só o fragmento):
--   1. tournament_signup — deixa de recusar quem não tem sexo no perfil
--      (gender_required, #433).
--   2. tournament_admin_signup — deixa de recusar o jogador 1 e o parceiro
--      sem sexo quando o organizador não o escolhe (player1_gender_required,
--      partner_gender_required). Se o organizador o escolher, continua a ir
--      para o perfil (regra de hoje; #495 à espera do Renato).
--   3. tournament_admin_set_partner (#515) — o mesmo para o parceiro.
--   4. tournament_entries_guard — a regra #19 (o sexo da dupla tem de bater
--      com a categoria: masculinos, femininos, mistos) deixa de recusar
--      (gender_mismatch). Tira-se o bloco inteiro.
-- A tournament_admin_replace_player (#434) ainda não correu: o ficheiro
-- dela já foi acertado da mesma maneira.
--
-- Cada troca recusa se não encontrar o fragmento exatamente uma vez, e diz
-- «já estava» quando o erro já não existe na função. Mesmas assinaturas: as
-- permissões ficam; repõem-se explicitamente (REVOKE de PUBLIC e anon; GRANT
-- a authenticated nas RPC; o guard é só do trigger).
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  -- nome da função · erro que deixa de existir · fragmento · o que fica
  c_trocas CONSTANT TEXT[][] := ARRAY[
    ARRAY['tournament_signup', 'gender_required',
          'IF NOT EXISTS \(SELECT 1 FROM profiles WHERE id = v_me AND gender IS NOT NULL AND gender <> ''''\) THEN\s+RAISE EXCEPTION ''gender_required'';\s+END IF;',
          '-- O sexo já não bloqueia a inscrição (Francisco, 26 set): o ecrã pergunta.'],
    ARRAY['tournament_admin_signup', 'player1_gender_required',
          '\s+ELSE\s+RAISE EXCEPTION ''player1_gender_required'';',
          ''],
    ARRAY['tournament_admin_signup', 'partner_gender_required',
          '\s+ELSE\s+RAISE EXCEPTION ''partner_gender_required'';',
          ''],
    ARRAY['tournament_admin_set_partner', 'partner_gender_required',
          '\s+ELSE\s+RAISE EXCEPTION ''partner_gender_required'';',
          ''],
    ARRAY['tournament_entries_guard', 'gender_mismatch',
          'IF NEW\.status <> ''desistiu'' AND v_gender IN .*?RAISE EXCEPTION ''gender_mismatch'';\s+END IF;\s+END IF;',
          '-- #19: o sexo da dupla já não bloqueia (Francisco, 26 set: o admin tira quem não for para ali).']
  ];
  i     INTEGER;
  f     RECORD;
  v_def TEXT;
  v_n   INTEGER;
  v_vistas INTEGER;
BEGIN
  FOR i IN 1 .. array_length(c_trocas, 1) LOOP
    v_vistas := 0;
    FOR f IN SELECT p.oid, pg_get_function_identity_arguments(p.oid) AS args
               FROM pg_proc p
              WHERE p.pronamespace = 'public'::regnamespace AND p.proname = c_trocas[i][1] LOOP
      v_vistas := v_vistas + 1;
      v_def := pg_get_functiondef(f.oid);
      IF position('''' || c_trocas[i][2] || '''' IN v_def) = 0 THEN
        RAISE NOTICE '%(%): o % já não existia.', c_trocas[i][1], f.args, c_trocas[i][2];
        CONTINUE;
      END IF;
      v_n := (SELECT count(*) FROM regexp_matches(v_def, c_trocas[i][3], 'g'));
      IF v_n <> 1 THEN
        RAISE EXCEPTION '%(%): o fragmento do % aparece % vezes (esperava 1). Ler o corpo vivo.',
          c_trocas[i][1], f.args, c_trocas[i][2], v_n;
      END IF;
      EXECUTE regexp_replace(v_def, c_trocas[i][3], c_trocas[i][4]);
      IF position('''' || c_trocas[i][2] || '''' IN pg_get_functiondef(f.oid)) > 0 THEN
        RAISE EXCEPTION '%(%): o % não saiu. Parar e ler.', c_trocas[i][1], f.args, c_trocas[i][2];
      END IF;
      RAISE NOTICE '%(%): o % já não bloqueia.', c_trocas[i][1], f.args, c_trocas[i][2];
    END LOOP;
    IF v_vistas = 0 THEN
      RAISE EXCEPTION 'Não existe %. Parar e ler.', c_trocas[i][1];
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE f RECORD;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig, p.proname FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('tournament_signup', 'tournament_admin_signup',
                                'tournament_admin_set_partner', 'tournament_entries_guard') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f.sig);
    IF f.proname = 'tournament_entries_guard' THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', f.sig);   -- só o trigger a chama
    ELSE
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
    END IF;
  END LOOP;
END $$;
