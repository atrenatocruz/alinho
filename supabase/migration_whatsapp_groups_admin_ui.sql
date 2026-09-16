-- ════════════════════════════════════════════════════════════════════════
-- Grupos de WhatsApp visíveis e renomeáveis pelo admin do clube
-- (GerirClube → Definições). Parte 1: ver e dar nome. Ligar grupos novos
-- continua por SQL manual (ver o fim de migration_whatsapp_groups.sql).
--
-- PORQUÊ DUAS FUNÇÕES E NÃO POLICIES NA TABELA
-- `whatsapp_groups` foi criada deny-all de propósito (migration de 8 set,
-- Ruben): só o service role do bot e SQL manual lhe tocam. Isto NÃO muda —
-- a tabela continua sem policies. O acesso passa só por estas duas funções:
--
-- 1. Ler — só os grupos do próprio clube, só para admins desse clube.
-- 2. Mudar o nome — e APENAS o nome. Um UPDATE aberto por policy deixaria o
--    admin mudar também `group_jid` ou `organization_id`, e o bot passaria
--    a publicar os mixes do clube noutro grupo de WhatsApp qualquer. RLS não
--    restringe colunas; uma função restringe.
--
-- `label` é só para humanos: o bot carrega-o (whatsapp-bot/src/groups.js)
-- mas não o usa em nenhuma mensagem. Renomear não muda nada para os
-- jogadores nem exige reiniciar o bot.
--
-- Até isto correr, `list_whatsapp_groups` não existe e a app esconde a
-- secção (em vez de dizer "não há grupos" a um clube que os tem).
--
-- Proposta por acordar com o Ruben (dono da tabela).
-- Correr este ficheiro inteiro no Supabase → SQL Editor.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Listar os grupos do clube ─────────────────────────────────────────
-- Quem não é admin do clube recebe uma lista vazia, não um erro: não há
-- nada a distinguir entre "não tens acesso" e "não há nada", e assim não se
-- revela se um clube alheio tem grupos. Sem nome primeiro — são os que
-- pedem acção.
CREATE OR REPLACE FUNCTION list_whatsapp_groups(p_organization_id UUID)
RETURNS TABLE (id UUID, group_jid TEXT, label TEXT, levels TEXT[])
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT g.id, g.group_jid, g.label, g.levels
  FROM whatsapp_groups g
  WHERE g.organization_id = p_organization_id
    AND is_org_admin(p_organization_id)
  ORDER BY (g.label IS NULL) DESC, lower(g.label), g.created_at;
$$;

REVOKE ALL ON FUNCTION list_whatsapp_groups(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION list_whatsapp_groups(UUID) TO authenticated;

-- ── 2. Mudar o nome de um grupo ──────────────────────────────────────────
-- Grupo inexistente e "não és admin" dão o mesmo erro, para não confirmar
-- a existência de grupos de outros clubes. Espaços colapsados e aparados;
-- nome vazio volta a NULL ("por nomear"). Devolve o nome tal como ficou.
CREATE OR REPLACE FUNCTION rename_whatsapp_group(p_group_id UUID, p_label TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org UUID;
  v_label TEXT;
BEGIN
  SELECT organization_id INTO v_org FROM whatsapp_groups WHERE id = p_group_id;
  IF v_org IS NULL OR NOT is_org_admin(v_org) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;

  v_label := NULLIF(btrim(regexp_replace(COALESCE(p_label, ''), '\s+', ' ', 'g')), '');
  IF v_label IS NOT NULL AND char_length(v_label) > 60 THEN
    RAISE EXCEPTION 'label_too_long' USING ERRCODE = '22001';
  END IF;

  UPDATE whatsapp_groups SET label = v_label WHERE id = p_group_id;
  RETURN v_label;
END;
$$;

REVOKE ALL ON FUNCTION rename_whatsapp_group(UUID, TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION rename_whatsapp_group(UUID, TEXT) TO authenticated;
