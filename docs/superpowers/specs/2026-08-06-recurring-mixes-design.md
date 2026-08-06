# Mixes Recorrentes — Design

## Objetivo

Permitir que um organizador configure um Mix para ser criado automaticamente de forma
recorrente (diária, semanal, mensal, anual), semelhante ao Google Calendar. O Mix novo
copia todas as configurações do Mix original — nunca os participantes.

## Arquitetura

Uma nova tabela `game_recurrences` guarda a regra de recorrência e uma cópia ("snapshot")
das configurações do Mix que devem ser copiadas para cada nova ocorrência. A tabela
`games` ganha duas colunas novas: `recurrence_id` (FK) e `is_recurrence_origin` (bool,
identifica o Mix que "é dono" da regra e cuja edição atualiza as configurações usadas em
Mixes futuros).

Um job `pg_cron`, agendado a cada 5 minutos, chama uma função SQL `SECURITY DEFINER` que
cria os Mixes em atraso diretamente na base de dados. Isto corre inteiramente dentro do
Postgres (Supabase), independente da SPA no Vercel ou do bot de WhatsApp estarem no ar —
ambos são processos que podem reiniciar ou não estar sempre disponíveis, ao contrário do
Postgres agendado.

## Cálculo da recorrência

Em vez de guardar um padrão de dia-da-semana/hora, guarda-se um único deslocamento
(`mix_offset_seconds`): a diferença entre "criar automaticamente em" e a data/hora do
próprio Mix, calculada uma vez no momento da criação. Também se guarda `next_run_at`, a
próxima vez que o job deve correr para esta recorrência.

A cada tick do cron, para cada recorrência em atraso:

```
next_mix_date = next_run_at + offset
next_run_at   = next_run_at + passo_da_frequência   (+1 dia / semana / mês / ano)
```

Exemplo do pedido original — Mix à quinta-feira 18:30, recorrência semanal, criação
automática à segunda-feira 12:00 — dá um offset de "3 dias e 6h30", que aplicado à segunda
seguinte produz sempre a quinta-feira seguinte às 18:30. O mesmo mecanismo generaliza a
diária/mensal/anual sem lógica especial por dia da semana.

## Modelo de dados

```sql
CREATE TABLE game_recurrences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily','weekly','monthly','yearly')),
  ends_type TEXT NOT NULL CHECK (ends_type IN ('never','on_date','after_occurrences')),
  ends_on TIMESTAMPTZ,
  ends_after_occurrences INTEGER,
  occurrences_created INTEGER NOT NULL DEFAULT 1, -- o Mix original conta como ocorrência 1
  mix_offset_seconds INTEGER NOT NULL,
  next_run_at TIMESTAMPTZ NOT NULL,

  -- snapshot das configurações copiáveis do Mix; atualizado quando o Mix
  -- original (is_recurrence_origin = true) é editado
  title TEXT NOT NULL,
  location TEXT,
  price_per_player NUMERIC(6,2),
  prize TEXT,
  num_courts INTEGER NOT NULL,
  court_time_minutes INTEGER NOT NULL,
  game_time_minutes INTEGER NOT NULL,
  format TEXT NOT NULL,

  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE games ADD COLUMN recurrence_id UUID REFERENCES game_recurrences(id);
ALTER TABLE games ADD COLUMN is_recurrence_origin BOOLEAN NOT NULL DEFAULT false;

-- backstop de idempotência: nunca duas ocorrências da mesma recorrência na mesma data
CREATE UNIQUE INDEX games_recurrence_date_key
  ON games(recurrence_id, date) WHERE recurrence_id IS NOT NULL;
```

### RLS

`game_recurrences` espelha as políticas de `games`:

- `SELECT`: membros da organização.
- `INSERT` / `UPDATE` / `DELETE`: apenas admins da organização (mesma verificação de
  `memberships.is_admin` usada em `admin_set_membership_admin` e nas políticas de
  `games`).

### Função do cron

```sql
CREATE OR REPLACE FUNCTION process_due_game_recurrences()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec RECORD;
  v_new_date TIMESTAMPTZ;
BEGIN
  FOR rec IN
    SELECT * FROM game_recurrences
    WHERE is_active = true AND next_run_at <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    v_new_date := rec.next_run_at + (rec.mix_offset_seconds || ' seconds')::interval;

    -- condições de fim são verificadas ANTES de criar o Mix que as excederia
    IF (rec.ends_type = 'on_date' AND v_new_date > rec.ends_on)
       OR (rec.ends_type = 'after_occurrences' AND rec.occurrences_created >= rec.ends_after_occurrences) THEN
      UPDATE game_recurrences SET is_active = false, updated_at = now() WHERE id = rec.id;
      CONTINUE;
    END IF;

    INSERT INTO games (
      organization_id, title, date, location, price_per_player, prize,
      num_courts, max_players, court_time_minutes, game_time_minutes, format,
      status, created_by, recurrence_id, is_recurrence_origin
    )
    VALUES (
      rec.organization_id, rec.title, v_new_date, rec.location, rec.price_per_player, rec.prize,
      rec.num_courts, rec.num_courts * 4, rec.court_time_minutes, rec.game_time_minutes, rec.format,
      'open', rec.created_by, rec.id, false
    )
    ON CONFLICT (recurrence_id, date) DO NOTHING;

    UPDATE game_recurrences
    SET next_run_at = rec.next_run_at + (CASE rec.frequency
          WHEN 'daily'   THEN interval '1 day'
          WHEN 'weekly'  THEN interval '1 week'
          WHEN 'monthly' THEN interval '1 month'
          WHEN 'yearly'  THEN interval '1 year'
        END),
        occurrences_created = occurrences_created + 1,
        updated_at = now()
    WHERE id = rec.id;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION process_due_game_recurrences() FROM public;

-- requer a extensão pg_cron (Database → Extensions no dashboard da Supabase)
SELECT cron.schedule(
  'process-game-recurrences',
  '*/5 * * * *',
  $$SELECT process_due_game_recurrences()$$
);
```

`FOR UPDATE SKIP LOCKED` impede processamento duplicado caso duas execuções do job se
sobreponham; o índice único em `(recurrence_id, date)` é o backstop final contra a mesma
data ser criada duas vezes.

## Frontend (`src/pages/Admin.jsx`)

O formulário de criar/editar Mix ganha um bloco de recorrência:

- **Toggle** "Mix recorrente" — visível ao criar um Mix novo, ou ao editar um Mix que já
  é `is_recurrence_origin` de uma recorrência **ativa**. Mixes gerados automaticamente
  (não-origem) não mostram este bloco.
- **Frequência** — `Segmented` com Diariamente / Semanalmente / Mensalmente / Anualmente.
- **Termina** — `Segmented` com Nunca / Até uma data / Após X ocorrências, com o campo
  correspondente (data ou número) a aparecer condicionalmente.
- **Criar automaticamente em** — `DateTimeField`, reutilizando o componente já usado para
  a data do Mix.

### Criar

1. Insere o `games` como hoje.
2. Se a recorrência está ativa: insere `game_recurrences` (offset calculado em JS como
   `new Date(gameForm.date) - new Date(gameForm.recurrence.nextRunAt)`, em segundos), depois
   faz `update` ao Mix criado com `recurrence_id` e `is_recurrence_origin: true`.
3. Se o passo 2 falhar, o Mix em si continua criado (só não fica recorrente); mostra-se um
   alerta a explicar isso, sem reverter a criação do Mix.

### Editar

- Se o Mix a editar é a origem de uma recorrência ativa: ao gravar, além do `update` a
  `games` (como hoje), atualiza-se também `title`/`location`/`price_per_player`/`prize`/
  `num_courts`/`court_time_minutes`/`game_time_minutes`/`format` e a regra
  (`frequency`/`ends_type`/`ends_on`/`ends_after_occurrences`) em `game_recurrences`. Mixes
  já criados nunca são reescritos — só o snapshot usado para os futuros muda.
- Desligar o toggle ao editar a origem marca `is_active = false` na recorrência (o job
  deixa de criar Mixes novos). A partir daí o formulário desse Mix passa a tratá-lo como
  um Mix sem recorrência ativa (ver ponto seguinte) — nunca se reativa a recorrência
  antiga.
- Se o Mix a editar não tem recorrência ativa associada (nunca teve, ou foi desativada),
  ligar o toggle segue o mesmo fluxo do Criar: insere uma `game_recurrences` nova e marca
  esse Mix como `is_recurrence_origin = true`.
- Editar um Mix não-origem (gerado automaticamente) é uma edição normal e independente,
  sem impacto na recorrência.

### Lista de Mixes

- Mixes com `recurrence_id` mostram um badge "recorrente".
- Mixes não-origem mostram também uma ação "Parar recorrência", que desativa a
  recorrência partilhada (`is_active = false`) sem precisar de encontrar o Mix original.

## Casos de borda

| Caso | Comportamento |
|---|---|
| Recorrência desativada (toggle off / "Parar recorrência") | Job para de criar Mixes; `next_run_at` deixa de ser processado porque `is_active = false`. |
| Atingida a data-fim ou o nº de ocorrências | Verificado no início de cada iteração do job, antes de criar o Mix que excederia o limite; a recorrência é desativada automaticamente. |
| Editar o Mix original | Só afeta o snapshot usado em criações futuras — Mixes já criados nunca são alterados. |
| Job corre duas vezes seguidas / concorrência | `FOR UPDATE SKIP LOCKED` + índice único em `(recurrence_id, date)` garantem que nunca se cria o mesmo Mix duas vezes. |
| Job fica muito tempo sem correr (ex.: outage) | Cada execução avança `next_run_at` em apenas um passo por recorrência; o atraso recupera-se sozinho ao longo de vários ticks de 5 min, sem rajada de Mixes duplicados. |

## Fora de âmbito (YAGNI)

- Reativar uma recorrência desativada.
- Editar a recorrência a partir de qualquer ocorrência (só a partir da origem).
- Mostrar informação de recorrência fora do painel Admin (ex.: roster do WhatsApp,
  `GameDetails`).
