-- ═════════════════════════════════════════════════════════════════════════
-- Notificações push: os telemóveis de cada pessoa (apps das lojas)
--
-- PORQUÊ. As apps de Android e iPhone (Capacitor) passam a receber os avisos
-- do sino como notificações push — Renato, 20 out (e a regra 4.2 da App
-- Store, que recusa apps que são só o site numa moldura). Desenho:
-- docs/superpowers/specs/2026-10-20-push-notifications-design.md
--
-- O QUE FAZ
--   · Tabela push_devices: um token por telemóvel (o que o FCM/APNs dá à app),
--     de quem é e se é android/ios. Ninguém a lê nem escreve diretamente:
--     RLS ligado e sem políticas; só as duas funções abaixo (como a pessoa)
--     e a função send-push (service role, que passa por cima do RLS).
--   · register_push_device(token, platform): o telemóvel desta sessão passa a
--     receber os avisos de quem entrou. Se o token já era de outra conta (saiu
--     de uma e entrou noutra no mesmo telemóvel), passa para esta — o aviso
--     de uma conta nunca vai para quem já lá não está.
--   · unregister_push_device(token): ao sair da conta. Só apaga o próprio.
--
-- NADA MUDA no site nem nas versões da app sem push: só acrescenta.
--
-- Dev (native-apps), 20 out 2026. Correr em dev e em produção.
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.push_devices (
  token        TEXT PRIMARY KEY CHECK (length(token) BETWEEN 20 AND 4096),
  user_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  platform     TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_devices_user_idx ON public.push_devices (user_id);

ALTER TABLE public.push_devices ENABLE ROW LEVEL SECURITY;
-- Sem políticas de propósito: nem anon nem authenticated tocam na tabela.
REVOKE ALL ON public.push_devices FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.register_push_device(p_token TEXT, p_platform TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_platform NOT IN ('android', 'ios') THEN
    RAISE EXCEPTION 'invalid platform' USING ERRCODE = '22023';
  END IF;
  -- Só quem tem perfil (o FK partia com um erro menos claro).
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_uid) THEN
    RAISE EXCEPTION 'no profile' USING ERRCODE = '42501';
  END IF;

  INSERT INTO push_devices (token, user_id, platform)
  VALUES (p_token, v_uid, p_platform)
  ON CONFLICT (token) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        platform = EXCLUDED.platform,
        last_seen_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.unregister_push_device(p_token TEXT)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM push_devices WHERE token = p_token AND user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.register_push_device(TEXT, TEXT) FROM public, anon;
REVOKE ALL ON FUNCTION public.unregister_push_device(TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.register_push_device(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unregister_push_device(TEXT) TO authenticated;

COMMIT;

-- Verificar depois de correr (true, true, true):
-- SELECT to_regclass('public.push_devices') IS NOT NULL,
--        to_regprocedure('public.register_push_device(text,text)') IS NOT NULL,
--        (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.push_devices'::regclass);
