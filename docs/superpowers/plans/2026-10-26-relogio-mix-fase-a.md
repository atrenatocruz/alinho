# Relógio no mix, Fase A: contar um jogo do mix e gravar no fim

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No relógio, um dos 4 jogadores escolhe um jogo do mix a decorrer, fica com ele (os outros veem-no bloqueado), conta-o como um jogo normal, e no fim o resultado fica gravado nesse jogo do mix.

**Architecture:** O iPhone pede, por uma Edge Function nova (`watch-session`), uma sessão Supabase **própria do relógio** e manda-a por `WCSession.updateApplicationContext`. O relógio guarda-a no Keychain, renova-a sozinho e fala diretamente com o Supabase por REST, sem SDK. No servidor há uma tabela nova `mix_live_scores` para saber quem tem o jogo, duas RPCs novas (`list_my_watch_mix_matches`, `claim_mix_match`) e um remendo ao `save_mix_match_result` para deixar gravar quem tem o jogo. No relógio, a lógica sem ecrã (formato, resultado, pedidos, fila de envio) fica em código que corre no `swift test` em macOS. Os ecrãs ficam no `ScoreboardUI`.

**Tech Stack:** Postgres/Supabase (RPC `SECURITY DEFINER`, RLS), Edge Function Deno (`jsr:@supabase/supabase-js@2`), Swift 5.10 / SwiftUI watchOS 10 / WatchConnectivity / Security (Keychain), Capacitor 8 (plugin `WatchGames`), React + Vitest.

**Spec:** `docs/superpowers/specs/2026-10-26-relogio-mix-a-decorrer-design.md` (secções «Fase A», «Formato do relógio a partir do mix» e «Como funciona por dentro»).

## Global Constraints

- Só jogos de **mix** (`matches` de um `games` com `status = 'in_progress'`). Nada de torneios, ligas ou amigos.
- Quem conta é sempre **um dos 4 jogadores** do jogo (`teams.player1_id/player2_id` de `team_a_id`/`team_b_id`). Ponto 1 confirmado pelo Renato a 26 out: esses 4 passam a poder gravar o resultado **do seu jogo**, **só com o mix `in_progress`** e **só depois de ficarem com o jogo**.
- O resultado do relógio **fica final** e passa pelo **mesmo** `save_mix_match_result` (as mesmas travas do #588). O admin corrige como hoje.
- Escrita em `mix_live_scores` **só por RPC `SECURITY DEFINER`**. Sem políticas de INSERT/UPDATE/DELETE para clientes. Na Fase A também não há SELECT: ninguém lê a tabela diretamente.
- Remendos a funções vivas: texto do `pg_get_functiondef`, contagem exata (falha se não aparecer 1 vez), e «já estava» se correr duas vezes. É o padrão de `supabase/migration_mix_marcadores.sql`.
- Cada migração: cabeçalho PORQUÊ / O QUE FAZ / «Run this whole file in Supabase → SQL Editor». **Não está viva até alguém a correr à mão**, primeiro no dev (`jnrdbf…`) e depois em produção, antes de qualquer push para `main`.
- Compatibilidade: apps antigas (web, iPhone, relógio) continuam iguais. Se a RPC nova não existir (404 / `PGRST202`), o relógio esconde «Jogos do mix» sem mostrar erro.
- Um jogo de mix contado no relógio **não** vai ao iPhone como jogo entre amigos (não chamar `sendToPhone`).
- Textos do relógio com `L.t("…")`, em pt-PT, com a chave em português, e com a tradução inglesa em `Localizable.xcstrings`.
- Commits em português, no estilo `feat(relógio): …` / `fix(relógio): …`, **sem** linha de atribuição ao Claude (memória: dev branch workflow). Trabalho em `dev`.
- O `swift test` e a build do relógio só correm no GitHub Actions (workflow «Relógio», em cada push que toque `ios/AlinhoWatch/**`), porque não há Mac local. A app de iPhone verifica-se à mão com «Run workflow → ios-embed».

## Mapeamento de formatos (substitui a tabela da spec, que foi escrita antes de ler a migração de 26 out)

`migration_set_sem_fim_e_pontos_corridos.sql`: num mix que não é Americano, `pontos_simples` **é** «Set sem fim». No Americano, `pontos_simples` e `pontos_corridos` são «Pontos corridos», e `set_sem_fim` é «Set sem fim».

| `games.format` | `games.scoring_format` | `MatchFormat` | Resultado gravado |
|---|---|---|---|
| ≠ `americano` | `pontos_simples` | `.endlessSet` | `score_a/b` = jogos; `p_sets = null` |
| qualquer | `pontos_corridos` | `.points` (`pointsTotal = nil`) | `score_a/b` = pontos; `p_sets = null` |
| `americano` | `pontos_simples` | `.points` (`pointsTotal = nil`) | idem |
| `americano` | `set_sem_fim` | `.endlessSet` | jogos; `p_sets = null` |
| qualquer | `pro_set_9` | `.proSet9`, só se `tiebreak_8_8` for `NULL` ou `'tiebreak'` (senão `nil`) | `score_a/b` = jogos do set; `p_sets = null` |
| qualquer | `melhor_2_sets` | `.twoSetsSuperTieBreak` | sets ganhos + `p_sets` (o 3.º com `is_super_tiebreak: true`) |
| qualquer | `melhor_3_sets` | `.bestOf3` | sets ganhos + `p_sets` |
| outro | outro | `nil` → «Este mix não dá para contar no relógio» | — |

`deuce_mode`: `ponto_de_ouro` → `.golden`, `vantagem` → `.advantage`, `star_point` → `.starPoint`. Quem implementa confirma os nomes exatos no `CHECK` da migração que criou `deuce_mode` (`grep -n deuce_mode supabase/migration_*.sql`). Um valor desconhecido dá `nil`, tal como um formato desconhecido.

O formato de `p_sets` e de `score_a/b` é o mesmo que o `handleSaveScore` envia (`src/pages/GameDetails.jsx:2046-2070`).

## Review Focus

1. **Jogar na equipa B.** «Nós» no relógio é a dupla de quem conta. Se essa dupla for `team_b`, o resultado tem de ir trocado (`score_a` = eles). Teste em Task 3.
2. **Dois relógios a carregar «Começar» ao mesmo tempo.** Só um fica com o jogo; o outro recebe `taken` e vê «A ser contado por …». Teste em Task 1.
3. **A fila de envio depois de o admin fechar o mix.** O `save` dá `not_allowed`, e a entrada sai da fila em vez de tentar para sempre (e de, mais tarde, pisar uma correção do admin). Teste em Task 4.
4. **Desfazer depois do fim e acabar outra vez.** Na fila fica uma só entrada por jogo do mix, a mais recente. Teste em Task 4.
5. **Conta sem email** (algumas contas vindas do WhatsApp): a `watch-session` responde `no_email` com 422 e o iPhone não insiste. Teste à mão em Task 2, e em Task 5 a decisão de não repetir.

---

### Task 1: Migração da Fase A (tabela, listar, ficar com o jogo, gravar)

**Files:**
- Create: `supabase/migration_relogio_mix_a.sql`
- Create: `supabase/tests/relogio_mix_a.sql` (no estilo de `supabase/tests/liga_5_resultados.sql`: `_ctx` com ids para preencher, `pg_temp.as_user`, `_r(ok,label)`, `ROLLBACK`)

**Interfaces:**
- Produces:
  - `mix_live_scores(match_id UUID PK → matches ON DELETE CASCADE, scorer_id UUID NOT NULL → profiles, started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), seq INTEGER NOT NULL DEFAULT 0, state JSONB, finished_at TIMESTAMPTZ)`. RLS ligada, sem políticas, `REVOKE ALL … FROM PUBLIC, anon, authenticated`. Na Fase A, `seq`, `state` e `finished_at` ficam vazios; a Fase B usa-os.
  - `list_my_watch_mix_matches() RETURNS JSONB`: um array, um objeto por jogo de um mix `in_progress` em que `auth.uid()` é um dos 4 e (`score_a IS NULL` ou o jogo é meu em `mix_live_scores`). Cada objeto: `{match_id, game_id, game_name, round_number, court_number, my_side: 'a'|'b', partner_name, opponent_names: [text,text], format, scoring_format, deuce_mode, tiebreak_8_8, scorer_id, scorer_name}`, ordenado por `round_number, court_number`. Os nomes vêm de `profiles.name`.
  - `claim_mix_match(p_match_id UUID) RETURNS JSONB` → `{match_id, my_side}`. Erros, pela mensagem: `not_player`, `not_live`, `has_result`, `taken`. Se o jogo já for de `auth.uid()`, devolve OK, para poder repetir sem problema.
  - `save_mix_match_result`: na condição de quem pode gravar, `EXISTS (SELECT 1 FROM game_scorekeepers WHERE game_id = v_g.id AND user_id = auth.uid())` passa a `(EXISTS (… game_scorekeepers …) OR EXISTS (SELECT 1 FROM mix_live_scores WHERE match_id = v_m.id AND scorer_id = auth.uid()))`. Continua dentro do `v_g.status = 'in_progress' AND …`.

- [ ] **Step 1: Escrever `supabase/tests/relogio_mix_a.sql`** com estes casos, cada um a escrever em `_r`. Contexto: um mix `in_progress` de dev com um jogo J sem resultado, jogadores A1, A2 (equipa a), B1, B2 (equipa b), um membro M que não joga J, e o admin.
  - como B1: `list_my_watch_mix_matches()` contém J com `my_side = 'b'` e `scorer_id` null;
  - como M: `claim_mix_match(J)` dá erro `not_player`;
  - como B1: `claim_mix_match(J)` → `my_side = 'b'`; repetir dá OK;
  - como A1: `claim_mix_match(J)` dá erro `taken`; `list_my_watch_mix_matches()` mostra J com `scorer_name` = nome de B1;
  - como A1: `save_mix_match_result(J, 6, 4, NULL)` dá erro `not_allowed` (A1 não tem o jogo);
  - como B1: `save_mix_match_result(J, 4, 6, NULL)` passa; `matches.scored_by = B1`;
  - como B2: `claim_mix_match(J)` dá erro `taken`, porque o jogo continua de B1, que já gravou; para um jogo com resultado e sem dono, dá `has_result`;
  - mix posto `finished` (como admin, `RESET ROLE` antes): como B1, `save_mix_match_result(J, 5, 6, NULL)` dá erro `not_allowed`;
  - como `authenticated`: `SELECT * FROM mix_live_scores` dá erro de permissão, ou devolve 0 linhas.

- [ ] **Step 2: Correr o teste no dev antes da migração.** Esperado: falha, com `function list_my_watch_mix_matches() does not exist`.

- [ ] **Step 3: Escrever `supabase/migration_relogio_mix_a.sql`**, num só `BEGIN … COMMIT`, com:
  - guarda no início: se `to_regprocedure('public.save_mix_match_result(uuid, integer, integer, jsonb)')` for nulo, erro «correr primeiro migration_mix_gravar_resultado.sql»;
  - a tabela, com `CREATE TABLE IF NOT EXISTS`;
  - as duas RPCs, `SECURITY DEFINER SET search_path = public`, `REVOKE … FROM PUBLIC, anon`, `GRANT EXECUTE … TO authenticated`;
  - o `claim` é atómico: `SELECT … FROM matches WHERE id = p_match_id FOR UPDATE` e depois `INSERT INTO mix_live_scores … ON CONFLICT (match_id) DO NOTHING`. Se não inseriu e o dono for outro, dá `taken`;
  - o remendo ao `save_mix_match_result` num bloco `DO`. Usa `replace(pg_get_functiondef(...), E'\r', '')`. Se o texto já tiver `mix_live_scores`, faz `RAISE NOTICE 'já estava'`. Se não, conta as ocorrências do `EXISTS (SELECT 1 FROM game_scorekeepers WHERE game_id = v_g.id AND user_id = auth.uid())`: tem de ser exatamente 1, senão `RAISE EXCEPTION '… Parar e ler.'`. Depois `EXECUTE` com o texto trocado e volta a fazer os `REVOKE/GRANT`;
  - no fim, em comentário, as verificações (`has_function_privilege('anon', …) = false`).

- [ ] **Step 4: Pedir ao Renato para correr a migração no Supabase de dev** e depois o teste. Esperado: todas as linhas `OK`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migration_relogio_mix_a.sql supabase/tests/relogio_mix_a.sql
git commit -m "feat(relógio): mix_live_scores, listar e ficar com um jogo do mix, quem tem o jogo grava o resultado"
```

---

### Task 2: Edge Function `watch-session` (uma sessão só do relógio)

**Files:**
- Create: `supabase/functions/watch-session/index.ts` (no estilo de `supabase/functions/send-otp/index.ts`: `corsHeaders`, `jsonResponse`)

**Interfaces:**
- Produces: `POST /functions/v1/watch-session`, chamada com o JWT do utilizador. Respostas:
  - `200 {access_token, refresh_token, expires_at, user_id}`;
  - `401 {error:'unauthorized'}`;
  - `422 {error:'no_email'}`.
- Por quê: o refresh token do iPhone não pode ser partilhado, porque a rotação faz cair a sessão de um dos dois. Uma sessão nova tem o seu próprio refresh token.

- [ ] **Step 1: Implementar.**
  - `getUser()` com o JWT do pedido; sem utilizador → 401.
  - Sem `user.email` → 422 `no_email`.
  - Cliente de serviço (`SUPABASE_SERVICE_ROLE_KEY`): `auth.admin.generateLink({ type: 'magiclink', email })`. **Não** envia email; só gera o `properties.hashed_token`.
  - Cliente anon: `auth.verifyOtp({ token_hash, type: 'magiclink' })` → `session`.
  - Devolve só os quatro campos.
  - Comentário no topo: PORQUÊ, os secrets que usa (injetados pela plataforma) e o comando de deploy.

- [ ] **Step 2: Deploy no projeto de dev.** `npx supabase functions deploy watch-session --project-ref <dev>`, feito pelo Renato, se a CLI não estiver ligada aqui.

- [ ] **Step 3: Verificar à mão.** Com o JWT de uma conta de teste (copiado da app em dev): `curl -X POST -H "Authorization: Bearer $JWT" -H "apikey: $ANON" https://<dev>.supabase.co/functions/v1/watch-session`.
  - Esperado: 200 com `refresh_token` **diferente** do da app.
  - Repetir com uma conta sem email: 422 `no_email`.
  - Confirmar que a sessão da app continua válida (recarregar a página).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/watch-session/index.ts
git commit -m "feat(relógio): Edge Function watch-session (sessão própria do relógio)"
```

---

### Task 3: Formato e resultado do mix (PadelScoring, puro)

**Files:**
- Create: `ios/AlinhoWatch/Sources/PadelScoring/MixRules.swift`
- Create: `ios/AlinhoWatch/Tests/PadelScoringTests/MixRulesTests.swift`

**Interfaces:**
- Produces:
  - `public enum MixSide: String, Codable, Sendable { case a, b }`
  - `public enum MixRules { public static func config(gameFormat: String, scoringFormat: String, deuceMode: String, tiebreak88: String?) -> MatchConfig? }`. Devolve `firstServer: nil`; nos `.points`, `pointsTotal: nil`; os outros campos ficam por omissão.
  - `public struct MixResult: Codable, Equatable, Sendable { public let scoreA: Int; public let scoreB: Int; public let sets: [MixSet]? ; public init(record: MatchRecord, side: MixSide) }`
  - `public struct MixSet: Codable, Equatable, Sendable { public let score_a: Int; public let score_b: Int; public let is_super_tiebreak: Bool }`. Os nomes em snake_case são de propósito: este JSON vai tal e qual como `p_sets`.

- [ ] **Step 1: Escrever os testes** (com os helpers de `Tests/PadelScoringTests/Helpers.swift` para jogar um jogo até ao fim):
  - `testMappingTable`: cada linha da tabela «Mapeamento de formatos» → o `MatchFormat` esperado; `("sobe_desce","pontos_simples","ponto_de_ouro",nil)` → `.endlessSet` / `.golden`; `("americano","pontos_simples",…)` → `.points`; `("sobe_desce","pro_set_9","ponto_de_ouro","super")` → `nil`; `("sobe_desce","sets_livres",…)` → `nil`; `deuceMode: "xyz"` → `nil`.
  - `testBestOf3SideA`: 6-4 3-6 6-2 do lado a → `scoreA 2, scoreB 1, sets [(6,4,false),(3,6,false),(6,2,false)]`.
  - `testBestOf3SideBSwaps`: o mesmo jogo com `side: .b` → `scoreA 1, scoreB 2, sets [(4,6),(6,3),(2,6)]`.
  - `testSuperTieBreakFlag`: `twoSetsSuperTieBreak` 6-4 4-6 10-8 → o 3.º set com `is_super_tiebreak == true`.
  - `testProSetIsGamesNoSets`: pro set 9-7 → `scoreA 9, scoreB 7, sets nil`.
  - `testEndlessSetIsGames`: set sem fim terminado com 5-3 em jogos → `5, 3, nil`.
  - `testPointsIsPoints`: pontos corridos 21-17 → `21, 17, nil`.

- [ ] **Step 2: Fazer push e ver o job `scoring` do workflow «Relógio» falhar**, porque `MixRules` não existe. Ver com `gh run watch` ou `gh run list --workflow watch.yml -L 1`.

- [ ] **Step 3: Implementar `MixRules.swift`.** Quais campos do `MatchRecord` usar em cada formato: `scoreFromSets` em `src/lib/watchRegister.js`, e o `WatchGamePayload.init` faz a mesma escolha (`sets` / `games` / `points`).

- [ ] **Step 4: Push; o job `scoring` passa.**

- [ ] **Step 5: Commit** (antes do push do Step 4)

```bash
git add ios/AlinhoWatch/Sources/PadelScoring/MixRules.swift ios/AlinhoWatch/Tests/PadelScoringTests/MixRulesTests.swift
git commit -m "feat(relógio): formato e resultado de um jogo do mix"
```

---

### Task 4: AlinhoSync, falar com o Supabase e fila de envio (puro, testável em macOS)

**Files:**
- Modify: `ios/AlinhoWatch/Package.swift`: novo target `AlinhoSync` (depende de `PadelScoring`), `ScoreboardUI` passa a depender de `AlinhoSync`, e novo `testTarget` `AlinhoSyncTests`
- Create: `ios/AlinhoWatch/Sources/AlinhoSync/WatchCredentials.swift`
- Create: `ios/AlinhoWatch/Sources/AlinhoSync/SupabaseClient.swift`
- Create: `ios/AlinhoWatch/Sources/AlinhoSync/MixMatch.swift`
- Create: `ios/AlinhoWatch/Sources/AlinhoSync/ResultOutbox.swift`
- Create: `ios/AlinhoWatch/Tests/AlinhoSyncTests/SupabaseClientTests.swift`
- Create: `ios/AlinhoWatch/Tests/AlinhoSyncTests/ResultOutboxTests.swift`

**Interfaces:**
- Consumes: `MixSide`, `MixResult` (Task 3); as RPCs de Task 1; a resposta de Task 2.
- Produces:
  - `public struct WatchCredentials: Codable, Equatable, Sendable { supabaseURL: URL; anonKey: String; accessToken: String; refreshToken: String; expiresAt: Date; userID: UUID }`
  - `public protocol HTTPTransport: Sendable { func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) }`, com `URLSessionTransport` como implementação real.
  - `public protocol CredentialStore: Sendable { func load() -> WatchCredentials?; func save(_ c: WatchCredentials?) }`. O Keychain fica para Task 6; os testes usam uma em memória.
  - `public enum SyncError: Error, Equatable { case signedOut, unavailable, server(String), network }`. `unavailable` = 404 ou código `PGRST202` (a RPC não existe). `server(code)` = a `message` do erro do PostgREST (`taken`, `not_allowed`, …).
  - `public actor SupabaseClient { init(store: CredentialStore, transport: HTTPTransport, now: @escaping @Sendable () -> Date = Date.init); func rpc<T: Decodable>(_ name: String, _ args: [String: Any]) async throws -> T }`. Pedidos `POST {url}/rest/v1/rpc/{name}` com `apikey` e `Authorization: Bearer`. Se faltarem menos de 60 s para `expiresAt`, renova antes com `POST {url}/auth/v1/token?grant_type=refresh_token` e grava o par novo. Se a renovação der 400 ou 401, faz `store.save(nil)` e lança `.signedOut`.
  - `public struct MixMatch: Decodable, Equatable, Identifiable, Sendable`, com os campos de `list_my_watch_mix_matches` (Task 1) em camelCase, por `CodingKeys`; `id` = `matchID`.
  - `public struct ClaimResult: Decodable, Sendable { matchID: UUID; mySide: MixSide }`
  - `public struct OutboxEntry: Codable, Equatable, Sendable { mixMatchID: UUID; result: MixResult; createdAt: Date }`
  - `public actor ResultOutbox { init(fileURL: URL?); func put(_ e: OutboxEntry); func status(_ mixMatchID: UUID) -> OutboxStatus; func flush(using client: SupabaseClient) async }`, com `public enum OutboxStatus: Equatable, Sendable { case none, pending, sent, dropped(String) }`. O `put` substitui uma entrada do mesmo `mixMatchID`. O `flush` chama `save_mix_match_result` com `p_match_id`, `p_score_a`, `p_score_b`, `p_sets` (JSON de `[MixSet]` ou `NSNull`):
    - OK → `sent`;
    - `.server("not_allowed")`, `.server("empty")` ou qualquer outro `.server` → `dropped(code)`, sai da fila;
    - `.network`, `.signedOut` ou `.unavailable` → fica `pending`.

- [ ] **Step 1: Escrever os testes**, com um `FakeTransport` que guarda os pedidos e devolve respostas pré-definidas:
  - `testRPCSendsAuthHeaders`: um pedido a `rpc/list_my_watch_mix_matches` leva `apikey` e `Bearer <access>`.
  - `testRefreshesNearExpiry`: com `expiresAt = now + 30s`, o primeiro pedido é a `auth/v1/token?grant_type=refresh_token` com `{"refresh_token": …}`, e a store fica com os tokens novos.
  - `testRefreshRejectedSignsOut`: o refresh responde 400 → `.signedOut` e a store fica `nil`.
  - `testMissingRPCIsUnavailable`: 404 com `{"code":"PGRST202"}` → `.unavailable`.
  - `testServerErrorCode`: 400 com `{"message":"taken"}` → `.server("taken")`.
  - `testDecodeMixMatch`: um JSON de exemplo de Task 1 → `MixMatch`, com `mySide == .b` e `opponentNames.count == 2`.
  - `testOutboxReplacesSameMatch`: dois `put` com o mesmo id → um só pedido no `flush`, com o resultado do segundo.
  - `testOutboxDropsNotAllowed`: `{"message":"not_allowed"}` → `status == .dropped("not_allowed")`, e um segundo `flush` não faz nenhum pedido.
  - `testOutboxKeepsOnNetworkError`: o transport lança um erro → `pending`; o `flush` seguinte com 200 → `sent`.
  - `testOutboxPersists`: um `put` com `fileURL` temporário, uma `ResultOutbox` nova no mesmo ficheiro → `status == .pending`.

- [ ] **Step 2: Push; o job `scoring` falha a compilar os testes novos.** Se esse job só correr `swift test` sem filtro, apanha o target novo sozinho. Se tiver filtro, acrescentar `AlinhoSyncTests` em `.github/workflows/watch.yml`.

- [ ] **Step 3: Implementar os quatro ficheiros.** `SupabaseClient` não importa nada de watchOS, para compilar em macOS. O `args` vai para `JSONSerialization`. `MixResult` / `[MixSet]` codificam-se primeiro com `JSONEncoder` e depois `JSONSerialization.jsonObject`.

- [ ] **Step 4: Push; `scoring` passa (PadelScoringTests + AlinhoSyncTests), e o job `watch-app` continua a compilar.**

- [ ] **Step 5: Commit** (antes do push)

```bash
git add ios/AlinhoWatch/Package.swift ios/AlinhoWatch/Sources/AlinhoSync ios/AlinhoWatch/Tests/AlinhoSyncTests .github/workflows/watch.yml
git commit -m "feat(relógio): AlinhoSync — pedidos ao Supabase, renovação da sessão e fila do resultado"
```

---

### Task 5: iPhone, pedir e entregar a sessão do relógio

**Files:**
- Modify: `ios/App/App/WatchGamesPlugin.swift`: métodos novos no plugin e no `WatchGamesStore`
- Create: `src/lib/watchSession.js`
- Create: `src/lib/watchSession.test.js`
- Modify: `src/lib/watchGames.js`: no `web:` falso, os métodos novos sem efeito
- Modify: `src/contexts/AuthContext.jsx`: chamar `syncWatchSession` quando há sessão (no arranque e no `onAuthStateChange`) e `clearWatchSession` no `SIGNED_OUT`

**Interfaces:**
- Consumes: `watch-session` (Task 2).
- Produces:
  - Plugin `WatchGames`:
    - `watchSessionStatus() → {installed: boolean, sentUserId: string|null, needsSession: boolean}`. `installed` = `WCSession.default.isPaired && isWatchAppInstalled`. `needsSession` fica `true` quando chega do relógio um `userInfo` `{"kind":"needSession"}`.
    - `sendWatchSession({session: {access_token, refresh_token, expires_at, user_id}, supabaseUrl, anonKey})`: faz `updateApplicationContext(["session": …json…])`, guarda `sentUserId` e limpa `needsSession`.
    - `clearWatchSession()`: faz `updateApplicationContext(["session": NSNull-equivalente "none"])` e limpa `sentUserId`.
  - O `session(_:didReceiveUserInfo:)` que já existe passa a tratar primeiro `kind == "needSession"`. Os jogos continuam como estão.
  - `src/lib/watchSession.js`:
    - `export function shouldSendWatchSession({ installed, sentUserId, needsSession, userId, lastFailure })`: `true` se `installed && userId && (needsSession || sentUserId !== userId)` e se não houver `lastFailure === 'no_email'` para este `userId`.
    - `export async function syncWatchSession(userId)`: só se `hasWatchGames`. Lê o estado, decide, `supabase.functions.invoke('watch-session')` e `sendWatchSession`. Um `no_email` fica em `localStorage` (com `try/catch`) como `watchSession.noEmail = userId`. Nunca lança erros: só `console.error`.

- [ ] **Step 1: Escrever `src/lib/watchSession.test.js`**: os casos de `shouldSendWatchSession`:
  - não instalado → false;
  - instalado, `sentUserId` null → true;
  - mesmo user, sem `needsSession` → false;
  - mesmo user com `needsSession` → true;
  - outro user → true;
  - `lastFailure` `no_email` para este user → false.

- [ ] **Step 2: `npx vitest run src/lib/watchSession.test.js`**. Esperado: FAIL (o módulo não existe).

- [ ] **Step 3: Implementar `watchSession.js`, os métodos `web:` em `watchGames.js` e as chamadas em `AuthContext.jsx`.**

- [ ] **Step 4: `npx vitest run src/lib/watchSession.test.js` passa; `npm test` passa todo; `npm run build` passa.**

- [ ] **Step 5: Implementar o lado Swift em `WatchGamesPlugin.swift`.** Juntar os três `CAPPluginMethod` a `pluginMethods`. O `sentUserId` / `needsSession` ficam guardados no mesmo diretório do `watch-games.json`, num ficheiro `watch-session.json`. Corrigir aqui a verificação de `hasWatchGames` se for preciso. Verificar com «Actions → Relógio → Run workflow → ios-embed»: a app de iPhone compila.

- [ ] **Step 6: Commit**

```bash
git add ios/App/App/WatchGamesPlugin.swift src/lib/watchSession.js src/lib/watchSession.test.js src/lib/watchGames.js src/contexts/AuthContext.jsx
git commit -m "feat(relógio): o iPhone pede e entrega ao relógio uma sessão própria"
```

---

### Task 6: Relógio, «Jogos do mix», ficar com o jogo, contar e gravar no fim

**Files:**
- Create: `ios/AlinhoWatch/Sources/ScoreboardUI/KeychainCredentialStore.swift`: `CredentialStore` no Keychain (`kSecClassGenericPassword`, service `pt.alinho.watch.session`)
- Modify: `ios/AlinhoWatch/Sources/ScoreboardUI/WatchLink.swift`:
  - `session(_:didReceiveApplicationContext:)`: `"session"` com JSON → grava `WatchCredentials` com `expiresAt` a partir de `expires_at` em segundos; `"none"` → `save(nil)`;
  - ler também `receivedApplicationContext` ao ativar;
  - `requestSession()` manda `transferUserInfo(["kind":"needSession"])`.
- Create: `ios/AlinhoWatch/Sources/ScoreboardUI/MixModel.swift`: `@MainActor final class MixModel: ObservableObject`, com:
  - `@Published var matches: [MixMatch]`;
  - `@Published var state: enum { idle, loading, signedOut, unavailable, failed }`;
  - `func refresh()`, `func claim(_ m: MixMatch) async throws -> ClaimResult`;
  - o vínculo em curso `MixLink { localMatchID: UUID; mixMatchID: UUID; side: MixSide; title: String }`, guardado num ficheiro ao lado do `SessionStore.defaultURL`;
  - a `ResultOutbox` e `flush()`.
- Create: `ios/AlinhoWatch/Sources/ScoreboardUI/MixGamesView.swift`: a lista e o pormenor de um jogo
- Modify: `ios/AlinhoWatch/Sources/ScoreboardUI/SetupView.swift`: o botão «Jogos do mix»
- Modify: `ios/AlinhoWatch/Sources/ScoreboardUI/AppModel.swift`: `start(mix:)`; no `matchEnded()`, quando há `MixLink` para o jogo atual, `outbox.put` + `flush`, **em vez** de `sendToPhone`; o mesmo depois de um «Desfazer» que volte a acabar o jogo
- Modify: `ios/AlinhoWatch/Sources/ScoreboardUI/EndView.swift`: a linha de estado do envio
- Modify: `ios/AlinhoWatch/Sources/ScoreboardUI/Resources/Localizable.xcstrings`: os textos novos, em pt e en
- Modify: `ios/AlinhoWatch/Sources/ScoreboardUI/ScreenshotFixtures.swift`: as fixtures `mixList`, `mixTaken` e `endMixSent`

**Interfaces:**
- Consumes: `MixRules.config`, `MixResult(record:side:)` (Task 3); `SupabaseClient`, `MixMatch`, `ClaimResult`, `ResultOutbox`, `OutboxStatus`, `SyncError` (Task 4); o `applicationContext` de Task 5.

O que se vê (textos exatos):
- Em `SetupView`, por cima de «Começar»: o botão secundário **«Jogos do mix»**. Só aparece se houver credenciais e `state != .unavailable`. Sem credenciais, chama `WatchLink.shared.requestSession()` uma vez por arranque e não mostra o botão.
- Lista (`navigationTitle` «Jogos do mix»): uma linha por jogo, com **«Ronda N · Campo M»** e por baixo **«com Rita F. · contra Rui M. e Ana P.»** (nomes curtos com `shortName`, igual à web: o primeiro nome e a inicial do último). Vazia: **«Sem jogos do mix a decorrer.»** `.signedOut`: **«Abre o alinho no iPhone para ligar o relógio.»** `.failed`: **«Sem ligação. Tenta outra vez.»** com o botão **«Tentar outra vez»**.
- Pormenor: o formato (`MatchFormat.title`) e as duplas.
  - Se `MixRules.config` der `nil`: **«Este mix não dá para contar no relógio.»** e nenhum botão.
  - Se `scorerID` for outro: **«A ser contado por {scorerName}.»** e nenhum botão.
  - Nos outros casos: o `PrimaryButton` **«Começar»** → `claim`. OK → `model.setConfig(config)` + `model.start(mix:)`. `.server("taken")` → recarrega e mostra o texto de cima. Outro erro → **«Não deu para começar. Tenta outra vez.»**
- `EndView`, só nos jogos do mix, debaixo do resultado:
  - `.sent` → **«Gravado no mix ✓»**;
  - `.pending` → **«A enviar para o mix…»**;
  - `.dropped("not_allowed")` → **«O mix já fechou. Pede ao admin para meter o resultado.»**;
  - outro `.dropped` → **«O mix recusou o resultado. Pede ao admin para o meter.»**
- Fila: `flush()` ao acabar o jogo, ao abrir a app (`RootView.task`) e de 30 em 30 s enquanto houver `pending` (no ciclo que o `RootView` já tem de 2 em 2 s, contando o tempo).

- [ ] **Step 1: Implementar `KeychainCredentialStore` e as mudanças ao `WatchLink`.**
- [ ] **Step 2: Implementar `MixModel` e `MixGamesView`, e ligá-los no `SetupView`.**
- [ ] **Step 3: `AppModel.start(mix:)`, o desvio no `matchEnded()` e o estado no `EndView`.**
- [ ] **Step 4: Textos em `Localizable.xcstrings` (pt e en) e as três fixtures.**
- [ ] **Step 5: Push; os jobs `scoring` e `watch-app` passam.** Correr «Run workflow → screenshots» e ver as prints `mixList`, `mixTaken` e `endMixSent`, em 41 e 45 mm, em pt e en: nada cortado.
- [ ] **Step 6: Commit** (antes do push do Step 5)

```bash
git add ios/AlinhoWatch/Sources/ScoreboardUI
git commit -m "feat(relógio): jogos do mix — ficar com o jogo, contar e gravar no fim"
```

---

### Task 7: Ensaio de ponta a ponta no dev e documentação

**Files:**
- Modify: `FEATURES.md`: a secção do relógio, com «Jogos do mix (Fase A)»
- Modify: `docs/native-apps.md`: o deploy da `watch-session` e o `applicationContext` da sessão

- [ ] **Step 1: Build no Codemagic (à mão) e instalar no relógio e no iPhone de teste.**
- [ ] **Step 2: Ensaio no dev**, com um mix de 1 campo e 4 contas, duas delas com relógio (ou uma com relógio e a outra a tentar pela RPC no SQL Editor). Confirmar:
  1. o relógio de B1 mostra o jogo, B1 carrega «Começar» e o marcador abre no formato do mix;
  2. o outro vê «A ser contado por B1»;
  3. B1 joga até ao fim e o `GameDetails` mostra o resultado na orientação certa, com «marcado por B1»;
  4. B1 carrega «Desfazer», acaba outra vez com outro resultado e o `GameDetails` mostra o novo;
  5. com o iPhone em modo de voo, acabar outro jogo → «A enviar para o mix…»; tirar o modo de voo → «Gravado no mix ✓» em ≤ 30 s;
  6. o admin fecha o mix com um resultado na fila → «O mix já fechou…».
- [ ] **Step 3: Atualizar `FEATURES.md` e `docs/native-apps.md`; commit e push para `dev`.**

```bash
git add FEATURES.md docs/native-apps.md
git commit -m "docs: relógio no mix, Fase A"
```

- [ ] **Step 4: Antes de qualquer push para `main`:** a migração `migration_relogio_mix_a.sql` corrida em produção (`subiamucdrhxsxuippmy`) e a `watch-session` com deploy em produção. Confirmar as duas, não assumir.
