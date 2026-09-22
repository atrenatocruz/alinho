-- ════════════════════════════════════════════════════════════════════════
-- TORNEIOS, PARTE 4: AVISOS DO ORGANIZADOR  (Dev 3, 22 set 2026)
-- Cartão #366, «Torneio 6/6». Os ecrãs são do Dev 2; isto é o lado da
-- base de dados, combinado com ele (nomes e parâmetros são os que os
-- ecrãs dele já chamam).
--
-- CORRER DEPOIS de `migration_tournaments_base.sql` (é essa que cria a
-- tabela `tournament_notices`). Pode-se correr outra vez sem estragar.
--
-- O QUE ISTO É: o organizador escreve, toda a gente lê. UM PARA MUITOS.
-- Ninguém responde — não há tabela de respostas nem sítio para ela crescer,
-- e é de propósito: sem respostas não é preciso moderar, bloquear nem
-- denunciar. O chat do evento é outro cartão e nasce depois.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Fim opcional ─────────────────────────────────────────────────────
-- «M4 atrasado 20 minutos» ou «campo 3 molhado, a secar» deixam de fazer
-- sentido ao fim de uma hora. Com fim marcado, o aviso deixa de aparecer
-- em cima — mas não se apaga: os antigos ficam acessíveis (cartão #366).
ALTER TABLE tournament_notices
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  -- Um aviso é o sítio onde a informação muda à pressa: «campo 3 molhado»
  -- vira «campo 3 pronto». Guardar quando foi mudado deixa o ecrã dizer
  -- «editado» a quem já o tinha lido — mostrar ou não é decisão do
  -- Francisco, mas se não se guardar agora não se pode mostrar depois.
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS edited_by  UUID REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS tournament_notices_recent_idx
  ON tournament_notices(tournament_id, created_at DESC);

-- A vista pública passa a dizer até quando o aviso vale, e quem o escreveu.
-- Abre sem conta, como o resto da página do torneio.
CREATE OR REPLACE VIEW tournament_public_notices AS
  SELECT n.id, n.tournament_id, n.body, n.created_at, p.name AS author_name,
         n.expires_at, n.updated_at
  FROM tournament_notices n
  JOIN tournament_public t ON t.id = n.tournament_id
  LEFT JOIN profiles p ON p.id = n.author_id;

GRANT SELECT ON tournament_public_notices TO anon, authenticated;

-- ── 2. Publicar ─────────────────────────────────────────────────────────
-- 280 caracteres, como o desenho pede: um aviso lê-se de relance, no meio
-- de um torneio, com o telemóvel numa mão. O ecrã já corta; quem manda é
-- esta função, porque o ecrã pode ser contornado.
CREATE OR REPLACE FUNCTION publish_tournament_notice(
  p_tournament_id UUID,
  p_body TEXT,
  p_also_whatsapp BOOLEAN DEFAULT FALSE,
  p_expires_at TIMESTAMPTZ DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_body TEXT := NULLIF(trim(COALESCE(p_body, '')), '');
  v_id   UUID;
BEGIN
  IF NOT is_tournament_admin(p_tournament_id) THEN
    RAISE EXCEPTION 'Só a organização do torneio pode escrever avisos'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'O aviso não pode ficar vazio';
  END IF;
  IF length(v_body) > 280 THEN
    RAISE EXCEPTION 'O aviso não pode ter mais de 280 caracteres';
  END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at <= NOW() THEN
    RAISE EXCEPTION 'O fim do aviso já passou';
  END IF;

  INSERT INTO tournament_notices (tournament_id, body, author_id, also_whatsapp, expires_at)
  VALUES (p_tournament_id, v_body, auth.uid(), COALESCE(p_also_whatsapp, FALSE), p_expires_at)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ── 3. Editar ───────────────────────────────────────────────────────────
-- Corrigir o que se escreveu à pressa. O `also_whatsapp` não se edita: a
-- mensagem do WhatsApp ou já saiu ou não saiu, e mudar a caixa aqui não a
-- ia buscar atrás.
--
-- ATENÇÃO ao `p_expires_at`: mandá-lo a vazio quer dizer «deixa o fim como
-- está», NÃO «tira o fim». Sem isto, editar um aviso só para corrigir uma
-- gralha apagava o fim que ele tinha: um «campo 3 molhado» que era para
-- desaparecer às 15h ficava para sempre. Para tirar mesmo o fim, manda-se
-- `p_clear_expiry := true`.
CREATE OR REPLACE FUNCTION update_tournament_notice(
  p_notice_id UUID,
  p_body TEXT,
  p_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_clear_expiry BOOLEAN DEFAULT FALSE)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tournament UUID;
  v_expires    TIMESTAMPTZ;
  v_body TEXT := NULLIF(trim(COALESCE(p_body, '')), '');
BEGIN
  SELECT tournament_id, expires_at INTO v_tournament, v_expires
    FROM tournament_notices WHERE id = p_notice_id;
  IF v_tournament IS NULL THEN
    RAISE EXCEPTION 'Aviso não encontrado';
  END IF;
  IF NOT is_tournament_admin(v_tournament) THEN
    RAISE EXCEPTION 'Só a organização do torneio pode mudar os avisos'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'O aviso não pode ficar vazio';
  END IF;
  IF length(v_body) > 280 THEN
    RAISE EXCEPTION 'O aviso não pode ter mais de 280 caracteres';
  END IF;
  -- A mesma regra do publicar: as duas funções têm de dizer o mesmo, senão
  -- o ecrã tem de repetir a regra num sítio e não no outro.
  --
  -- Mas só quando o fim está mesmo a MUDAR para uma data passada. Um
  -- formulário reenvia sozinho o que já tem preenchido: sem esta condição,
  -- um aviso cujo fim já passou deixava de se poder corrigir — nem o texto,
  -- nem para lhe tirar o fim. O admin ficava fechado fora do próprio aviso.
  IF NOT COALESCE(p_clear_expiry, FALSE)
     AND p_expires_at IS NOT NULL
     AND p_expires_at <= NOW()
     AND p_expires_at IS DISTINCT FROM v_expires THEN
    RAISE EXCEPTION 'O fim do aviso já passou';
  END IF;

  UPDATE tournament_notices
     SET body = v_body,
         expires_at = CASE WHEN p_clear_expiry THEN NULL
                           WHEN p_expires_at IS NOT NULL THEN p_expires_at
                           ELSE expires_at END,
         updated_at = NOW(),
         edited_by = auth.uid()
   WHERE id = p_notice_id;
END;
$$;

-- ── 4. Apagar ───────────────────────────────────────────────────────────
-- Um aviso não tem respostas nem histórico de ninguém agarrado a ele, por
-- isso apaga-se mesmo — ao contrário de um jogo com resultados.
CREATE OR REPLACE FUNCTION delete_tournament_notice(p_notice_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_tournament UUID;
BEGIN
  SELECT tournament_id INTO v_tournament FROM tournament_notices WHERE id = p_notice_id;
  IF v_tournament IS NULL THEN
    RAISE EXCEPTION 'Aviso não encontrado';
  END IF;
  IF NOT is_tournament_admin(v_tournament) THEN
    RAISE EXCEPTION 'Só a organização do torneio pode apagar avisos'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  DELETE FROM tournament_notices WHERE id = p_notice_id;
END;
$$;

-- ── 5. Quem pode chamar o quê ───────────────────────────────────────────
-- Ler é de toda a gente, pela vista, com ou sem conta. Escrever é só da
-- organização, e quem verifica isso é a função, não o ecrã.
REVOKE ALL ON FUNCTION publish_tournament_notice(UUID, TEXT, BOOLEAN, TIMESTAMPTZ) FROM public, anon;
REVOKE ALL ON FUNCTION update_tournament_notice(UUID, TEXT, TIMESTAMPTZ, BOOLEAN) FROM public, anon;
-- A assinatura de 3 argumentos ficou para tras numa versao anterior deste
-- ficheiro: se existir, sai, para nao ficarem duas funcoes com o mesmo nome.
DROP FUNCTION IF EXISTS update_tournament_notice(UUID, TEXT, TIMESTAMPTZ);
REVOKE ALL ON FUNCTION delete_tournament_notice(UUID) FROM public, anon;

GRANT EXECUTE ON FUNCTION publish_tournament_notice(UUID, TEXT, BOOLEAN, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION update_tournament_notice(UUID, TEXT, TIMESTAMPTZ, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_tournament_notice(UUID) TO authenticated;
