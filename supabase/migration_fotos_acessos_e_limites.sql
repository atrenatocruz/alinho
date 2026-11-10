-- ═════════════════════════════════════════════════════════════════════════
-- Fotos de perfil e imagens dos clubes: acessos e limites
--
-- O QUE FAZ, nos baldes avatars e club-logos:
--   · a leitura pela tabela passa a valer só para a própria pasta (avatars) e
--     para quem gere o grupo ou o clube (club-logos), com a mesma condição
--     das regras de escrita desses baldes;
--   · cada ficheiro novo tem até 5 MB e é jpeg, png ou webp, como no
--     partner-images. Os ficheiros que já lá estão não são tocados.
--
-- PORQUE NÃO SE APAGAM AS DUAS REGRAS DE LEITURA. Trocar a foto grava por
-- cima da anterior (upsert), e isso precisa de leitura na tabela. Sem ela,
-- trocar a foto dava erro.
--
-- A APP ANTIGA. As imagens abrem pelo endereço público, que não passa por
-- estas regras. A app e as versões das lojas comprimem sempre para jpeg.
-- Em produção (9 nov): 36 ficheiros, todos jpeg, o maior com 210 KB.
-- Nada a mudar.
--
-- ORDEM. Não depende de outras.
--
-- Para desfazer (só em emergência):
--   DROP POLICY "Own avatar files" ON storage.objects;
--   DROP POLICY "Club files for org admins" ON storage.objects;
--   CREATE POLICY "Avatar images are publicly accessible" ON storage.objects
--     FOR SELECT USING (bucket_id = 'avatars');
--   CREATE POLICY "Club logos are publicly accessible" ON storage.objects
--     FOR SELECT USING (bucket_id = 'club-logos');
--   UPDATE storage.buckets SET file_size_limit = NULL, allowed_mime_types = NULL
--    WHERE id IN ('avatars', 'club-logos');
--
-- Dev 3, 9 nov 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Own avatar files" ON storage.objects;
CREATE POLICY "Own avatar files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (auth.uid())::text);

DROP POLICY IF EXISTS "Club logos are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Club files for org admins" ON storage.objects;
CREATE POLICY "Club files for org admins"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'club-logos' AND public.is_org_admin(((storage.foldername(name))[1])::uuid));

UPDATE storage.buckets
   SET file_size_limit = 5242880,
       allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
 WHERE id IN ('avatars', 'club-logos');

DO $$
BEGIN
  IF (SELECT count(*) FROM storage.buckets
       WHERE id IN ('avatars', 'club-logos') AND public
         AND file_size_limit = 5242880
         AND allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']) <> 2 THEN
    RAISE EXCEPTION 'Limites dos baldes errados';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'storage' AND tablename = 'objects'
                AND policyname IN ('Avatar images are publicly accessible', 'Club logos are publicly accessible')) THEN
    RAISE EXCEPTION 'Regras antigas ainda lá';
  END IF;
END $$;

COMMIT;
