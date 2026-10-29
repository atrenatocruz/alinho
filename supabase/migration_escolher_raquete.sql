-- «Escolhe a tua raquete» (docs/superpowers/specs/2026-10-27-escolher-raquete-design.md).
--
-- O que cria:
--   rackets           — cópia diária das raquetes da Street Padel (Edge Function sync-raquetes).
--                       Leitura para quem tem sessão; só o service role escreve.
--   racket_picks      — a última recomendação de cada jogador. Só o próprio a lê;
--                       só a Edge Function recomendar-raquete escreve (service role).
--   racket_pick_runs  — quantas recomendações cada jogador pediu hoje (limite: 3 por dia de Lisboa).
--   take_racket_run() — conta mais uma; false se já ia em 3. refund_racket_run() devolve uma
--                       tentativa que falhou. Só o service role as corre.
--   trigger em profiles — apagar a conta (anonymize_account) apaga as respostas.
--   cron 'sync-raquetes' — chama a Edge Function sync-raquetes todos os dias às 05:00 UTC.
--
-- Como correr (Renato, à mão no SQL Editor): primeiro no dev, depois o teste
-- supabase/tests/escolher_raquete.sql (todas as linhas OK), depois em produção.
-- ANTES de correr, preencher os dois <PREENCHER …> do fim com os do projeto certo
-- (o URL do projeto e o mesmo valor do secret SYNC_RAQUETES_SECRET da função).
-- Pode correr-se outra vez: tudo é IF NOT EXISTS / OR REPLACE e o cron.schedule
-- atualiza o job com o mesmo nome.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── 1. O catálogo ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rackets (
  store_id    TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  brand       TEXT,
  handle      TEXT NOT NULL,
  url         TEXT NOT NULL,
  image_url   TEXT,
  price       NUMERIC(8,2) NOT NULL,
  available   BOOLEAN NOT NULL,
  description TEXT,
  specs       JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS rackets_available_price_idx ON public.rackets (available, price);
ALTER TABLE public.rackets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rackets FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.rackets TO authenticated;
DROP POLICY IF EXISTS rackets_read ON public.rackets;
CREATE POLICY rackets_read ON public.rackets FOR SELECT TO authenticated USING (true);

-- ── 2. A última recomendação de cada jogador ─────────────────────────────
-- answers tem as respostas sobre dores: só o próprio as lê e apagar a conta apaga-as.
CREATE TABLE IF NOT EXISTS public.racket_picks (
  user_id    UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  answers    JSONB NOT NULL,
  lang       TEXT NOT NULL,
  best_id    TEXT NOT NULL,
  picks      JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.racket_picks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.racket_picks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.racket_picks TO authenticated;
DROP POLICY IF EXISTS racket_picks_own ON public.racket_picks;
CREATE POLICY racket_picks_own ON public.racket_picks FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ── 3. O limite diário ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.racket_pick_runs (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  day     DATE NOT NULL,
  count   INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
ALTER TABLE public.racket_pick_runs ENABLE ROW LEVEL SECURITY;  -- sem regras: só pela função
REVOKE ALL ON public.racket_pick_runs FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.take_racket_run(p_user UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_day   DATE := (NOW() AT TIME ZONE 'Europe/Lisbon')::date;
  v_count INT;
BEGIN
  INSERT INTO racket_pick_runs (user_id, day, count) VALUES (p_user, v_day, 1)
  ON CONFLICT (user_id, day) DO UPDATE SET count = racket_pick_runs.count + 1
    WHERE racket_pick_runs.count < 3
  RETURNING count INTO v_count;
  RETURN v_count IS NOT NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.take_racket_run(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.take_racket_run(UUID) TO service_role;

-- Devolve uma tentativa que falhou (IA em baixo ou resposta inválida): o limite
-- conta recomendações recebidas, não falhas da IA.
CREATE OR REPLACE FUNCTION public.refund_racket_run(p_user UUID)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  UPDATE racket_pick_runs SET count = count - 1
   WHERE user_id = p_user AND day = (NOW() AT TIME ZONE 'Europe/Lisbon')::date AND count > 0;
$function$;
REVOKE ALL ON FUNCTION public.refund_racket_run(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_racket_run(UUID) TO service_role;

-- ── 3b. Apagar a conta apaga as respostas ───────────────────────────────
-- anonymize_account (migration_account_deletion.sql) não apaga o perfil — só o
-- esvazia —, por isso o ON DELETE CASCADE nunca dispara. As respostas têm dados
-- de saúde (dores): saem quando o perfil é anonimizado. Um trigger em vez de
-- reescrever o anonymize_account, para não copiar a função toda para aqui.
CREATE OR REPLACE FUNCTION public.forget_racket_picks()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  DELETE FROM racket_picks     WHERE user_id = NEW.id;
  DELETE FROM racket_pick_runs WHERE user_id = NEW.id;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.forget_racket_picks() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS profiles_forget_racket_picks ON public.profiles;
CREATE TRIGGER profiles_forget_racket_picks
  AFTER UPDATE OF email ON public.profiles
  FOR EACH ROW
  WHEN (NEW.email LIKE 'removido-%@alinho.invalid' AND OLD.email IS DISTINCT FROM NEW.email)
  EXECUTE FUNCTION public.forget_racket_picks();

-- ── 4. O sync diário ─────────────────────────────────────────────────────
SELECT cron.schedule(
  'sync-raquetes',
  '0 5 * * *',
  $$SELECT net.http_post(
      url := '<PREENCHER: https://<projeto>.supabase.co>/functions/v1/sync-raquetes',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'x-sync-secret', '<PREENCHER: valor de SYNC_RAQUETES_SECRET>'),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    )$$
);
