-- ═════════════════════════════════════════════════════════════════════════
-- AS HORAS A QUE O ROBÔ PUBLICA OS MIXES NO WHATSAPP, À ESCOLHA DO CLUBE
-- (Renato, 26 set 2026 — Trello #553, pedido do Diogo / Francisco).
--
-- Pode-se correr outra vez sem estragar.
--
-- Até aqui o robô publicava uma vez por dia, às 10h, para todos os clubes
-- (DAILY_DIGEST_HOUR no servidor). Passa a ser por clube: até 3 horas certas
-- entre as 8h e as 22h, iguais para todos os grupos de WhatsApp do clube. Em
-- cada hora o robô publica o cartão completo de cada mix aberto com vagas.
--
-- `organizations.whatsapp_post_hours` SMALLINT[], por omissão {10} — ninguém
-- que não mexa nota diferença. Vazio = o robô não publica a horas certas
-- (continua a publicar quando alguém entra ou sai).
--
-- Quem muda: só o admin do clube (ou da plataforma), pela função
-- set_whatsapp_post_hours. A coluna não tem política de escrita nova.
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS whatsapp_post_hours SMALLINT[] NOT NULL DEFAULT '{10}';

ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_whatsapp_post_hours_check;
ALTER TABLE organizations ADD CONSTRAINT organizations_whatsapp_post_hours_check
  CHECK (cardinality(whatsapp_post_hours) <= 3
     AND whatsapp_post_hours <@ ARRAY[8,9,10,11,12,13,14,15,16,17,18,19,20,21,22]::SMALLINT[]);

CREATE OR REPLACE FUNCTION set_whatsapp_post_hours(p_organization_id UUID, p_hours SMALLINT[])
RETURNS SMALLINT[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_hours SMALLINT[];
BEGIN
  IF NOT is_org_admin(p_organization_id) THEN
    RAISE EXCEPTION 'Só um admin do clube pode mudar as horas do WhatsApp.';
  END IF;
  -- Sem repetidas e por ordem; a CHECK recusa horas fora das 8h–22h ou mais de 3.
  SELECT COALESCE(array_agg(DISTINCT h ORDER BY h), '{}') INTO v_hours
    FROM unnest(COALESCE(p_hours, '{}')) AS h;
  UPDATE organizations SET whatsapp_post_hours = v_hours WHERE id = p_organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Clube não encontrado.'; END IF;
  RETURN v_hours;
END;
$$;
REVOKE ALL ON FUNCTION set_whatsapp_post_hours(UUID, SMALLINT[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION set_whatsapp_post_hours(UUID, SMALLINT[]) TO authenticated;
