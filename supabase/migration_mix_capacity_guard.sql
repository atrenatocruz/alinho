-- ═════════════════════════════════════════════════════════════════════════
-- MIX: NINGUÉM ENTRA ACIMA DAS VAGAS, MESMO AO MESMO TEMPO
-- (Renato, 24 set 2026). Pode-se correr outra vez sem estragar.
--
-- A falha: a app e o bot fazem «conto as vagas → há lugar → inscrevo». Dois
-- «In» (ou um «In» e um «Entrar» na app) na última vaga contam os dois 7/8
-- e inscrevem os dois → 9/8. O `check_game_full` só FECHA o mix depois.
--
-- A regra: antes de uma inscrição confirmada, tranca-se a linha do mix
-- (FOR UPDATE — quem vier a seguir espera) e volta-se a contar. Não cabe →
-- `game_full`. A app mostra «o mix acabou de encher»; o bot oferece suplente.
--
-- Fica de fora: a promoção de suplentes (corre dentro de outro trigger —
-- ver pg_trigger_depth), inscrições que encolhem, admins do clube (inscrever acima das vagas no Gerir é uma
-- decisão deles), mixes que já não estão `open`/`closed`, suplentes
-- (`waitlisted` não ocupa vaga). O bot NÃO fica de fora (usa service-role,
-- auth.uid() nulo) — é precisamente um dos lados da corrida.
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION participants_capacity_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cap    INTEGER;
  v_status TEXT;
  v_org    UUID;
  v_taken  INTEGER;
  -- 1 sozinho, 2 em dupla. Numa variável: num IF do plpgsql a expressão
  -- acaba no primeiro THEN, e o do CASE cortava-a a meio.
  v_size   INTEGER := CASE WHEN NEW.partner_id IS NOT NULL THEN 2 ELSE 1 END;
BEGIN
  IF NEW.status <> 'confirmed' THEN RETURN NEW; END IF;
  -- Já confirmada e não cresce (mesmo parceiro, troca de parceiro, ou tirar
  -- o parceiro — o apagar-conta faz isto): não ocupa mais nada. Só se conta
  -- quando uma inscrição passa a confirmada ou ganha um parceiro.
  IF TG_OP = 'UPDATE' AND OLD.status = 'confirmed'
     AND NOT (OLD.partner_id IS NULL AND NEW.partner_id IS NOT NULL) THEN
    RETURN NEW;
  END IF;
  -- Chamado de dentro de OUTRO trigger — é a promoção de suplentes
  -- (promote_waitlist, ao sair alguém ou ao aumentar os campos). Essa segue
  -- as regras dela, como sempre: se o 1.º suplente for uma dupla e só houver
  -- uma vaga, passa das vagas. Travá-la aqui desfazia a SAÍDA de quem saiu
  -- (revisão final, 24 set) — ninguém conseguia sair desse mix.
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;

  SELECT COALESCE(max_players, num_courts * 4), status, organization_id
    INTO v_cap, v_status, v_org
    FROM games WHERE id = NEW.game_id FOR UPDATE;
  IF v_status NOT IN ('open', 'closed') THEN RETURN NEW; END IF;
  IF auth.uid() IS NOT NULL AND is_org_admin(v_org) THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(1 + CASE WHEN partner_id IS NOT NULL THEN 1 ELSE 0 END), 0)
    INTO v_taken
    FROM participants
   WHERE game_id = NEW.game_id AND status = 'confirmed' AND id <> NEW.id;
  IF v_taken + v_size > v_cap THEN
    RAISE EXCEPTION 'game_full';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION participants_capacity_guard() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS participants_capacity_guard ON participants;
CREATE TRIGGER participants_capacity_guard
  BEFORE INSERT OR UPDATE OF status, partner_id ON participants
  FOR EACH ROW EXECUTE FUNCTION participants_capacity_guard();

-- PARA VER DEPOIS (só leitura): mixes abertos que JÁ estão acima das vagas
-- (o trigger não os mexe — só recusa daqui para a frente):
--   SELECT g.id, g.title, COALESCE(g.max_players, g.num_courts * 4) AS cap,
--          SUM(1 + CASE WHEN p.partner_id IS NOT NULL THEN 1 ELSE 0 END) AS ocupados
--     FROM games g JOIN participants p ON p.game_id = g.id AND p.status = 'confirmed'
--    WHERE g.status IN ('open', 'closed')
--    GROUP BY g.id HAVING SUM(1 + CASE WHEN p.partner_id IS NOT NULL THEN 1 ELSE 0 END) > COALESCE(g.max_players, g.num_courts * 4);
