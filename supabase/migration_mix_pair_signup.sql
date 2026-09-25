-- ═════════════════════════════════════════════════════════════════════════
-- MIX: «INSCRIÇÃO EM DUPLA» SIM/NÃO
-- (Renato, 24 set 2026) — pedido para os mixes do A2N.
--
-- Pode-se correr outra vez sem estragar.
--
-- O QUE MUDA
--   · `games.allow_pair_signup` e `game_recurrences.allow_pair_signup`,
--     BOOLEAN, por omissão FALSE. **Todos os mixes que já existem ficam com
--     «Não»** (decisão do Renato): o «Entrar com parceiro» da app e o «In com
--     …» do bot só aparecem/funcionam nos mixes criados ou editados com «Sim».
--     As duplas que já estão inscritas ficam como estão.
--   · Os mixes que a recorrência cria sozinha (`process_due_game_recurrences`)
--     herdam a escolha do modelo — lê o corpo VIVO e junta a coluna ao lado
--     de `rotate_partners`, como o #521; recusa se não encontrar a forma.
--   · Um trigger em `participants` recusa uma inscrição COM parceiro num mix
--     com «Não» (`pair_signup_disabled`) — quem chama a API diretamente
--     também não passa. Ficam de fora: admins do clube (inscrevem duplas à
--     mão no Gerir) e chamadas sem sessão (o bot e as edge functions, que
--     usam a service-role; o bot verifica a coluna no código).
--
-- Correr este ficheiro inteiro no Supabase → SQL Editor.
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE games ADD COLUMN IF NOT EXISTS allow_pair_signup BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE game_recurrences ADD COLUMN IF NOT EXISTS allow_pair_signup BOOLEAN NOT NULL DEFAULT FALSE;


-- ── 1. Os mixes da recorrência herdam a escolha ──────────────────────────
DO $$
DECLARE
  f      RECORD;
  v_def  TEXT;
  v_novo TEXT;
BEGIN
  FOR f IN SELECT p.oid, p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'process_due_game_recurrences' LOOP
    IF position('allow_pair_signup' IN f.prosrc) > 0 THEN
      RAISE NOTICE 'process_due_game_recurrences: já passava a allow_pair_signup.';
      CONTINUE;
    END IF;
    -- Uma vez na lista de colunas, uma vez nos VALUES — nem mais nem menos.
    IF (length(f.prosrc) - length(replace(f.prosrc, 'rec.rotate_partners,', ''))) / length('rec.rotate_partners,') <> 1
       OR (length(f.prosrc) - length(replace(f.prosrc, 'rotate_partners,', ''))) / length('rotate_partners,') <> 2 THEN
      RAISE EXCEPTION 'process_due_game_recurrences não tem a forma esperada (rotate_partners na lista e nos VALUES). Ler o corpo vivo antes de correr isto.';
    END IF;
    v_def  := pg_get_functiondef(f.oid);
    v_novo := replace(v_def, 'rec.rotate_partners,', '§REC§');
    v_novo := replace(v_novo, 'rotate_partners,', 'rotate_partners, allow_pair_signup,');
    v_novo := replace(v_novo, '§REC§', 'rec.rotate_partners, rec.allow_pair_signup,');
    EXECUTE v_novo;
    RAISE NOTICE 'Corrigida: process_due_game_recurrences';
  END LOOP;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Não existe process_due_game_recurrences. Parar e ler.';
  END IF;
END $$;


-- ── 2. Sem «Sim», não se entra em dupla ──────────────────────────────────
CREATE OR REPLACE FUNCTION participants_pair_signup_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_allow BOOLEAN;
  v_org   UUID;
BEGIN
  IF NEW.partner_id IS NULL OR (TG_OP = 'UPDATE' AND OLD.partner_id IS NOT NULL) THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  SELECT allow_pair_signup, organization_id INTO v_allow, v_org FROM games WHERE id = NEW.game_id;
  IF NOT COALESCE(v_allow, FALSE) AND NOT is_org_admin(v_org) THEN
    RAISE EXCEPTION 'pair_signup_disabled';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION participants_pair_signup_guard() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS participants_pair_signup_guard ON participants;
CREATE TRIGGER participants_pair_signup_guard
  BEFORE INSERT OR UPDATE OF partner_id ON participants
  FOR EACH ROW EXECUTE FUNCTION participants_pair_signup_guard();


-- ═════════════════════════════════════════════════════════════════════════
-- PARA VER DEPOIS (só leitura)
-- ═════════════════════════════════════════════════════════════════════════
--   SELECT count(*) FILTER (WHERE allow_pair_signup) AS com_duplas, count(*) FROM games;
--   SELECT prosrc LIKE '%rec.allow_pair_signup%' FROM pg_proc WHERE proname = 'process_due_game_recurrences';
