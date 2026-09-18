# Aulas com professores — Fase 0: modelo de dados, permissões e RPCs

18 set 2026 · Dev 1 · Épico «#49 — ÉPICO — Aulas com treinadores» (UX UI Design) — https://trello.com/c/g7IzycgW
Fonte de verdade do produto: `SPEC.md` + `prints/` nesta pasta. Cópia deste ficheiro na app:
`docs/superpowers/specs/2026-09-18-aulas-fase0-modelo-design.md`.

**Estado: PROPOSTA para o Renato validar.** A migração da Fase 1 está escrita como proposta (não corrida): `supabase/migration_lessons_1_base.sql`.
Nada disto foi corrido na base de dados.

---

## 0. Pressupostos (a confirmar pelo Francisco — não mudam o modelo)

| # | Assumido | Porque não bloqueia |
|---|---|---|
| a | Texto na app: **"Professor"** (já é a palavra da Comunidade e do "Sou professor"). Código e tabelas em inglês: `lesson*`, `teacher*`. | Só textos. |
| b | Fases = **SPEC §10** (0 a 5), não as 5 do print 13. | Só ordem de trabalho. |
| c | "Não posso ir" numa aula **avulsa** = desistir dessa aula (o lugar fica livre, o professor é avisado). | Mesmo campo `status` do aluno. |
| d | Promoção **sem data de fim** por agora (coluna `promo_until` nullable, sem ecrã). | Coluna opcional. |
| e | Área do próprio professor no Gerir: entrada **«As minhas aulas»** para quem tem perfil de professor aprovado. | Só ecrã. |
| f | Tabela de preços com **todas** as combinações (tipo × duração × ponta/fora × mês/aula). | O modelo cobre qualquer ecrã. |

**Decidido pelo Francisco (18 set, noite):** (a) **"Professor"** nos textos. (f) **Tabela completa**: o preço
depende do tipo (privada, a 2, a 3, a 4) e da duração (1h, 1h30, 2h), com mês e aula, ponta e fora de ponta.
(d) **Promoção**: preço fixo que pode ser **mensal** (turma) ou **por aula** (avulsa); data de fim continua em
aberto. Autorizou escrever `migration_lessons_1_base.sql` **como proposta, sem correr**, antes do sim do Renato.

**Confirmado pelo Francisco (18 set):** plano da Fase 1 aprovado (entrega em 1a professores e preços · 1b turmas e
inscrição · 1c dia a dia); o ecrã «Nova turma» faz-se **por passos** (1.º professor, quando, tipo e preço; 2.º nível,
género, quem vê e fecho) — diferente do print 07, que o tem numa página só.

## 1. Princípios

1. **Toda a escrita por RPC `SECURITY DEFINER`**; as tabelas novas não têm policies de INSERT/UPDATE/DELETE
   (como `notifications` e `xp_events`). Leitura direta só onde não há nomes de alunos em jogo.
2. **Privacidade na base de dados** (SPEC §6.6): a lista de alunos com nomes **só sai por RPC**, que filtra por
   "é colega na mesma aula" ou `is_mutual_follow`. As tabelas de alunos não se leem diretamente (só as próprias linhas).
3. **Reaproveitar, não duplicar**: `teacher_profiles` é o professor (não há tabela nova de professores);
   `teacher_availability` é o horário semanal (blocos livres recorrentes); `is_org_admin`, `is_mutual_follow`,
   `notifications`, `vouchers`, `xp_events` estendem-se.
4. **Não redefinir funções partilhadas com os mixes** (`process_due_game_recurrences`, `finalize_mix`,
   `give_mix_kudos`). As aulas têm funções próprias.
5. **Uma migração por fase** (`migration_lessons_1_base.sql`, `_2_…`), cada uma só com o que a fase usa.
6. Horas locais: dia da semana e hora guardam-se "de relógio" (`day_of_week`, `TIME`) e convertem-se com
   `AT TIME ZONE 'Europe/Lisbon'` quando se geram as aulas (`TIMESTAMPTZ`).

## 2. O professor: `teacher_profiles` (estender)

Hoje (depois de `migration_teacher_profiles_open.sql`, **ainda por correr**): uma linha por (pessoa, clube) ou uma
linha "sem clube"; `status` (aprovação pela equipa Alinho) + `club_status` (o clube aceita).

**Decisão de modelo:** cada aula pertence a **uma linha de `teacher_profiles`** — isso já diz *quem* e *em que
clube* (ou sem clube). Um professor em dois clubes tem duas linhas e duas agendas, como no desenho.

Colunas novas:
| coluna | tipo | nota |
|---|---|---|
| `managed_by` | `TEXT NOT NULL DEFAULT 'both'` CHECK (`club`,`teacher`,`both`) | "Quem gere a agenda" (print 10, 4.º). Até à Fase 5 fica sempre `both`. Sem clube → sempre `teacher`. |
| `sort_order` | `INTEGER` | Ordem no separador Professores da página do clube, definida pelo clube. |

Funções auxiliares (novas, `STABLE SECURITY DEFINER`):
- `teacher_profile_active(tp)` → aprovado **e** (`organization_id IS NULL` **ou** `club_status='accepted'`). Só perfis
  ativos podem ter aulas, preços e blocos.
- `can_edit_lessons(tp)` → o dono do perfil se `managed_by IN ('teacher','both')`; admin do clube
  (`is_org_admin(organization_id)`) se `managed_by IN ('club','both')`; `is_platform_admin`.
- `can_mark_attendance(tp)` → dono do perfil **ou** admin do clube, **sempre** (mesmo com `managed_by='club'`, a
  Ana "só vê e marca faltas").
- `can_view_lesson_admin(tp)` → dono ou admin do clube (vê tudo da agenda, mesmo sem editar).

## 3. Tabelas novas

### 3.1 Preços — [Fase 1]
```
club_peak_hours                      -- horas de ponta, por clube e dia (print 08, 1.º)
  id, organization_id FK NOT NULL, day_of_week SMALLINT 1..7 (1=segunda), start_time TIME, end_time TIME
  CHECK end_time > start_time

lesson_prices                        -- tabela acordada clube/professor (SPEC §7)
  id
  organization_id   FK NULL           -- NULL = professor sem clube
  teacher_profile_id FK NULL          -- NULL = preço do clube para todos os professores
  lesson_type  TEXT CHECK (private|duo|trio|quad|trial)
  duration_minutes SMALLINT CHECK (60|90|120)
  peak         BOOLEAN                -- ponta / fora de ponta
  price_month  NUMERIC(7,2) NULL      -- NULL = não há turma deste tipo
  price_lesson NUMERIC(7,2) NULL      -- NULL = não há avulsa; 0 = grátis (ex. experimental)
  valid_from   DATE NOT NULL DEFAULT current_date   -- revisão anual sem apagar o histórico
  created_by, created_at
  UNIQUE (organization_id, teacher_profile_id, lesson_type, duration_minutes, peak, valid_from)
  CHECK (organization_id IS NOT NULL OR teacher_profile_id IS NOT NULL)
```
- Preço em vigor = linha mais recente com `valid_from <= data`, primeiro a do professor, senão a do clube
  (`lesson_price(tp, type, duration, peak, on_date)`).
- `lesson_peak(org, starts_at, duration)` → `peak` | `off` | `mixed`. `mixed` = quem cria escolhe (SPEC §7).
- **Só aparecem durações com preço** (SPEC §6.1) — sai direto desta tabela.

### 3.2 Turma — [Fase 1]
```
lesson_series
  id, teacher_profile_id FK NOT NULL, organization_id FK NULL (cópia do perfil, para RLS e filtros)
  day_of_week SMALLINT 1..7, start_time TIME, duration_minutes SMALLINT (60|90|120)
  lesson_type TEXT (private|duo|trio|quad)            -- capacidade 1/2/3/4
  level_from SMALLINT NULL, level_to SMALLINT NULL     -- bandas 1..6 e 7 = Iniciante; NULL = sem nível
  gender_restriction TEXT (misto|masculino|feminino)
  visibility TEXT (public|club|invited)                -- Pública · Só o clube · Pessoas escolhidas
  close_hours_before SMALLINT NOT NULL DEFAULT 24      -- nunca 0: "nunca no próprio dia"
  accepts_trial BOOL, trial_free BOOL, announce_whatsapp BOOL
  price_peak BOOL                                      -- que tabela se aplica (escolhido quando é 'mixed')
  promo_price_month NUMERIC NULL, promo_until DATE NULL   -- [Fase 4]
  prize TEXT NULL, has_voucher BOOL DEFAULT false         -- [Fase 5, só com o "sim" do Francisco]
  court TEXT NULL
  starts_on DATE NOT NULL, ends_on DATE NULL
  teacher_accepted_at TIMESTAMPTZ NULL                 -- "o professor aceita o que o clube cria"
  status TEXT (pending_teacher|active|ended)
  created_by, created_at, version INT DEFAULT 1
```
- Nível guardado como **número de banda** (1..6, 7 = Iniciante), não como "M5": a regra do género está em
  `gender_restriction` e o rótulo (M/F/N) sai de `ratingBand` como no resto da app.
- **O preço não se copia para a turma**: lê-se da tabela em vigor em cada mês (a mensalidade "muda de ano para
  ano"). Promoção, quando existe, sobrepõe-se.
- Criada pelo clube para um professor → `pending_teacher` até ele aceitar; criada pelo próprio → `active`.

```
lesson_enrolments                    -- inscrição na turma (dupla confirmação)
  id, series_id FK, user_id FK
  status TEXT (requested|accepted|confirmed|leaving|ended|rejected|withdrawn)
     requested  → o aluno pediu
     accepted   → professor/clube aceitou; falta o aluno confirmar (print 07, 4.º)
     confirmed  → inscrito todas as semanas
     leaving    → cancelou; fica até ends_on (último dia do mês)
  starts_on DATE NULL, ends_on DATE NULL
  first_month_amount NUMERIC NULL     -- ajuste do 1.º mês, calculado ao confirmar (SPEC §3.5)
  requested_at, accepted_at, accepted_by, confirmed_at, cancelled_at
  UNIQUE (series_id, user_id) WHERE status IN ('requested','accepted','confirmed','leaving')
```
- **Cancelar**: `ends_on = último dia do mês corrente` (Lisboa). Exceção "o clube permite outra coisa" = o
  professor/clube pode pôr `ends_on` mais cedo (RPC de gestão), sem contas na app.
- **Ajuste do 1.º mês**: `mensalidade × (aulas da turma que faltam no mês a partir de starts_on ÷ aulas da turma no
  mês)`, contando os dias da semana da turma no calendário (60 €, 4 no mês, faltam 2 → 30 €). A mesma conta vive
  em `src/lib/lessons.js` com testes, para o ecrã; a do servidor é a que se guarda.

### 3.3 Cada aula concreta — [Fase 1]
```
lessons
  id, series_id FK NULL (NULL = aula definida / avulsa / pedido aceite)
  teacher_profile_id FK NOT NULL, organization_id FK NULL
  starts_at TIMESTAMPTZ, duration_minutes SMALLINT
  lesson_type TEXT (private|duo|trio|quad)            -- capacidade
  status TEXT (open|confirmed|deciding|cancelled)     -- Por fechar · Confirmada · A decidir · Cancelada
                                                      -- "Terminada" = starts_at + duração < agora (derivado)
  close_at TIMESTAMPTZ                                 -- hora-limite
  price_per_person NUMERIC NULL, price_peak BOOL       -- fotografia no momento em que a aula é criada
  promo_price NUMERIC NULL                             -- [Fase 4]
  level_from, level_to, gender_restriction, visibility, court     -- herdados da turma, editáveis por aula
  accepts_trial, trial_free
  cancel_reason TEXT NULL (illness|holiday|vacation|other), cancel_note TEXT, cancelled_by, cancelled_at
  cancellation_id FK NULL                              -- cancelamento de período (3.6)
  prize, has_voucher                                   -- [Fase 5]
  created_by, created_at, updated_by, updated_at, version INT DEFAULT 1   -- [Fase 5: edição ao mesmo tempo]
  UNIQUE (series_id, starts_at) WHERE series_id IS NOT NULL
```

```
lesson_attendees                     -- quem vai a cada aula
  id, lesson_id FK
  user_id FK NULL, guest_name TEXT NULL               -- um dos dois (convidado sem conta, SPEC §6.7)
  role TEXT (class|single|trial|free_invite|compensation|guest)
        class = aluno da turma · single = avulsa · trial = experimental
        free_invite = convite grátis · compensation = compensação · guest = convidado sem conta
  status TEXT (invited|requested|accepted|confirmed|not_going|absent|declined|left)
        not_going = o aluno disse "Não posso ir" · absent = falta marcada pelo professor/clube
  price NUMERIC NULL                                   -- avulsa/experimental; 0 no convite e na compensação
  added_by, marked_by, marked_note TEXT ("ligou"), compensation_id FK NULL, created_at, updated_at
  UNIQUE (lesson_id, user_id) WHERE user_id IS NOT NULL
  CHECK ((user_id IS NULL) <> (guest_name IS NULL))
```
- ⚠️ **Diferença em relação à SPEC §11**: a "forma" (turma / avulsa / experimental / convite / compensação) fica
  **no aluno** (`lesson_attendees.role`), não na aula. Numa mesma terça da turma podem estar 3 alunos da turma + 1
  convite grátis + 1 compensação. O cartão de cada aluno mostra a forma dele ("Convite grátis", "Aula
  experimental", "Turma a 4").
- **Convite grátis não é público** (SPEC §3): a aula é visível, o lugar de convite não — só o convidado e quem gere
  veem a linha `free_invite`.
- Ocupação = linhas com `status IN ('accepted','confirmed')` (e `guest`). `not_going`/`absent` libertam o lugar
  **nesse dia**, sem mexer na turma nem na mensalidade.

### 3.4 Gerar as aulas da turma — [Fase 1]
- Função própria **`process_due_lesson_series()`** + pg_cron `process-lesson-series` (de hora a hora). **Não** toca
  em `process_due_game_recurrences`.
- Cria as aulas das **próximas 4 semanas** (proposta) com `ON CONFLICT (series_id, starts_at) DO NOTHING`, e
  copia para `lesson_attendees` (role `class`, status `confirmed`) as inscrições `confirmed`/`leaving` válidas nesse
  dia (`starts_on <= dia <= COALESCE(ends_on, ∞)`).
- Ao confirmar uma inscrição nova, a RPC acrescenta o aluno às aulas futuras já criadas; ao terminar (`ends_on`), sai
  das aulas depois dessa data.
- Porque 4 semanas: a Home mostra "um cartão por semana" e o aluno tem de poder carregar "Não posso ir" numa terça
  futura.

### 3.5 Fecho e "A decidir" — [Fase 4]
- O mesmo cron vê `close_at <= now()` em aulas `open`: cheia → `confirmed`; não cheia → `deciding` + aviso ao professor.
- `lesson_proposals` + `lesson_proposal_answers` (abaixo) servem as 4 saídas: "mudar tipo" cria uma proposta com
  prazo; quem não responde até ao prazo **sai** (o cron resolve).

### 3.6 Cancelar um período — [Fase 1]
```
lesson_cancellations
  id, teacher_profile_id FK, series_id FK NULL (NULL = todas as aulas do professor nesse clube)
  from_date DATE, to_date DATE, reason TEXT (illness|holiday|vacation|other), note TEXT
  created_by, created_at
```
- Marca `cancelled` as aulas no intervalo (e as que o cron criar depois, se caírem lá dentro). Aviso com a razão. A
  mensalidade não muda. Cada aluno da turma ganha direito a compensação (3.8, Fase 4).

### 3.7 Blocos livres e pedidos — [Fase 3]
- **Blocos semanais**: `teacher_availability` (já existe: dia + início/fim por `teacher_profile_id`). Falta o ecrã
  para os editar.
- **Blocos de uma data**: `lesson_blocks (id, teacher_profile_id, starts_at, ends_at, created_by,
  teacher_accepted_at, status)`.
- A "semana do professor" (print 10) calcula-se numa RPC: blocos semanais + blocos de data − aulas − cancelamentos.
```
lesson_requests
  id, teacher_profile_id FK, user_id FK
  starts_at TIMESTAMPTZ, duration_minutes, lesson_type, gender_pref, level_pref_from, level_pref_to
  status TEXT (pending|accepted|other_time_proposed|rejected|cancelled|merged)
  lesson_id FK NULL                                    -- aula criada/juntada ao aceitar
  created_at, resolved_at, resolved_by
```
- Pedidos **não caducam** (sem prazo, sem cron). Nunca aceites automaticamente.

### 3.8 Propostas e compensações — [Fase 3/4]
```
lesson_proposals                     -- mudar tipo, juntar pedidos, outra hora, compensação
  id, lesson_id FK NULL, kind TEXT (change_type|merge|other_time|compensation)
  changes JSONB                                        -- o que muda, por aluno (hora, tipo, preço)
  deadline TIMESTAMPTZ NULL, status (pending|accepted|rejected|expired), created_by, created_at
lesson_proposal_answers
  proposal_id, user_id, answer (accept|leave), answered_at   PK (proposal_id, user_id)

lesson_compensations
  id, user_id FK, teacher_profile_id FK, origin_lesson_id FK
  reason TEXT (teacher_cancelled|student_absent), status (to_schedule|proposed|booked|used|cancelled)
  proposed_by, target_lesson_id FK NULL, created_at, used_at
```
- Compensação **sem prazo e sem custo**: entra na aula escolhida como `lesson_attendees.role='compensation'`,
  `price=0`, **só nesse dia**.

### 3.9 Depois da aula — [Fase 5]
- `lesson_kudos (lesson_id, user_id, given_by, note TEXT, created_at)` — o professor dá ao aluno (diferente dos kudos
  entre jogadores dos mixes).
- **XP**: `xp_events` ganha `source_lesson_id UUID NULL` + kind `lesson_attended`; o CHECK "uma das origens" passa a
  incluir a aula; índice único parcial `(user_id, kind, source_lesson_id)`. Valor proposto: **20 XP** (o que está no
  print 07). Dado por RPC quando o professor fecha a aula ("Quem esteve").
- **Prémio/voucher** (só com o "sim" do Francisco): `vouchers.lesson_id` novo, `game_id` passa a opcional,
  CHECK um dos dois; `UNIQUE (game_id, user_id)` mantém-se e junta-se `UNIQUE (lesson_id, user_id)`.

## 4. Privacidade e quem vê o quê

| Dado | Quem vê | Como |
|---|---|---|
| Turma/aula (hora, tipo, nível, preço, lugares) | `public` → todos os utilizadores; `club` → membros do clube; `invited` → convidados; e sempre quem gere | SELECT com RLS em `lesson_series`/`lessons` |
| Aula completa | continua visível no booking do professor; **só a pesquisa da Home a esconde** | filtro na RPC da Home, não é segurança |
| **Nomes e fotos dos alunos** | colegas na mesma aula (status `accepted`/`confirmed`); amigos (`is_mutual_follow`); quem gere | **só pela RPC** `get_lesson_roster(lesson_id)` / `get_series_roster(series_id)` |
| Os outros alunos | número + média de nível ("Os outros 3 alunos não aparecem") | a mesma RPC devolve `hidden_count` e a média calculada no servidor |
| Lugar de convite grátis | o convidado e quem gere | `lesson_attendees` sem SELECT para os outros |
| As próprias inscrições/pedidos | o próprio | SELECT `user_id = auth.uid()` |
| Preços e horas de ponta | todos (é para decidir sem falar com ninguém) | SELECT aberto a `authenticated` |

`lesson_attendees`, `lesson_enrolments`, `lesson_requests`: SELECT só das próprias linhas **ou** `can_view_lesson_admin`.
Nunca diretamente para colegas — os colegas passam pela RPC.

## 5. RPCs por fase (todas `SECURITY DEFINER`, `SET search_path = public`)

**Fase 1**
- Professor/clube: `set_club_peak_hours(org, jsonb)`, `set_lesson_prices(org, tp NULL, jsonb)`,
  `set_teacher_sort_order(org, tp[])`, `create_lesson_series(...)`, `accept_lesson_series(series)` (professor aceita o
  que o clube criou), `update_lesson_series(...)`, `resolve_enrolment(enrolment, accept)`,
  `mark_lesson_absence(lesson, user, note)`, `add_lesson_guest(lesson, name)`, `cancel_lesson(lesson, reason, note)`,
  `cancel_lesson_period(tp, series NULL, from, to, reason, note)`, `end_enrolment_early(enrolment, date)`.
- Aluno: `request_enrolment(series)`, `confirm_enrolment(enrolment)` / `decline_enrolment`,
  `cancel_enrolment(enrolment)` (fim do mês), `set_lesson_attendance(lesson, going BOOL)` ("Não posso ir" / "Afinal vou").
- Leitura: `list_club_teachers(org)` (separador Professores: níveis, "desde", próxima vaga),
  `get_teacher_page(tp)` (perfil + preços + semana), `get_lesson(lesson)`, `get_lesson_roster(lesson)`,
  `get_series_roster(series)`, `list_my_lessons(from, to)` e `list_lesson_events(from, to, lat, lng, radius)` para a
  Home (distância como `list_explore_events`; esconde completas e `invited`).
- Cron: `process_due_lesson_series()`.

**Fase 2** — `invite_to_lesson(lesson, user, free BOOL)`, `respond_lesson_invite(lesson, accept)`,
`open_seat_as_single(lesson)`, `request_single_seat(lesson)`, `request_trial(series|lesson)`,
`create_defined_lesson(...)`, `share` = ligação (sem RPC).
**Fase 3** — `create_lesson_block`, `request_lesson(tp, starts_at, duration, type, gender, level)`,
`resolve_lesson_request(request, action, new_time NULL)`, `propose_merge(request_ids[])`, `answer_proposal(proposal, accept)`,
`cancel_lesson_request`, `get_teacher_week(tp, from, to)`, `suggest_existing_lesson(...)`.
**Fase 4** — `decide_lesson(lesson, action, ...)` (dar · mudar tipo · esperar · cancelar), fecho no cron, compensações
(`propose_compensation`, `answer_compensation`), `set_lesson_promo`.
**Fase 5** — `set_teacher_managed_by(tp, mode)`, `finish_lesson(lesson, present[], kudos jsonb, prize_to[])` (XP + kudos
+ voucher), versão/realtime para a edição ao mesmo tempo, anúncio no WhatsApp.

Todas as RPCs de gestão verificam `can_edit_lessons(tp)` (ou `can_mark_attendance` para faltas). As do aluno
verificam nível, género, visibilidade e lugares **no servidor**.

## 6. Avisos (sino) e WhatsApp

- `notifications` (de `migration_mix_notices.sql`) ganha `lesson_id UUID NULL REFERENCES lessons ON DELETE CASCADE`.
  Kinds novos: `lesson_enrolment_accepted`, `lesson_enrolment_rejected`, `lesson_confirm_needed`, `lesson_cancelled`,
  `lesson_closed`, `lesson_deciding`, `lesson_proposal`, `lesson_invite`, `lesson_student_left`, `lesson_reminder`,
  `lesson_compensation`. Escritos só pelas RPCs.
- ⚠️ **Dependência**: confirmar se `migration_mix_notices.sql` já foi corrida em produção (ela própria diz que é
  proposta a acordar contigo). Se não foi, as aulas precisam dela antes.
- WhatsApp (anúncio de turmas, avisos): o bot faz polling de `notifications` — a parte das aulas no bot é para a
  Fase 5 e precisa de redeploy manual no EC2 (contigo).

## 7. Home (agenda)

`list_lesson_events` devolve eventos no mesmo formato dos outros (`eventFromLesson` em `src/lib/agenda.js`, novo
`KIND_STYLE.lesson` turquesa, filtro "Aulas" na barra que já existe). Realtime: `lessons` e `lesson_attendees` na
publicação `supabase_realtime` (padrão de `migration_whatsapp_bot.sql`), só para o próprio evento — sem nomes.

## 8. Migrações e ordem

| Fase | Ficheiro | Depende de |
|---|---|---|
| 1 | `migration_lessons_1_base.sql` — colunas em `teacher_profiles`, auxiliares, preços, ponta, turmas, inscrições, aulas, alunos, cancelamentos, RLS, RPCs da Fase 1, cron, `notifications.lesson_id` | `migration_teacher_profiles_open.sql`, `migration_mix_notices.sql`, `migration_instagram_follow_system.sql` (`is_mutual_follow`), `migration_searchable_orgs.sql` (Dev 1, também por correr) |
| 2 | `migration_lessons_2_single_trial.sql` | Fase 1 |
| 3 | `migration_lessons_3_blocks_requests.sql` | Fase 2 |
| 4 | `migration_lessons_4_close_compensation.sql` | Fase 3 |
| 5 | `migration_lessons_5_manage_xp_prize.sql` — `managed_by`, versão, XP (`xp_events`), kudos, vouchers | Fase 4, `migration_xp_engagement.sql`, `migration_vouchers.sql` |

## 9. O que NÃO se toca
`games`, `participants`, `game_recurrences`, `process_due_game_recurrences`, `finalize_mix`, `give_mix_kudos`,
rankings/Elo (as aulas **não mexem no ranking**). Pagamentos, reserva de campo, chat, lista de espera: fora.

## 10. Perguntas para o Renato (o "sim" ao modelo)

1. **Professor = linha de `teacher_profiles`** (um por clube), com `managed_by` e `sort_order` lá — ok? Ou preferes
   uma tabela `teacher_clubs` à parte?
2. **Forma no aluno, não na aula** (`lesson_attendees.role`) — ok? (diferença em relação à SPEC §11)
3. **Aulas da turma pré-criadas 4 semanas à frente** por um cron próprio (`process-lesson-series`, de hora a hora) —
   ok? Quantas semanas?
4. **Nomes só por RPC** e tabelas de alunos sem SELECT para colegas — ok como forma de cumprir a privacidade?
5. **Preço lido da tabela em vigor** em cada mês (não copiado para a turma); fotografia só na aula concreta — ok?
6. `notifications.lesson_id` — ok? E a `migration_mix_notices.sql` já está corrida?
7. **Planos**: as aulas ficam só para organizações com plano **Club** (`plan_tier='club'`, é o que o plano promete)
   e para professores sem clube? Ou sem limite de plano? (decisão também do Francisco)
8. Cron de hora a hora chega para o fecho ("à volta de 1 dia antes")?

## 11. Próximo passo depois do "sim"
Plano curto da **Fase 1** ao Francisco (ecrãs, ficheiros, suposições) → "okay" → migração + `src/lib/lessons.js` com
testes (preço ponta/fora, ajuste do 1.º mês, fim do mês) → ecrãs com prints lado a lado com `prints/`.
