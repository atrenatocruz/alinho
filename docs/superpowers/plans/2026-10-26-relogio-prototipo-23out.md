# Relógio do alinho: protótipo de 23 out, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Levar o marcador do Apple Watch (Fase 1, já feita) até ao protótipo aprovado a 23 out, com o modo Pontos a contar jogos de 0-15-30-40, e depois ligar o relógio à app iPhone («Os meus números») e ao registo de jogos entre amigos.

**Architecture:** Três fases, cada uma entregável sozinha. **A** mexe só no pacote `ios/AlinhoWatch` (regras puras em `PadelScoring`, testadas com `swift test`; ecrãs em `ScoreboardUI`, dentro de `#if os(watchOS)`). **B** junta `WatchConnectivity` no relógio, um plugin Capacitor em Swift na app iOS que guarda os jogos num ficheiro, e uma página web nova com estatísticas calculadas em funções puras (testadas com vitest). **C** usa as RPCs de jogos entre amigos que já existem e acrescenta uma migração para desafios.

**Tech Stack:** Swift 5.10+, SwiftUI, watchOS 10+, Swift Testing, HealthKit (`HKWorkoutSession` + `HKLiveWorkoutBuilder`), WatchConnectivity, Capacitor 8 (iOS, SPM), React + Vite + Tailwind, vitest, Supabase (Postgres + RLS).

**Spec:** `docs/superpowers/specs/2026-10-26-relogio-prototipo-23out-design.md` (por cima de `docs/superpowers/specs/2026-10-22-apple-watch-marcador-fase1-design.md`). Protótipo: https://claude.ai/artifact/PmzAm5WTHVY48KY9BczyLD (o `<script>` tem as regras: `point`, `pointLabels`, `bigPoint`, `topLine`, `serveInfo`, `reServe`, `renderPhone`).

## Global Constraints

- Fases A e B: só no branch `feature/apple-watch` (worktree `C:\Users\Renato Cruz\padeleirosrobot-watch`). Push para `origin feature/apple-watch`. **Nunca** juntar ao `dev` nem ao `main` sem o Renato dizer. A Fase C (migração + web) também nasce neste branch, porque a página só existe com o relógio.
- Commits sem linha de atribuição ao Claude (preferência do Renato).
- watchOS 10.0 mínimo; o que só existe em watchOS 11 fica atrás de `if #available(watchOS 11, *)`.
- Textos pt-PT (base) e en no String Catalog do relógio e no i18n da app web; a chave é o texto em português. **Sem «—» em nenhum texto.** Textos exatos: os da spec.
- Cores e letra: as da spec da Fase 1 (lima `#C5DD01`, «Eles» `#D9DCE0`, tinta `#040404`, vermelho `#FF6B5E`, listas `#1D1E21`, secundário `#9EA3AA`, âmbar da pausa `#F5B83D`; números em Outfit 900).
- `HoldDuration.seconds = 0.7` continua a ser a única constante do toque comprido.
- **A saúde (pulsação, kcal, esforço) nunca sai do iPhone**: não vai ao Supabase nem aos amigos.
- **Nada inventado na app**: os meses de exemplo do protótipo (`PAST`, `FRIENDS`, «Maré Alta Padel») não vão para o código de produção.
- Compatibilidade: a app iOS e o relógio ficam semanas em versões antigas. O JSON gravado no relógio e o que vai para o iPhone têm `version` e decodificam campos novos com `decodeIfPresent`; uma migração SQL nunca parte uma versão antiga da app.
- Migrações: ficheiro em `supabase/`, corre-se à mão (dev primeiro, prod depois), e diz-se sempre que falta correr.
- Verificar o pacote com `swift test` e a app com `.github/workflows/watch.yml`; a web com `npm test` e `npm run build`. Não há Mac local.

## Review Focus

1. **Atualizar a app com um jogo de Pontos antigo a meio** (pontos corridos 15-9 gravados no disco): abre sem rebentar, esse jogo fica terminado e nos Últimos jogos como «15-9». Teste: Task A1, `legacyRallyPointsMatchIsArchivedOnLoad`.
2. **Desfazer em cadeia através das ações do menu** (pausa → acertar → mudar quem serve → ponto → mudar o 40-40): cada desfazer dá o estado exato de antes, incluindo `pausedAt`, quem serve na nossa dupla e o `nextDeuceMode`. Teste: Task A4, `undoWalksBackThroughMenuActions`.
3. **Pontos no último jogo da ronda** (11-12 com total 24, 40-40 em ponto de ouro): esse ponto acaba a ronda e mostra «Ponto de jogo»; 12-12 dá «Empatado»; sem total nunca acaba. Teste: Task A1, `pointsRoundLastGame`, e Task A3, `matchPointInPointsRound`.
4. **Pulso em baixo, a manga a tocar**: um toque comprido que começa com o ecrã escurecido, ou nos 0,4 s depois de acordar, não conta. Teste: Task A7, `wakeGuardIgnoresHoldFromDimmedScreen`.
5. **O mesmo jogo chega duas vezes ao iPhone** (o `transferUserInfo` repete, e o esforço chega depois do jogo): fica um só jogo, atualizado. Teste: Task B3, `mergeGame replaces by id and keeps newest`.

---

## Estrutura de ficheiros

```
ios/AlinhoWatch/Sources/PadelScoring/
  Model.swift          + Player, PointsScoring, MatchConfig.ourFirstServer/layout, MatchState: deuceMode, nextDeuceMode,
                         ourServer, pausedAt, pausedSeconds, lastPointAt, pointsScoring, hasPoints
  Scoring.swift        Pontos por jogos; servidor por jogador; pause/resume/setServer/setNextDeuceMode/correct
  Display.swift        ServeInfo, StatusLabel .paused/.setPoint/.matchPoint/.gamesRound, elapsed
  Session.swift        ações do menu com desfazer; não arquiva jogos sem pontos; isForgotten; effort/health no registo
  SessionStore.swift   migração do Pontos antigo ao carregar
  WakeGuard.swift      (novo) regra do primeiro toque com o pulso em baixo
  WatchGamePayload.swift (novo, Fase B) o que vai para o iPhone
ios/AlinhoWatch/Tests/PadelScoringTests/
  PointsGamesTests.swift  ServeTests.swift  StatusTests.swift  MenuActionsTests.swift  RecordTests.swift
  WakeGuardTests.swift  PayloadTests.swift   (+ ajustes nos existentes)
ios/AlinhoWatch/Sources/ScoreboardUI/
  SetupView.swift  ScoreboardView.swift  GameMenuView.swift  EndView.swift  RootView.swift  AppModel.swift
  Haptics.swift  Strings.swift  ScreenshotFixtures.swift
  WorkoutKeeper.swift → WorkoutRecorder.swift (HKLiveWorkoutBuilder)
  CorrectScoreView.swift  ConfirmEndView.swift  IdleView.swift  EffortView.swift  TrainingView.swift  (novos)
  WatchLink.swift (novo, Fase B)
ios/App/App/
  WatchGamesPlugin.swift  WatchGamesStore.swift  AlinhoBridgeViewController.swift   (novos, Fase B)
src/lib/watchGames.js  src/lib/watchStats.js  src/lib/watchStats.test.js  src/lib/watchGames.test.js
src/pages/MeusNumeros.jsx  src/components/numeros/{JogosTab,StatsTab,DesafiosTab,RegistarJogo}.jsx
supabase/migration_relogio_desafios.sql
docs/native-apps.md
```

---

# Fase A: só relógio

### Task A1: Pontos passa a jogos sem sets

**Files:**
- Modify: `ios/AlinhoWatch/Sources/PadelScoring/Model.swift`, `Scoring.swift`, `Display.swift`, `Session.swift`, `SessionStore.swift`
- Test: Create `ios/AlinhoWatch/Tests/PadelScoringTests/PointsGamesTests.swift`; modify `PointsAndStopTests.swift` (os dois testes de Pontos antigos passam para jogos)

**Interfaces:**
- Produces: `enum PointsScoring: String, Codable { case rally, games }`; `MatchState.pointsScoring: PointsScoring` (decode sem o campo = `.rally`; `newMatch` põe `.games`); na fase `.points` com `.games`, `points` são os pontos do jogo (como na fase `.game`) e `games` os jogos da ronda; `MatchRecord.games: [Int]` (decode sem o campo = `[]`); `StatusLabel.gamesRound(us: Int, them: Int, total: Int?)` substitui `.points(total:)` para jogos novos (`.points` fica só para registos antigos).

- [ ] **Step 1: Write the failing tests**

```swift
@Test func pointsRoundCountsGamesWith15_30_40() {
    let (s, _) = play(match(.points, total: 24), "uu t")
    #expect(s.display == ScoreDisplay(us: .value("30"), them: .value("15"), status: .gamesRound(us: 0, them: 0, total: 24)))
    let (g, ev) = games(match(.points, total: 24), "uuu")
    #expect(g.games == [3, 0] && g.points == [0, 0] && g.sets.isEmpty && g.phase == .points)
    #expect(ev[0].contains(.gameWon) && ev[0].contains(.switchSides))   // 1.º jogo: ímpar
}
@Test func pointsRoundUsesDeuceMode() {
    let (s, ev) = play(match(.points, .golden, total: 24), "uuuttt")
    #expect(s.display.status == .goldenPoint && ev.last!.contains(.decisivePoint))
    let (adv, _) = play(match(.points, .advantage, total: 24), "uuuttt u")
    #expect(adv.display.us == .advantage)
}
@Test func pointsRoundLastGame() {
    let (s, _) = games(match(.points, total: 24), String(repeating: "ut", count: 11) + "u")   // 12-11
    let (end, ev) = games(s, "t")                                                             // 12-12
    #expect(end.isOver && end.winner == nil && end.resultText == "12-12" && ev.last!.contains(.matchOver))
    let (win, _) = games(match(.points, total: 16), String(repeating: "u", count: 9) + String(repeating: "t", count: 7))
    #expect(win.isOver && win.winner == .us && win.resultText == "9-7")
}
@Test func pointsWithoutTotalNeverEnds() {
    let (s, _) = games(match(.points, total: nil), String(repeating: "u", count: 60) + String(repeating: "t", count: 50))
    #expect(!s.isOver && s.games == [60, 50])
}
@Test func pointsServerRotatesPerGame() {
    let (s, _) = games(match(.points, server: .us, total: 24), "u")
    #expect(s.server == .them)
}
@Test func stopPointsRoundCountsClosedGamesOnly() {
    let (s, _) = games(match(.points, total: 24), "uut")
    let stopped = Scoring.stop(play(s, "tt").0, at: t0)
    #expect(stopped.resultText == "2-1" && stopped.winner == .us)
}
@Test func legacyRallyPointsMatchIsArchivedOnLoad() throws {
    // JSON gravado pela Fase 1: Pontos a meio com 15-9 corridos, sem `pointsScoring`.
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".json")
    try legacyPointsSessionJSON(points: [15, 9]).write(to: url)
    let session = SessionStore(fileURL: url).load()
    #expect(session.current == nil)
    #expect(session.history.first?.resultText == "15-9" && session.history.first?.endReason == .stopped)
}
```

`legacyPointsSessionJSON` vai para `Helpers.swift`: codifica uma `MatchSession` com um jogo de Pontos e apaga a chave `pointsScoring` do `current` com `JSONSerialization`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ios/AlinhoWatch && swift test --filter "PointsGames|PointsAndStop"` (no CI: `.github/workflows/watch.yml`)
Expected: FAIL (`gamesRound` e `pointsScoring` não existem).

- [ ] **Step 3: Implement**

- `Scoring.point`: fase `.points` com `.games` usa `gamePoint`, e `winGame` nessa fase soma o jogo, roda o servidor, avisa troca nos jogos ímpares (`(games[0]+games[1]) % 2 == 1`) e acaba quando `config.pointsTotal` existe e `games[0]+games[1] >= total`; nunca fecha sets nem entra em tie-break. Com `.rally`, o comportamento antigo fica igual (só para decodificar).
- `newMatch`: nos Pontos o `server` passa a ser `config.firstServer` (deixa de ser `nil`).
- `finish` e `resultText` nos Pontos `.games` usam `games`; `.rally` continua com `points`. `setsLine` nos Pontos: `"\(games[0])-\(games[1])"`.
- `display` na fase `.points` `.games`: os valores 0/15/30/40/Vant. e os estados do 40-40 como na fase `.game`; sem estado do 40-40, `.gamesRound(us:them:total:)`.
- `SessionStore.load()`: se `current` é Pontos `.rally` e não acabou, `MatchSession.retireLegacyPoints(at: Date())` faz `stop` e arquiva (com `resultText` antigo).
- `Strings.swift`: `.gamesRound(a, b, nil)` → «Jogos \(a)-\(b)»; com total → «Jogos \(a)-\(b) · até \(total)».

- [ ] **Step 4: Run tests to verify they pass** (`swift test`, todos verdes, incluindo os antigos)

- [ ] **Step 5: Commit** `feat(relógio): Pontos conta jogos de 0-15-30-40, sem sets`

### Task A2: Quem serve por jogador e de que lado

**Files:**
- Modify: `Model.swift`, `Scoring.swift`, `Display.swift`
- Test: Create `Tests/PadelScoringTests/ServeTests.swift`; `Helpers.swift` ganha `first: Player = .me` em `match(...)`

**Interfaces:**
- Produces: `enum Player: String, Codable { case me = "eu", partner = "parceiro" }`; `MatchConfig.ourFirstServer: Player` (default `.me`, `decodeIfPresent`); `MatchState.ourServer: Player?` (quem da nossa dupla serve quando `server == .us`), `MatchState.lastOurServer: Player?`; `struct ServeInfo: Equatable { let us: ServeLabel?; let them: Bool }` com `enum ServeLabel: Equatable { case player(Player, Side) }`, `enum Side { case right, left }`; `MatchState.serveInfo: ServeInfo?` (`nil` quando `server == nil`).

- [ ] **Step 1: Write the failing tests**

```swift
@Test func ourPairAlternatesServer() {
    var (s, _) = games(match(server: .us, first: .partner), "")
    #expect(s.serveInfo == ServeInfo(us: .player(.partner, .right), them: false))
    (s, _) = games(s, "u")                       // servem eles
    #expect(s.serveInfo == ServeInfo(us: nil, them: true))
    (s, _) = games(s, "t")                       // voltamos a servir: o outro
    #expect(s.ourServer == .me)
}
@Test func serveSideFollowsPointParity() {
    let (s, _) = play(match(server: .us), "u")
    #expect(s.serveInfo?.us == .player(.me, .left))
    let (t, _) = play(match(server: .us), "ut")
    #expect(t.serveInfo?.us == .player(.me, .right))
}
@Test func tieBreakAlternatesOurPlayers() {
    // 6-6 com Nós a abrir o tie-break: 1.º ponto eu; pontos 4-5 voltamos com o parceiro.
    let (s, _) = games(match(server: .us), "ut ut ut ut ut ut")
    let (tb, _) = play(s, "uuu")
    #expect(tb.server == .us && tb.ourServer == .partner)
}
```

- [ ] **Step 2: Run tests to verify they fail** (`swift test --filter ServeTests`)
- [ ] **Step 3: Implement** um único ponto de mudança `mutating func setServer(_ team: Team)` em `MatchState` (porta do `setServer` do protótipo: ao passar para `.us` vindo de `.them`, `ourServer` = o contrário de `lastOurServer`, ou `config.ourFirstServer` na primeira vez). Todas as mudanças de `server` em `Scoring` passam por ele. Lado: soma dos pontos do jogo (ou do tie-break) par = `.right`.
- [ ] **Step 4: Run tests to verify they pass** (todos)
- [ ] **Step 5: Commit** `feat(relógio): quem serve na nossa dupla e de que lado`

### Task A3: Linha de estado: pausa, ponto de set, ponto de jogo, minutos

**Files:**
- Modify: `Model.swift`, `Display.swift`
- Test: Create `Tests/PadelScoringTests/StatusTests.swift`

**Interfaces:**
- Consumes: `MatchState.pausedAt` (Task A4 define o campo; esta task cria-o já como `Date?` com `decodeIfPresent`) e `pausedSeconds: TimeInterval`.
- Produces: `StatusLabel.paused`, `.setPoint`, `.matchPoint`; `MatchState.statusLine: StatusLabel?` com a prioridade da spec (pausa > 40-40 > ponto de jogo > ponto de set > tie-break > `nil` = `setsLine`; nos Pontos o fim é `.gamesRound`); `MatchState.elapsed(at: Date) -> TimeInterval` (sem as pausas); `minutesText(_ seconds: TimeInterval) -> String` («23 min»).

- [ ] **Step 1: Write the failing tests**

```swift
@Test func setPointAndMatchPoint() {
    let (s, _) = games(match(), "uuuuu")                 // 5-0, 0-0
    #expect(play(s, "uuu").0.statusLine == .setPoint)   // 40-0 a 5-0
    let (m, _) = games(match(), "uuuuuu uuuuu")          // 1 set, 5-0
    #expect(play(m, "uuu").0.statusLine == .matchPoint)
}
@Test func matchPointInPointsRound() {
    let (s, _) = games(match(.points, total: 24), String(repeating: "ut", count: 11) + "u")
    #expect(play(s, "uuu").0.statusLine == .matchPoint)
}
@Test func deuceLabelBeatsSetPoint() {
    let (s, _) = games(match(), "uuuuu")
    #expect(play(s, "uuuttt").0.statusLine == .goldenPoint)
}
@Test func elapsedSkipsPauses() {
    var s = match()
    s.pausedSeconds = 300
    #expect(s.elapsed(at: t0.addingTimeInterval(1500)) == 1200)
    s.pausedAt = t0.addingTimeInterval(1400)
    #expect(s.elapsed(at: t0.addingTimeInterval(1500)) == 1100)
    #expect(s.statusLine == .paused)
}
```

- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Implement** `statusLine` simulando um ponto para cada lado com `Scoring.point` (como o `bigPoint` do protótipo): `matchOver` → `.matchPoint`; `setWon` → `.setPoint`. `Strings.swift`: «Em pausa», «Ponto de set», «Ponto de jogo».
- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Commit** `feat(relógio): ponto de set, ponto de jogo, pausa e minutos de jogo`

### Task A4: Ações a meio do jogo, com desfazer

**Files:**
- Modify: `Scoring.swift`, `Session.swift`, `Model.swift`
- Test: Create `Tests/PadelScoringTests/MenuActionsTests.swift`

**Interfaces:**
- Produces, em `MatchSession` (cada uma empilha o estado anterior no `undoStack`, grava `lastPointAt` só nos pontos):
  - `mutating func togglePause(at: Date)`
  - `mutating func setServer(_ team: Team, player: Player?)` («Vale do próximo ponto em diante»; `player` só com `.us`)
  - `mutating func setNextDeuceMode(_ mode: DeuceMode)` (igual ao atual → limpa `nextDeuceMode`)
  - `mutating func correct(games: [Int], points: [Int])` (só no jogo/tie-break a decorrer)
  - `var hasPoints: Bool` em `MatchState`; `func isForgotten(at: Date) -> Bool` em `MatchSession` (20 min desde `lastPointAt ?? startedAt`, nunca em pausa)
- `MatchState.deuceMode` passa a `var` no estado (inicializado de `config.deuceMode`; `decodeIfPresent`, senão `config.deuceMode`); `nextDeuceMode: DeuceMode?` aplica-se no `winGame`. `Scoring` lê sempre `st.deuceMode`, nunca `config.deuceMode`.
- Um ponto com o jogo em pausa tira a pausa primeiro (soma a `pausedSeconds`).
- Arquivar: só se `hasPoints`. «Terminar» um jogo sem pontos limpa-o sem ir aos Últimos jogos.

- [ ] **Step 1: Write the failing tests**

```swift
@Test func deuceModeChangeWaitsForNextGame() {
    var ses = session(started: match(.bestOf3, .golden))
    ses.point(.us, at: t0); ses.setNextDeuceMode(.advantage)
    #expect(ses.current!.deuceMode == .golden && ses.current!.nextDeuceMode == .advantage)
    for _ in 0..<3 { ses.point(.us, at: t0) }
    #expect(ses.current!.deuceMode == .advantage && ses.current!.nextDeuceMode == nil)
}
@Test func correctRecomputesServerAndStarCount() {
    var ses = session(started: match(.bestOf3, .starPoint, server: .us))
    ses.correct(games: [3, 2], points: [3, 3])
    #expect(ses.current!.server == .them && ses.current!.deuceCount == 1)   // 5 jogos jogados: ímpar
}
@Test func gameWithoutPointsIsNotArchived() {
    var ses = session(started: match())
    ses.stop(at: t0)
    #expect(ses.history.isEmpty)
}
@Test func forgottenAfter20MinutesUnlessPaused() {
    var ses = session(started: match())
    ses.point(.us, at: t0)
    #expect(!ses.isForgotten(at: t0.addingTimeInterval(19 * 60)))
    #expect(ses.isForgotten(at: t0.addingTimeInterval(20 * 60)))
    ses.togglePause(at: t0.addingTimeInterval(60))
    #expect(!ses.isForgotten(at: t0.addingTimeInterval(40 * 60)))
}
@Test func undoWalksBackThroughMenuActions() {
    var ses = session(started: match(.bestOf3, .golden, server: .us))
    var snapshots = [ses.current!]
    ses.point(.us, at: t0);                         snapshots.append(ses.current!)
    ses.togglePause(at: t0);                        snapshots.append(ses.current!)
    ses.correct(games: [2, 1], points: [1, 0]);     snapshots.append(ses.current!)
    ses.setServer(.us, player: .partner);           snapshots.append(ses.current!)
    ses.point(.them, at: t0);                       snapshots.append(ses.current!)
    ses.setNextDeuceMode(.starPoint)
    while ses.undo() { #expect(ses.current == snapshots.popLast()) }
    #expect(snapshots.isEmpty)
}
```

`session(started:)` vai para `Helpers.swift` (cria uma `MatchSession` com esse jogo a decorrer; pode precisar de um `init` interno em `MatchSession`).

- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Implement** (porta do `reServe` do protótipo para `correct`: servidor pelo n.º de jogos jogados desde o início, a contar um super tie-break como 1; na nossa dupla, `ours % 2` decide eu / parceiro). Limites do `correct`: jogos 0...12; pontos 0...40 em tie-break, senão 0...4 com «só um lado em vantagem e só com o outro a 3».
- [ ] **Step 4: Run tests to verify they pass** (todos)
- [ ] **Step 5: Commit** `feat(relógio): pausa, acertar, mudar quem serve e 40-40 a meio, com desfazer`

### Task A5: Registo do jogo com esforço e treino

**Files:**
- Modify: `Session.swift`
- Test: Create `Tests/PadelScoringTests/RecordTests.swift`

**Interfaces:**
- Produces: `MatchRecord` ganha `version: Int` (= 2), `minutes: Int`, `effort: Int?`, `averageHeartRate: Int?`, `activeKilocalories: Int?`, `games: [Int]` (A1); todos `decodeIfPresent` (um registo da Fase 1 decodifica com `version` 1). `mutating func setEffort(_ value: Int, for id: UUID)` (1...10, fora disso ignora); `mutating func setHealth(averageHeartRate: Int?, kilocalories: Int?, for id: UUID)`. `func effortLabel(_ v: Int) -> EffortLabel` com `enum EffortLabel { case easy, moderate, hard, max }` (1-3, 4-6, 7-8, 9-10).

- [ ] **Step 1: Write the failing tests**: `phase1RecordStillDecodes` (JSON sem os campos novos → `version == 1`, `effort == nil`); `effortIsClampedAndStored` (`setEffort(7)` guarda 7; `setEffort(11)` não muda); `effortLabels` (`3 → .easy`, `4 → .moderate`, `8 → .hard`, `9 → .max`); `minutesExcludePauses` (jogo com 300 s de pausa em 1500 s → `minutes == 20`).
- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run to verify they pass**
- [ ] **Step 5: Commit** `feat(relógio): esforço, minutos e treino no registo do jogo`

### Task A6: Novo jogo

**Files:**
- Modify: `ios/AlinhoWatch/Sources/ScoreboardUI/SetupView.swift`, `Strings.swift`, `Resources/Localizable.xcstrings`, `Model.swift` (`MatchConfig.layout: ScoreLayout` com `enum ScoreLayout: String, Codable { case side, stack }`, `decodeIfPresent` = `.side`)

**Interfaces:**
- Consumes: `MatchConfig.ourFirstServer` (A2), `layout`.

- [ ] **Step 1:** Linhas pela ordem da spec: Formato; «Aos 40-40» (sempre); nos Pontos também «Total da ronda» («16 jogos», «24 jogos», «32 jogos», «Sem total»; a linha diz «Total: 24 jogos»); «Quem serve» (sempre); «Na nossa dupla, serve primeiro» só com `firstServer == .us`, e escolher «Nós» abre logo essa lista; «Marcador» com o desenho pequeno dos dois blocos; «Começar»; «Últimos jogos» (abre `HistoryView`). Ajudas por baixo das listas com os textos da spec.
- [ ] **Step 2:** `swift test` continua verde; o workflow `watch.yml` compila e tira a print `setup` (acrescentar fixtures `setupPoints` e `setupServeUs` em `ScreenshotFixtures.swift`).
- [ ] **Step 3: Commit** `feat(relógio): Novo jogo com 40-40 nos Pontos, quem serve na dupla e arrumação`

### Task A7: Marcador e proteções

**Files:**
- Create: `ios/AlinhoWatch/Sources/PadelScoring/WakeGuard.swift`, `Tests/PadelScoringTests/WakeGuardTests.swift`
- Modify: `ScoreboardView.swift`, `HoldButton.swift`, `Haptics.swift`, `AppModel.swift`

**Interfaces:**
- Produces: `struct WakeGuard { static let settle: TimeInterval = 0.4; static func allowsHold(dimmedAtStart: Bool, startedAt: Date, wokeAt: Date?) -> Bool }`; `Haptic.pointUs` (um toque) e `Haptic.pointThem` (dois toques com 120 ms entre eles) substituem `.counted`.

- [ ] **Step 1: Write the failing test**

```swift
@Test func wakeGuardIgnoresHoldFromDimmedScreen() {
    #expect(!WakeGuard.allowsHold(dimmedAtStart: true, startedAt: t0, wokeAt: nil))
    #expect(!WakeGuard.allowsHold(dimmedAtStart: false, startedAt: t0.addingTimeInterval(0.3), wokeAt: t0))
    #expect(WakeGuard.allowsHold(dimmedAtStart: false, startedAt: t0.addingTimeInterval(0.5), wokeAt: t0))
}
```

- [ ] **Step 2: Run to verify it fails; Step 3: implement `WakeGuard`; Step 4: run to verify it passes**
- [ ] **Step 5: Ecrã.** Topo: pílula «↺ Desfazer» (dedo pousado, enche da esquerda) à esquerda, hora à direita. Por baixo: `statusLine` (lima quando é um estado, âmbar em pausa) e `minutesText(elapsed)` à direita. Blocos lado a lado ou um por cima do outro (`stack`: Eles em cima, Nós em baixo; o enchimento passa a ser da esquerda). No bloco de quem serve: com `side`, bola e «Tu · direita» / «Parceiro · esquerda» / «Servem» em baixo; com `stack`, bola ao lado do nome e o texto por baixo. `HoldButton`: guarda `isLuminanceReduced` no início do toque e a hora a que o ecrã acordou (`onChange` de `isLuminanceReduced` no `AppModel`); se `WakeGuard` disser que não, não começa a encher; arrastar mais de 24 pt cancela. Pulso em baixo: sem pílula, só blocos escurecidos.
- [ ] **Step 6:** Fixtures novas `scoreStack`, `scoreServeSide`, `scorePaused`, `scoreMatchPoint`; workflow verde com as prints.
- [ ] **Step 7: Commit** `feat(relógio): marcador do protótipo, quem serve no bloco e primeiro toque só acorda`

### Task A8: Segundo ecrã, acertar, terminar e jogo esquecido

**Files:**
- Create: `CorrectScoreView.swift`, `ConfirmEndView.swift`, `IdleView.swift`
- Modify: `GameMenuView.swift`, `RootView.swift`, `AppModel.swift`, `OptionListView.swift`, `Strings.swift`

**Interfaces:**
- Consumes: as ações de `MatchSession` da Task A4; `isForgotten(at:)`.
- Produces: `AppModel.page` com 0 = menu, 1 = marcador, 2 = treino (a ordem do protótipo; o jogo abre na 1); `AppModel.returnToScoreboardAfterIdle()` (10 s sem mexer fora da página 1 → página 1); `AppModel.checkForgotten()` chamado a cada minuto por um `Timer` enquanto há jogo.

- [ ] **Step 1: Menu** com o resultado ao vivo («6-4 · 3-2 · 30-15», nos Pontos «Jogos 5-3 · 30-15») e «23 min de jogo», depois Pausar/Continuar, Acertar o marcador, Mudar quem serve (só com `server != nil`), Aos 40-40 (com «a partir do próximo jogo» quando há `nextDeuceMode`), Últimos jogos, Terminar o jogo (dedo pousado → `ConfirmEndView`, que troca o `.alert` atual).
- [ ] **Step 2: `CorrectScoreView`**: grelha Jogos/Pontos × Nós/Eles (nos tie-breaks e super os pontos são números; nos Pontos e jogos, 0/15/30/40/Vant.), seleção com toque, valor com `digitalCrownRotation`, «Toca num número e roda a coroa.», Guardar → `correct(...)`. Os limites vêm da Task A4: a vista só envia o que o pacote aceita.
- [ ] **Step 3: `IdleView`** e o regresso de 10 s; o aviso do jogo esquecido vibra uma vez.
- [ ] **Step 4:** Fixtures `menu`, `correct`, `confirmEnd`, `idle`; workflow verde.
- [ ] **Step 5: Commit** `feat(relógio): segundo ecrã do protótipo, acertar o marcador e jogo esquecido`

### Task A9: Treino no Saúde

**Files:**
- Create: `ios/AlinhoWatch/Sources/ScoreboardUI/WorkoutRecorder.swift` (substitui `WorkoutKeeper.swift`, que se apaga), `TrainingView.swift`
- Modify: `AppModel.swift`, `RootView.swift`, `ios/AlinhoWatch/App/Info.plist` (`NSHealthShareUsageDescription`, `NSHealthUpdateUsageDescription`, pt e en no `InfoPlist.xcstrings`)

**Interfaces:**
- Produces: `@MainActor final class WorkoutRecorder: ObservableObject` com `@Published heartRate: Int?`, `averageHeartRate: Int?`, `kilocalories: Double`, `authorized: Bool?`; `func begin(matchID: UUID) async`, `func pause()`, `func resume()`, `func finish(match: MatchRecord) async` (guarda o treino com metadados `alinho.match.id`, `alinho.result` e devolve os totais para `setHealth`), `func discard()` (jogo sem pontos); `static let zoneLimits = [110, 125, 140, 155]` e `func zone(_ bpm: Int) -> Int` (1...5).
- Autorização: partilhar `workoutType`; ler `heartRate` e `activeEnergyBurned`. Recusada: o jogo continua, a página Treino mostra o texto da spec, os totais ficam `nil`.
- Recuperar depois de a app fechar: `HKHealthStore.recoverActiveWorkoutSession()` no arranque com jogo a decorrer.

- [ ] **Step 1:** `WorkoutRecorder` com `HKLiveWorkoutBuilder` + `HKLiveWorkoutDataSource`; pausa e retoma seguem `togglePause`; desfazer o fim do jogo antes de guardar o treino retoma-o (a gravação só acontece em «Novo jogo» ou ao sair do ecrã de fim, para o desfazer do fim não deixar um treino duplicado).
- [ ] **Step 2:** `TrainingView` (página 2): mm:ss, ♥ bpm, kcal, bpm médio, cinco barras de zona.
- [ ] **Step 3:** Fixtures `training`, `trainingDenied`; workflow verde.
- [ ] **Step 4: Commit** `feat(relógio): treino gravado no Saúde com pulsação e calorias`

### Task A10: Esforço e ecrã de fim

**Files:**
- Create: `EffortView.swift`
- Modify: `EndView.swift`, `RootView.swift`, `AppModel.swift`, `HistoryView.swift`, `Strings.swift`

**Interfaces:**
- Consumes: `setEffort`, `effortLabel` (A5); `WorkoutRecorder.finish` (A9).
- Produces: `AppModel.endStep: EndStep?` com `enum EndStep { case effort, summary }`; jogo acabado com pontos abre em `.effort`.

- [ ] **Step 1: `EffortView`**: «Quão duro foi?», «Roda a coroa», número em grande, etiqueta, dez barras, Guardar / Saltar. Em watchOS 11+, Guardar também relaciona um `workoutEffortScore` com o treino.
- [ ] **Step 2: `EndView`** com os textos da spec («Ganhámos» / «Ganharam eles» / «Empatado»), linha de saúde só com valores, Novo jogo, Últimos jogos, ↺ Desfazer (dedo pousado, volta ao jogo e apaga o registo), «Para sair, carrega na coroa.». `HistoryView` mostra «Ganhámos · 22 out · Pontos · Terminado».
- [ ] **Step 3:** Inglês provisório marcado para revisão no String Catalog para todos os textos novos das Tasks A6 a A10. Fixtures `effort`, `endWithHealth`; workflow verde.
- [ ] **Step 4: Commit** `feat(relógio): esforço no fim e ecrã de fim do protótipo`

### Task A11: Jogo de teste e documentação

**Files:**
- Modify: `docs/native-apps.md` (secção Apple Watch: autorização do Saúde, novas prints)

- [ ] **Step 1:** Build no Codemagic → TestFlight. Checklist no pulso (fica no cartão Trello): Pontos com ponto de ouro e com vantagens até ao total; um jogo de sets com tie-break e acertar a meio; pausa de 5 min (o tempo não conta); mudar o 40-40 a meio; pulso em baixo e toque com a manga; deixar 20 min sem pontos; recusar e aceitar o Saúde; ver o treino na app Atividade com bpm e kcal; esforço; desfazer depois do fim.
- [ ] **Step 2:** Prints à UX e ao Francisco.
- [ ] **Step 3: Commit** `docs(relógio): Saúde e jogo de teste do protótipo de 23 out`

---

# Fase B: relógio → iPhone

### Task B1: O que o relógio manda

**Files:**
- Create: `ios/AlinhoWatch/Sources/PadelScoring/WatchGamePayload.swift`, `Tests/PadelScoringTests/PayloadTests.swift`, `ios/AlinhoWatch/Sources/ScoreboardUI/WatchLink.swift`
- Modify: `AppModel.swift`

**Interfaces:**
- Produces: `struct WatchGamePayload: Codable, Equatable { let version: Int; let id: UUID; let updatedAt: Date; let format: String; let resultText: String; let sets: [[Int]]; let winner: String? /* "us" | "them" */; let endReason: String; let startedAt: Date; let minutes: Int; let effort: Int?; let averageHeartRate: Int?; let activeKilocalories: Int?; let deleted: Bool }`; `init(_ record: MatchRecord, updatedAt: Date)`; `func userInfo() -> [String: Any]` (JSON em `"game"`, datas ISO 8601). Nos Pontos `sets == [[jogosNós, jogosEles]]`.
- `WatchLink.send(_ payload:)` usa `WCSession.default.transferUserInfo`; chama-se ao arquivar, ao guardar o esforço, ao gravar a saúde, e com `deleted: true` quando o desfazer do fim apaga um registo.

- [ ] **Step 1: Failing tests**: `payloadRoundTrips` (codificar/decodificar igual); `pointsPayloadCarriesGames` (`sets == [[13, 11]]`); `payloadHasVersion2`.
- [ ] **Step 2–4:** vermelho → implementar → verde.
- [ ] **Step 5: Commit** `feat(relógio): enviar cada jogo acabado ao iPhone`

### Task B2: Plugin na app iOS

**Files:**
- Create: `ios/App/App/WatchGamesStore.swift`, `ios/App/App/WatchGamesPlugin.swift`, `ios/App/App/AlinhoBridgeViewController.swift`
- Modify: `ios/App/App/Base.lproj/Main.storyboard` (classe do view controller), `ios/App/App.xcodeproj/project.pbxproj` (ficheiros novos no alvo App)

**Interfaces:**
- Produces (JS, nome `WatchGames`): `list(): Promise<{ games: WatchGame[] }>` (o mais recente primeiro); `remove({ id }): Promise<void>`; `markRegistered({ id, friendMatchId }): Promise<void>`; evento `gameReceived` com `{ game }`. `WatchGame` = os campos do payload mais `registeredMatchId: string | null`.
- `WatchGamesStore`: JSON em Application Support; `merge` por `id`, fica o de `updatedAt` mais recente; `deleted: true` apaga; ativa o `WCSession` no arranque da app (o `AppDelegate` chama `WatchGamesStore.shared.activate()`), para receber mesmo sem a página aberta.
- O plugin regista-se com `bridge?.registerPluginInstance(WatchGamesPlugin())` em `AlinhoBridgeViewController.capacitorDidLoad()`.

- [ ] **Step 1:** Implementar; o workflow que compila a app iOS (Codemagic `ios-testflight`, ou o `watch.yml` se já compila o alvo App) fica verde.
- [ ] **Step 2: Commit** `feat(ios): plugin WatchGames recebe os jogos do relógio`

### Task B3: Funções de estatística (web)

**Files:**
- Create: `src/lib/watchGames.js`, `src/lib/watchGames.test.js`, `src/lib/watchStats.js`, `src/lib/watchStats.test.js`

**Interfaces:**
- `watchGames.js`: `WatchGames = registerPlugin('WatchGames')` com fallback web que devolve `{ games: [] }`; `mergeGame(list, game)`; `export const hasWatchGames = IS_NATIVE && Capacitor.getPlatform() === 'ios'`.
- `watchStats.js` (todas puras, recebem `games` e `now: Date`):
  - `byMonth(games, now, months = 6) -> [{ year, month, games, wins, minutes }]` (os meses sem jogos aparecem com zeros)
  - `monthSentence(rows) -> { key: 'none' | 'more' | 'less' | 'same', current, previous, diff, wins }` (o texto fica no i18n)
  - `trends(games, now) -> { gamesPerMonth90, gamesPerMonthYear, winPct90, winPctYear }`
  - `week(games, now) -> { minutes, goal: 150, effortLoad, usualLoad, effortTrend: 'above' | 'same' | 'below' | 'none' }`; carga = soma de `effort × minutes` dos últimos 7 dias; o costume é a média das 4 semanas anteriores; ±20% decide (`none` sem esforço marcado esta semana ou sem histórico)
  - `goalProgress(games, now, { goal, pausedAt }) -> { done, goal, met, streak, medals: [{ year, month, met }] }`; a sequência conta meses seguidos cumpridos antes do atual; meses em pausa (até 90 dias desde `pausedAt`) não a partem

- [ ] **Step 1: Failing tests** (vitest), entre eles:

```js
test('mergeGame replaces by id and keeps newest', () => {
  const a = { id: '1', updatedAt: '2026-10-20T10:00:00Z', effort: null }
  const b = { id: '1', updatedAt: '2026-10-20T10:05:00Z', effort: 7 }
  expect(mergeGame(mergeGame([], b), a)).toEqual([b])
  expect(mergeGame([a], { ...b, deleted: true })).toEqual([])
})
test('monthSentence compares with previous month', () => {
  expect(monthSentence([{ games: 3, wins: 1 }, { games: 5, wins: 4 }])).toMatchObject({ key: 'more', diff: 2, wins: 4 })
  expect(monthSentence([{ games: 3 }, { games: 0 }]).key).toBe('none')
})
test('week effort trend is relative to the last 4 weeks', () => { /* 4 semanas de carga 300; esta 400 → above; 300 → same; 200 → below */ })
test('paused goal keeps the streak', () => { /* ago e set cumpridos, out em pausa → streak 2 */ })
test('byMonth fills empty months with zeros', () => { /* 1 jogo em out → 6 linhas, 5 a zero */ })
```

- [ ] **Step 2–4:** `npm test -- watchStats watchGames` vermelho → implementar → verde.
- [ ] **Step 5: Commit** `feat(numeros): estatísticas dos jogos do relógio`

### Task B4: Página «Os meus números»

**Files:**
- Create: `src/pages/MeusNumeros.jsx`, `src/components/numeros/JogosTab.jsx`, `StatsTab.jsx`, `DesafiosTab.jsx`
- Modify: `src/App.jsx` (rota `/numeros`), `src/pages/Profile.jsx` (entrada «Os meus números» só com `hasWatchGames`), ficheiros de i18n pt/en

**Interfaces:**
- Consumes: `WatchGames`, `mergeGame`, `watchStats.*` (B3).
- Objetivo e pausa guardam-se em `localStorage` (`alinho.numeros.goal`, `alinho.numeros.goalPausedAt`) com `try/catch`; objetivo 8 por omissão, 1 a 30.

- [ ] **Step 1:** Três separadores com o desenho do protótipo (`renderPhone`), estados vazios («Ainda não há jogos do relógio» e o texto do protótipo), «Não registar e apagar» com `confirm()` (ação destrutiva). Sem «Registar o jogo», sem desafio de 7 dias nem amigos (Fase C). Sem dados de exemplo.
- [ ] **Step 2:** Aviso local à segunda às 9h («A tua semana no padel» + resumo) só se `@capacitor/local-notifications` já estiver em `package.json`; se não estiver, não se instala nesta task: fica escrito no cartão para o Renato decidir.
- [ ] **Step 3:** `npm test` e `npm run build` verdes; ver a página no browser com o `devMockNetwork`/fallback (lista vazia) e numa build iOS com jogos reais.
- [ ] **Step 4: Commit** `feat(numeros): Jogos, Estatísticas e Desafios com os jogos do relógio`

---

# Fase C: registar e amigos

### Task C1: Migração dos desafios e do resultado do relógio

**Files:**
- Create: `supabase/migration_relogio_desafios.sql`

**Interfaces:**
- `ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS watch_result TEXT;` (nulo nos jogos que não vêm do relógio; as versões antigas da app ignoram-no).
- `CREATE TABLE friend_challenges (id UUID PK, challenger_id UUID NOT NULL REFERENCES profiles(id), opponent_id UUID NOT NULL REFERENCES profiles(id), starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')), created_at TIMESTAMPTZ DEFAULT now(), CHECK (challenger_id <> opponent_id))`. RLS: `SELECT` só aos dois; sem `INSERT/UPDATE/DELETE` diretos.
- RPCs `SECURITY DEFINER`, `search_path` fixo, só `authenticated`: `create_friend_challenge(p_opponent UUID) RETURNS UUID` (exige `are_friends(auth.uid(), p_opponent)`; 7 dias a partir de agora; no máximo um ativo por par); `respond_friend_challenge(p_id UUID, p_accept BOOLEAN)` (só o `opponent_id`); `friend_challenge_scores(p_id UUID) RETURNS TABLE(user_id UUID, games INT)` (só os dois; conta jogos entre amigos **confirmados** de cada um entre `starts_at` e `ends_at`); `friends_week_games() RETURNS TABLE(friend_id UUID, games INT, wins INT)` (amigos de `auth.uid()` pelo `are_friends`, últimos 7 dias, só jogos confirmados, e respeita a privacidade do perfil como as outras listas de amigos); `set_friend_match_watch_result(p_match_id UUID, p_text TEXT)` (só o criador do jogo, só enquanto não está confirmado).
- Reutilizar `are_friends` e o helper de privacidade que as listas de amigos já usam; não copiar `EXISTS` à mão.

- [ ] **Step 1:** Escrever a migração (idempotente: `IF NOT EXISTS`, `CREATE OR REPLACE`, `REVOKE ... FROM PUBLIC, anon`).
- [ ] **Step 2:** Correr no Supabase **dev** (`jnrdbf…`) e provar a RLS no SQL Editor: como utilizador A, `select * from friend_challenges` não mostra desafios de B e C; `friend_challenge_scores` de um desafio alheio dá erro; `friends_week_games` não devolve não-amigos; nenhuma coluna de saúde existe em lado nenhum.
- [ ] **Step 3:** Pedir o agente `security-reviewer` sobre a migração antes do commit.
- [ ] **Step 4: Commit** `feat(db): desafios entre amigos e resultado do relógio` e **dizer que falta correr em prod**.

### Task C2: Registar o jogo

**Files:**
- Create: `src/components/numeros/RegistarJogo.jsx`
- Modify: `src/components/numeros/JogosTab.jsx`, `src/lib/privateMatches.js` (só se faltar um helper), i18n

**Interfaces:**
- Consumes: `create_friend_match` e o fluxo de resultado/aceites que `src/lib/privateMatches.js` e `src/pages/CreateFriendMatch.jsx` já usam (ler as assinaturas atuais antes de começar; não criar RPCs novas para isto); `set_friend_match_watch_result` (C1); `WatchGames.markRegistered` (B2).

- [ ] **Step 1:** Botão «Registar o jogo» só nos jogos com menos de 7 dias e sem `registeredMatchId`; depois disso, «Já passaram 7 dias: fica só aqui.».
- [ ] **Step 2:** Passo 1 «Com quem jogaste?»: parceiro e dois adversários da lista de amigos real (ou convidado, como no fluxo de jogos entre amigos), «Onde fica» = perfil ou um dos grupos do utilizador; Continuar só com os três. Passo 2 «O resultado»: sets do relógio com − / +, aviso «Resultado mudado à mão. Os outros veem o do relógio e o teu.»; «Registar e enviar» cria o jogo, guarda o resultado, chama `set_friend_match_watch_result` se mudou, e `markRegistered`.
- [ ] **Step 3:** Estado do jogo lido do Supabase: «À espera dos aceites (n de 3)» e «Os quatro aceitaram: conta para o ranking.».
- [ ] **Step 4:** No ecrã de aceitar do jogo entre amigos, quando `watch_result` existe e difere, mostrar os dois resultados.
- [ ] **Step 5:** `npm test` + `npm run build`; testar de ponta a ponta com duas contas no dev.
- [ ] **Step 6: Commit** `feat(numeros): registar um jogo do relógio como jogo entre amigos`

### Task C3: Desafio de 7 dias e amigos esta semana

**Files:**
- Modify: `src/components/numeros/DesafiosTab.jsx`, i18n; criar `src/lib/friendChallenges.js`

**Interfaces:**
- Consumes: as RPCs da C1.
- Produces: `createChallenge(opponentId)`, `respondChallenge(id, accept)`, `challengeScores(id)`, `friendsWeek()`.

- [ ] **Step 1:** Cartão «Tu contra <nome>», «Quem joga mais até <dia>», «faltam N dias», as duas barras; «Desafiar outro amigo» (lista de amigos); convite pendente com Aceitar / Recusar. «Amigos esta semana» com «3 jogos · 2 vitórias». Texto fixo: «Aos amigos só aparecem os jogos, nunca a saúde.»
- [ ] **Step 2:** `npm test` + `npm run build`; duas contas no dev.
- [ ] **Step 3: Commit** `feat(numeros): desafio de 7 dias e amigos esta semana`

### Task C4: Fecho

- [ ] **Step 1:** `superpowers:requesting-code-review` sobre o branch inteiro (relógio + iOS + web + migração).
- [ ] **Step 2:** Atualizar `FEATURES.md` e `PRIVACY_ROPA.md` (dados de saúde ficam no aparelho; o que vai ao servidor: só jogos registados e desafios).
- [ ] **Step 3:** Cartão Trello + mensagem em #dev-updates (regra do `CLAUDE.md`); dizer explicitamente que a `migration_relogio_desafios.sql` falta correr em prod e que nada disto está no `dev`/`main` até o Renato decidir.
