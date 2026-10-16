-- ═════════════════════════════════════════════════════════════════════════
-- Mix: imagem opcional (Home do futuro 3/4)
--
-- PORQUÊ. SPEC design-handoff/2026-10-08-home-do-futuro/SPEC-3 (Francisco,
-- 9 out). O Criar e o Editar do mix ganham «Imagem (opcional)»; a imagem
-- aparece numa faixa no cartão da Home e da Comunidade. Ecrãs: Dev 2.
--
-- ONDE FICA A IMAGEM. No balde que já existe, club-logos (público), na pasta
-- <org_id>/mixes/…, como o cartaz do torneio. As regras do balde já deixam
-- o admin do clube carregar, mudar e apagar dentro da pasta do seu clube
-- (storage.foldername(name)[1] = org). Nada de novo no armazenamento.
--
-- O QUE FAZ
--   1. games.image_url e game_recurrences.image_url (text, opcional). Só
--      aceitam um endereço do nosso armazenamento, na pasta do clube do
--      próprio mix: …/storage/v1/object/public/club-logos/<org_id>/… — não
--      se pode pôr uma imagem de fora nem de outro clube.
--   2. recurrence_insert_pending (corpo VIVO, 2 trocas; «já estava»): as
--      datas que nascem da série herdam a imagem da série.
--   3. Mudar a imagem na série passa às datas futuras ainda não começadas
--      (rascunho, por abrir, abertas ou cheias), como o voucher e o prémio
--      (game_recurrences_push_voucher). Uma data cuja imagem foi mudada à mão
--      fica com a sua.
--   Leituras: o Home.jsx e a página do mix leem games.* e o
--   list_explore_events devolve to_jsonb(g): a coluna chega sozinha.
--
-- Dev 3, 10 out 2026 · ecrãs: Dev 2
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. As colunas ───────────────────────────────────────────────────────
ALTER TABLE games ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE game_recurrences ADD COLUMN IF NOT EXISTS image_url TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'games_image_url_own_storage') THEN
    ALTER TABLE games ADD CONSTRAINT games_image_url_own_storage CHECK (
      image_url IS NULL
      OR image_url ~ ('^https://[^/]+/storage/v1/object/public/club-logos/' || organization_id::text || '/'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_recurrences_image_url_own_storage') THEN
    ALTER TABLE game_recurrences ADD CONSTRAINT game_recurrences_image_url_own_storage CHECK (
      image_url IS NULL
      OR image_url ~ ('^https://[^/]+/storage/v1/object/public/club-logos/' || organization_id::text || '/'));
  END IF;
END $$;

-- ── 2. As datas da série herdam a imagem ────────────────────────────────
DO $$
DECLARE
  c_cols CONSTANT TEXT := '(tiebreak_8_8, seed_reverse,)';
  c_vals CONSTANT TEXT := '(COALESCE\(rec\.seed_reverse, FALSE\),)';
  v_def  TEXT := pg_get_functiondef('public.recurrence_insert_pending(uuid,timestamp with time zone)'::regprocedure);
BEGIN
  IF v_def LIKE '%image_url%' THEN
    RAISE NOTICE 'recurrence_insert_pending: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_cols, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, c_vals, 'g')) <> 1 THEN
    RAISE EXCEPTION 'recurrence_insert_pending: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  v_def := regexp_replace(v_def, c_cols, '\1 image_url,');
  v_def := regexp_replace(v_def, c_vals, '\1 rec.image_url,');
  EXECUTE v_def;
END $$;

-- ── 3. Mudar a imagem na série passa às datas que ainda vêm ─────────────
CREATE OR REPLACE FUNCTION public.game_recurrences_push_image()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.image_url IS DISTINCT FROM OLD.image_url THEN
    -- Só as que ainda seguiam a série: uma imagem mudada à mão fica.
    UPDATE games SET image_url = NEW.image_url, updated_at = NOW()
     WHERE recurrence_id = NEW.id AND date > NOW()
       AND status IN ('draft', 'pending', 'open', 'closed')
       AND image_url IS NOT DISTINCT FROM OLD.image_url;
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.game_recurrences_push_image() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS game_recurrences_push_image_trigger ON game_recurrences;
CREATE TRIGGER game_recurrences_push_image_trigger
  AFTER UPDATE OF image_url ON game_recurrences
  FOR EACH ROW EXECUTE FUNCTION game_recurrences_push_image();

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM information_schema.columns WHERE column_name = 'image_url' AND table_name IN ('games', 'game_recurrences');  -- 2
--   SELECT pg_get_functiondef('public.recurrence_insert_pending(uuid,timestamp with time zone)'::regprocedure) LIKE '%rec.image_url%';  -- true
