# Marcador no Apple Watch, Fase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma app de Apple Watch, embutida na app iOS `pt.alinho.app`, que conta os pontos de um jogo de padel com as regras do BA, sozinha no relógio, e chega ao TestFlight.

**Architecture:** Um Swift Package local `ios/AlinhoWatch` com dois alvos: `PadelScoring` (regras, sessão, gravação; puro, testado com `swift test` em macOS) e `ScoreboardUI` (SwiftUI, haptics, sessão de treino; o código todo dentro de `#if os(watchOS)`, para o `swift test` em macOS compilar sem ele). O alvo watchOS no `ios/App/App.xcodeproj` tem só um ficheiro (`AlinhoWatchApp.swift`), os assets, o Info.plist e os entitlements, e usa o produto `ScoreboardUI`. Assim o `project.pbxproj` só se edita uma vez. Desenvolvemos em Windows: tudo se verifica no GitHub Actions (repo público, Macs grátis), e o TestFlight sai do Codemagic.

**Tech Stack:** Swift 5.10+, SwiftUI, watchOS 10+, Swift Testing (`import Testing`), HealthKit (`HKWorkoutSession`), GitHub Actions `macos-latest`, Codemagic.

**Spec:** `docs/superpowers/specs/2026-10-22-apple-watch-marcador-fase1-design.md` · Fonte: `docs/design-handoff/2026-10-22-relogio/Relogio-alinho-fase1.pdf` (páginas 5 a 7: ecrãs) · Protótipo (referência das regras): https://claude.ai/artifact/PmzAm5WTHVY48KY9BczyLD

## Global Constraints

- Trabalho só no branch `feature/apple-watch`, criado a partir do `dev`. Push para `origin feature/apple-watch`. **Nunca** juntar ao `dev` nem ao `main` sem o Renato dizer.
- Commits sem linha de atribuição ao Claude (preferência do Renato).
- watchOS 10.0 mínimo. Bundle id `pt.alinho.app.watchkitapp`, nome «alinho», `WKCompanionAppBundleIdentifier = pt.alinho.app`, `WKRunsIndependentlyOfCompanionApp = true`. `MARKETING_VERSION` igual ao da app iOS (hoje `1.0`).
- Sem rede, sem pacotes de fora, sem dados de saúde gravados.
- Cores: lima `#C5DD01`, cinzento «Eles» `#D9DCE0`, texto nos blocos `#040404`, vermelho `#FF6B5E`, listas `#1D1E21`, texto secundário `#9EA3AA`, pulso em baixo `#3E4500` / `#2A2B2D` / texto `#C9CCD1`. Fundo preto.
- Números em Outfit 900 (`Outfit-Black.ttf`, licença OFL junto); o resto na letra do sistema.
- Textos pt-PT (língua base) e en, num String Catalog; a chave é o texto em português. **Sem «—» em nenhum texto.**
- Toque comprido: uma constante `HoldDuration.seconds = 0.7`.
- Verificar o pacote com `swift test` e a app com o workflow `.github/workflows/watch.yml`; não há Mac local.

## Review Focus

1. **Desfazer em cadeia através de fronteiras** (desfazer o ponto que fechou o set e entrou no tie-break, depois outro, depois o que fechou o jogo todo): cada passo tem de dar exatamente o estado anterior, incluindo quem serve e o contador do Star Point. Teste: Task 5, `undoWalksBackAcrossTieBreakAndMatchEnd`.
2. **App fechada a meio** (o relógio desliga com o jogo a decorrer, com coisas para desfazer): ao abrir, o mesmo jogo, a mesma pilha de desfazer. Ficheiro estragado ou de uma versão antiga: abre em «Novo jogo» sem rebentar. Teste: Task 5, `storeRoundTripsMidMatch` e `storeIgnoresCorruptFile`.
3. **Terminar logo no início ou num tie-break** (0-0, ou 6-6 com o tie-break a 5-4): resultado «0-0» / «6-6», «Empatado», nada de pontos do tie-break no resultado. Teste: Task 4, `stopAtStartIsDraw` e `stopDuringTieBreakIgnoresTieBreakPoints`.
4. **Pontos sem total** (`pointsTotal = nil`): nunca acaba sozinho, mesmo com 200 pontos. Teste: Task 4, `pointsWithoutTotalNeverEnds`.
5. **Dois toques ao mesmo tempo nos dois blocos** (a manga pousa nos dois): no máximo um ponto conta; o segundo bloco não arranca enquanto o primeiro está a encher. Coberto na Task 8, passo do `HoldButton` (estado partilhado `AppModel.activeHold`).

---

## Estrutura de ficheiros

```
ios/AlinhoWatch/
  Package.swift
  Sources/PadelScoring/
    Model.swift          tipos (Team, MatchFormat, DeuceMode, MatchConfig, SetScore, MatchState, MatchEvent…)
    Scoring.swift        newMatch / point / stop
    Display.swift        ScoreDisplay, StatusLabel, linhas de resultado, duração
    Session.swift        MatchSession (desfazer, histórico) + MatchRecord
    SessionStore.swift   JSON em disco
  Tests/PadelScoringTests/
    GameTests.swift  SetTests.swift  PointsAndStopTests.swift  DisplayTests.swift  SessionTests.swift
    Helpers.swift
  Sources/ScoreboardUI/
    Resources/Outfit-Black.ttf  Resources/OFL.txt  Resources/Localizable.xcstrings
    Theme.swift  Strings.swift  AppModel.swift  Haptics.swift  WorkoutKeeper.swift
    RootView.swift  SetupView.swift  OptionListView.swift  ScoreboardView.swift  HoldButton.swift
    OverlayView.swift  GameMenuView.swift  EndView.swift  HistoryView.swift  ScreenshotFixtures.swift
  App/
    AlinhoWatchApp.swift  Info.plist  AlinhoWatch.entitlements  Assets.xcassets/
ios/App/App.xcodeproj/project.pbxproj                         (alvo novo + embed)
ios/App/App.xcodeproj/xcshareddata/xcschemes/AlinhoWatch.xcscheme
.github/workflows/watch.yml
codemagic.yaml
docs/native-apps.md
```

---

### Task 1: Pacote, tipos e CI

**Files:**
- Create: `ios/AlinhoWatch/Package.swift`, `Sources/PadelScoring/Model.swift`, `Sources/PadelScoring/Scoring.swift`, `Sources/ScoreboardUI/Theme.swift` (só `#if os(watchOS)` vazio por agora), `Tests/PadelScoringTests/Helpers.swift`, `Tests/PadelScoringTests/GameTests.swift`, `.github/workflows/watch.yml`

**Interfaces:**
- Produces (em `Model.swift`, tudo `public`, `Codable, Equatable, Sendable`):
  - `enum Team: Int { case us = 0, them = 1; var other: Team }`
  - `enum MatchFormat: String, CaseIterable { case bestOf3 = "m3", twoSetsSuperTieBreak = "stb", proSet9 = "pro9", oneSet = "s1", points = "pts" }` com `gamesPerSet` (9 em `pro9`, senão 6), `tieBreakAt` (8 em `pro9`, senão 6), `setsToWin` (2 em `m3`/`stb`, senão 1)
  - `enum DeuceMode: String, CaseIterable { case golden = "ouro", starPoint = "star", advantage = "vant" }`
  - `enum Phase: String { case game, tieBreak, superTieBreak, points }`
  - `enum SetKind: String { case normal, tieBreak, superTieBreak }`, `struct SetScore { var us: Int; var them: Int; var kind: SetKind }`
  - `struct MatchConfig { var format: MatchFormat; var deuceMode: DeuceMode; var firstServer: Team?; var pointsTotal: Int?; static let default = MatchConfig(format: .bestOf3, deuceMode: .golden, firstServer: nil, pointsTotal: 24); static let pointsTotalOptions: [Int?] = [16, 24, 32, nil] }`
  - `enum EndReason: String { case rules, stopped }`
  - `struct MatchState { let id: UUID; let config: MatchConfig; var sets: [SetScore]; var games: [Int]; var points: [Int]; var phase: Phase; var deuceCount: Int; var server: Team?; var tieBreakFirstServer: Team?; let startedAt: Date; var endedAt: Date?; var endReason: EndReason?; var winner: Team?; var isOver: Bool { endReason != nil } }` (`games`/`points` têm sempre 2 posições, índice = `Team.rawValue`)
  - `enum MatchEvent: Hashable { case point, gameWon, setWon, matchOver, switchSides, decisivePoint }`
  - `struct PointResult { let state: MatchState; let events: Set<MatchEvent> }`
  - Em `Scoring.swift`: `enum Scoring { static func newMatch(_ config: MatchConfig, id: UUID = UUID(), at: Date) -> MatchState }` (as outras funções vêm nas Tasks 2 a 4)
- Produces (em `Helpers.swift`): `let t0 = Date(timeIntervalSince1970: 1_800_000_000)`, `func match(_ format: MatchFormat = .bestOf3, _ mode: DeuceMode = .golden, server: Team? = nil, total: Int? = 24) -> MatchState`, `func play(_ s: MatchState, _ seq: String) -> (MatchState, [Set<MatchEvent>])` onde `seq` é feito de `u` (Nós) e `t` (Eles), espaços ignorados.

- [ ] **Step 1: Criar o branch**

```bash
git switch dev && git pull --rebase origin dev && git switch -c feature/apple-watch
```

- [ ] **Step 2: `Package.swift`**

`swift-tools-version: 5.10`, nome `AlinhoWatch`, `defaultLocalization: "pt-PT"`, `platforms: [.watchOS(.v10), .macOS(.v14)]`, produtos `PadelScoring` e `ScoreboardUI` (biblioteca), alvos `PadelScoring`, `ScoreboardUI` (depende de `PadelScoring`, `resources: [.process("Resources")]`), alvo de testes `PadelScoringTests`. A pasta `Resources` pode ficar só com um `.gitkeep` até à Task 6.

- [ ] **Step 3: Teste que falha, em `GameTests.swift`**

```swift
@Test func newMatchStartsAtZero() {
    let s = match(.bestOf3, .golden, server: .them)
    #expect(s.sets.isEmpty && s.games == [0, 0] && s.points == [0, 0])
    #expect(s.phase == .game && s.server == .them && !s.isOver)
    #expect(match(.points).phase == .points && match(.points, server: .us).server == nil)
}
```

(Em Pontos não há serviço: `newMatch` põe `server = nil`.)

- [ ] **Step 4: `.github/workflows/watch.yml`**

Corre em `push` para qualquer branch com `paths: ['ios/AlinhoWatch/**', 'ios/App/App.xcodeproj/**', '.github/workflows/watch.yml']` e em `workflow_dispatch`. Job `scoring` em `macos-latest`, `timeout-minutes: 15`: checkout, `maxim-lobanov/setup-xcode@v1` com `xcode-version: latest-stable`, depois `swift test` em `ios/AlinhoWatch`. Comentários no topo em português, como em `prod-health.yml`.

- [ ] **Step 5: Implementar `Model.swift` e `Scoring.newMatch`, commit, push, ver a CI**

```bash
git add ios/AlinhoWatch .github/workflows/watch.yml
git commit -m "feat(relógio): pacote AlinhoWatch com os tipos das regras e CI"
git push -u origin feature/apple-watch
gh run watch $(gh run list --branch feature/apple-watch --workflow watch.yml --limit 1 --json databaseId -q '.[0].databaseId') --exit-status
```

Esperado: job `scoring` verde, 1 teste a passar. (Antes de implementar, um push com só o teste dá vermelho com «cannot find 'match'»; pode juntar-se tudo num push para poupar tempo.)

---

### Task 2: Um jogo e os três modos do 40-40

**Files:**
- Modify: `Sources/PadelScoring/Scoring.swift`
- Create: `Sources/PadelScoring/Display.swift`, `Tests/PadelScoringTests/DisplayTests.swift`
- Test: `Tests/PadelScoringTests/GameTests.swift`

**Interfaces:**
- Produces: `Scoring.point(_ s: MatchState, to team: Team, at: Date) -> PointResult` (nesta task só a fase `.game`; fechar o jogo põe `games[team] += 1`, `points = [0,0]`, `deuceCount = 0`, evento `.gameWon`, e troca `server` se não for `nil`)
- Produces (em `Display.swift`):
  - `enum PointMark: Equatable { case value(String), advantage }` (`"0"`, `"15"`, `"30"`, `"40"`, ou o número no tie-break e nos Pontos)
  - `enum StatusLabel: Equatable { case goldenPoint, starPoint, deuce(Int?), advantage(Int?), tieBreak, superTieBreak, points(total: Int?) }`
  - `struct ScoreDisplay: Equatable { let us: PointMark; let them: PointMark; let status: StatusLabel? }`
  - `extension MatchState { var display: ScoreDisplay }`

Representação como no protótipo: dentro de um jogo `points` vai até `[3,3]`; vantagem é `[4,3]`; perder a vantagem volta a `[3,3]`.

- [ ] **Step 1: Testes que falham** (cada um com o seu `@Test`)

```swift
@Test func plainGame() {            // 15-30-40-jogo, sem 40-40
    let (s, ev) = play(match(), "uuuu")
    #expect(s.games == [1, 0] && s.points == [0, 0])
    #expect(ev.last!.contains(.gameWon))
}
@Test func goldenPointDecides() {
    let (s, ev) = play(match(.bestOf3, .golden), "uuuttt")
    #expect(ev.last!.contains(.decisivePoint) && s.display.status == .goldenPoint)
    #expect(play(s, "t").0.games == [0, 1])
}
@Test func advantageHasNoLimit() {
    let (s, _) = play(match(.bestOf3, .advantage), "uuuttt utut utut")
    #expect(s.points == [3, 3] && s.display.status == .deuce(nil))
    let (a, _) = play(s, "u")
    #expect(a.display == ScoreDisplay(us: .advantage, them: .value("40"), status: .advantage(nil)))
    #expect(play(a, "u").0.games == [1, 0])
}
@Test func starPointSequence() {
    var (s, _) = play(match(.bestOf3, .starPoint), "uuuttt")
    #expect(s.display.status == .deuce(1))
    (s, _) = play(s, "u");  #expect(s.display.status == .advantage(1))
    (s, _) = play(s, "t");  #expect(s.display.status == .deuce(2))
    (s, _) = play(s, "t");  #expect(s.display.status == .advantage(2))
    let (s3, ev) = play(s, "u")                       // perde a Vantagem 2 → Iguais 3 = Star Point
    #expect(s3.display.status == .starPoint && ev.last!.contains(.decisivePoint))
    #expect(play(s3, "u").0.games == [1, 0])
}
@Test func starPointWinOnFirstAdvantage() {
    #expect(play(match(.bestOf3, .starPoint), "uuuttt uu").0.games == [1, 0])
}
@Test func serverAlternatesEachGame() {
    #expect(play(match(server: .us), "uuuu").0.server == .them)
}
```

E em `DisplayTests.swift`: `@Test func gameLabels()`: depois de `"ut"` → `us: .value("15"), them: .value("15"), status: nil`; depois de `"uuut"` → `.value("40")`, `.value("15")`.

- [ ] **Step 2: Push, ver vermelho** (`gh run watch …`, esperado: falha a compilar ou os testes falham)
- [ ] **Step 3: Implementar a fase `.game` de `point` e `display`**, seguindo `point`/`pointLabels`/`decisive` do protótipo (linhas «jogo normal»). O Star Point: `deuceCount = 1` ao chegar a `[3,3]`; `+1` quando quem tinha a vantagem perde; com `deuceCount >= 3` aos `[3,3]` o ponto seguinte fecha o jogo. `.decisivePoint` sai no ponto que leva a um 40-40 decisivo (ouro, ou Star Point com `deuceCount >= 3`).
- [ ] **Step 4: Push, ver verde**
- [ ] **Step 5: Commit** `feat(relógio): pontos de um jogo e os modos do 40-40`

---

### Task 3: Sets, tie-break, super tie-break, serviço e troca de lado

**Files:**
- Modify: `Sources/PadelScoring/Scoring.swift`, `Sources/PadelScoring/Display.swift`
- Test: `Tests/PadelScoringTests/SetTests.swift`

**Interfaces:**
- Consumes: `Scoring.point`, `MatchFormat.gamesPerSet/tieBreakAt/setsToWin`
- Produces: `point` completo para `.game`, `.tieBreak`, `.superTieBreak`; fim pelas regras põe `endReason = .rules`, `endedAt`, `winner` e o evento `.matchOver`.

Regras (spec, «Regras de pontuação»):
- Set ganho com `gamesPerSet` e 2 de diferença → `sets.append(SetScore(…, .normal))`, `games = [0,0]`, `.setWon`.
- `games == [tieBreakAt, tieBreakAt]` → `phase = .tieBreak`, `tieBreakFirstServer = server`.
- Tie-break a 7 por 2 → `games[team] += 1`, `sets.append(SetScore(…, .tieBreak))` (fica 7-6 / 9-8).
- `stb` com sets 1-1 → `phase = .superTieBreak`, `tieBreakFirstServer = server`; a 10 por 2 → `sets.append(SetScore(p0, p1, .superTieBreak))`.
- Quem serve no tie-break, depois de `n` pontos jogados: `((n + 1) / 2) % 2 == 0 ? tieBreakFirstServer : tieBreakFirstServer.other`. No fim do tie-break: `server = tieBreakFirstServer.other`.
- Troca de lado (`.switchSides`): depois de um jogo que deixa o total de jogos do set ímpar; no fim de um set cujo total de jogos é ímpar (tie-break conta 7-6 = 13, troca); nos tie-breaks quando `(p0 + p1) % 6 == 0`, exceto no ponto que fecha o tie-break (aí vale a regra do set). Nunca no ponto que acaba o jogo todo.

- [ ] **Step 1: Testes que falham**, cada um um `@Test`:
  - `setTo6`: 6-4 (sequência de jogos), `sets == [SetScore(6, 4, .normal)]`, eventos do último ponto contêm `.setWon` e **não** `.switchSides` (10 é par).
  - `setAt6_3SwitchesSides`: o ponto que fecha 6-3 traz `.switchSides`.
  - `oddGamesSwitch`: depois do 1.º jogo `.switchSides`; depois do 2.º não; depois do 3.º sim.
  - `tieBreakAt6_6`: chegar a 6-6 → `phase == .tieBreak`, `display.status == .tieBreak`, pontos `.value("0")`.
  - `tieBreakWinBy2`: no tie-break, 7-6 não fecha, 8-6 fecha; `sets.last == SetScore(7, 6, .tieBreak)`.
  - `tieBreakSwitchEvery6`: no tie-break, o 6.º ponto traz `.switchSides`, o 5.º e o 7.º não, o 12.º traz.
  - `tieBreakServeOrder`: com `tieBreakFirstServer = .us`, servidores antes dos pontos 1 a 6: `us, them, them, us, us, them`; depois do tie-break `server == .them`.
  - `proSet9`: 8-8 → tie-break; ganho → `SetScore(9, 8, .tieBreak)`, `isOver`, `winner == .us`.
  - `bestOf3Ends`: 6-0 6-0 → `isOver`, `endReason == .rules`, `.matchOver`, sem `.switchSides`.
  - `superTieBreakAt1_1`: `stb` com 6-0 0-6 → `phase == .superTieBreak`, `display.status == .superTieBreak`; 10-8 → `sets.last == SetScore(10, 8, .superTieBreak)`, fim.
  - `modesNotInTieBreak`: em Star Point, a 6-6 o tie-break conta 1, 2, 3 sem «Iguais».

  Helper novo em `Helpers.swift`: `func games(_ s: MatchState, _ seq: String) -> (MatchState, [Set<MatchEvent>])`, que dá um jogo inteiro (4 pontos seguidos) por letra, e devolve os eventos do último ponto de cada jogo.

- [ ] **Step 2: Push, ver vermelho**
- [ ] **Step 3: Implementar** (referência: `point` e `afterSet` do protótipo; a troca a cada 6 pontos é nova)
- [ ] **Step 4: Push, ver verde**
- [ ] **Step 5: Commit** `feat(relógio): sets, tie-breaks, serviço e troca de lado`

---

### Task 4: Pontos (Americano), terminar antes do fim e textos de resultado

**Files:**
- Modify: `Sources/PadelScoring/Scoring.swift`, `Sources/PadelScoring/Display.swift`
- Test: `Tests/PadelScoringTests/PointsAndStopTests.swift`, `Tests/PadelScoringTests/DisplayTests.swift`

**Interfaces:**
- Produces:
  - `Scoring.stop(_ s: MatchState, at: Date) -> MatchState` (`endReason = .stopped`)
  - `extension MatchState { var setsLine: String; var resultText: String }`
  - `func durationText(from: Date, to: Date) -> String` (livre, em `Display.swift`)

Regras:
- Pontos: cada ponto `points[team] += 1`; com `pointsTotal`, acaba quando `points[0] + points[1] >= total`; vencedor quem tem mais, `nil` se igual. `display.status == .points(total:)`, valores `.value("15")`.
- `stop`: os pontos do jogo a meio (e de um tie-break a meio) não contam. Vencedor: mais sets; com sets iguais, mais jogos no set a decorrer; senão `nil`. Em Pontos, mais pontos.
- `setsLine` (linha de cima, durante o jogo): sets fechados e os jogos do set atual separados por `" · "`: `"6-4 · 3-2"`, ou `"0-0"` no início.
- `resultText` (fim e histórico): sets separados por espaço, `"6-4 3-6 10-7"`; se terminado antes do fim, junta os jogos do set a decorrer se algum não for 0 (`"6-4 4-6 3-3"`); `"0-0"` se não houver nada; em Pontos `"15-9"`.
- `durationText`: minutos arredondados, mínimo 1; `"45 min"`, `"1 h 22 min"`.

- [ ] **Step 1: Testes que falham:**
  - `pointsEndsAtTotal`: total 24, 15-9 → `isOver`, `winner == .us`, `resultText == "15-9"`; 12-12 → `winner == nil`.
  - `pointsWithoutTotalNeverEnds`: `total: nil`, 200 pontos → `!isOver`.
  - `stopAtStartIsDraw`: `stop` logo → `winner == nil`, `resultText == "0-0"`.
  - `stopCountsClosedGamesOnly`: 6-4 4-6 3-3 e `"uu"` no jogo → `resultText == "6-4 4-6 3-3"`, `winner == nil`.
  - `stopWithMoreGamesWins`: 6-4 4-6 4-3 → `winner == .us`.
  - `stopDuringTieBreakIgnoresTieBreakPoints`: 6-4 e 6-6 com tie-break 5-4 → `resultText == "6-4 6-6"`, `winner == .us` (1 set a 0).
  - `setsLineDuringMatch`: `"6-4 · 3-2"`; no início `"0-0"`.
  - `durationFormats`: 30 s → `"1 min"`; 45 min → `"45 min"`; 82 min → `"1 h 22 min"`.
- [ ] **Step 2: Push, ver vermelho**
- [ ] **Step 3: Implementar**
- [ ] **Step 4: Push, ver verde**
- [ ] **Step 5: Commit** `feat(relógio): pontos, terminar antes do fim e textos de resultado`

---

### Task 5: Sessão (desfazer, histórico) e gravação em disco

**Files:**
- Create: `Sources/PadelScoring/Session.swift`, `Sources/PadelScoring/SessionStore.swift`
- Test: `Tests/PadelScoringTests/SessionTests.swift`

**Interfaces:**
- Produces:
  - `struct MatchRecord: Codable, Equatable, Identifiable { let id: UUID; let format: MatchFormat; let deuceMode: DeuceMode; let sets: [SetScore]; let points: [Int]; let winner: Team?; let endReason: EndReason; let startedAt: Date; let endedAt: Date; let resultText: String }` (`points` só tem sentido em Pontos; guarda o que a Fase 2 vai mandar à app)
  - `struct MatchSession: Codable, Equatable { var config: MatchConfig; private(set) var current: MatchState?; private(set) var undoStack: [MatchState]; private(set) var history: [MatchRecord]; var canUndo: Bool; static let historyLimit = 20 }` com `init()` (config `.default`, resto vazio) e:
    - `mutating func start(at: Date)` → `current = Scoring.newMatch(config, at:)`, `undoStack = []`
    - `@discardableResult mutating func point(_ team: Team, at: Date) -> Set<MatchEvent>` → empilha o estado, aplica; se acabou, junta um `MatchRecord` ao início de `history` (corta a 20). Sem jogo ou jogo acabado: devolve `[]` e não faz nada.
    - `@discardableResult mutating func undo() -> Bool` → repõe o topo da pilha; se o estado atual estava acabado, tira de `history` o registo com o mesmo `id`.
    - `mutating func stop(at: Date)` → empilha, `Scoring.stop`, regista no histórico.
    - `mutating func clearFinished()` → só se `current?.isOver == true`: `current = nil`, `undoStack = []` («Novo jogo» no ecrã de fim).
  - `struct SessionStore { init(fileURL: URL); static var defaultURL: URL /* Application Support/alinho-relogio/session.json */; func load() -> MatchSession; func save(_ s: MatchSession) throws }`. `load` devolve `MatchSession()` se o ficheiro não existir ou não descodificar. `save` escreve atómico (`.atomic`).

- [ ] **Step 1: Testes que falham:**
  - `undoRestoresExactState`: depois de 10 pontos, `undo()` 10 vezes dá `current == newMatch` (mesmo `id`, `server`, `deuceCount`) e `canUndo == false`.
  - `undoWalksBackAcrossTieBreakAndMatchEnd`: em `s1`, ganhar o tie-break (fim) → `history.count == 1`; `undo()` → `!isOver`, `phase == .tieBreak`, `history.isEmpty`; chegar ao 6-6 com `games(s, "utututututut")` e desfazer os 4 pontos do último jogo e mais 1 → `phase == .game`, `games == [6, 5]`, `points == [0, 3]`.
  - `undoAfterStop`: `stop` e `undo()` → jogo outra vez a decorrer, histórico vazio.
  - `historyNewestFirstMax20`: 21 jogos acabados (Pontos, total 16) → `history.count == 20`, o primeiro é o último jogado.
  - `pointIgnoredWhenOver`: depois do fim, `point` devolve `[]` e o estado não muda.
  - `storeRoundTripsMidMatch`: sessão com jogo a meio e pilha cheia → `save` → `load` igual (`==`). Usar um ficheiro em `FileManager.default.temporaryDirectory`.
  - `storeIgnoresCorruptFile`: escrever `"{nope"` → `load() == MatchSession()`.
- [ ] **Step 2: Push, ver vermelho**
- [ ] **Step 3: Implementar**
- [ ] **Step 4: Push, ver verde**
- [ ] **Step 5: Commit** `feat(relógio): desfazer, últimos jogos e gravação`

---

### Task 6: Alvo watchOS no projeto iOS, recursos e build na CI

**Files:**
- Create: `ios/AlinhoWatch/App/AlinhoWatchApp.swift`, `App/Info.plist`, `App/AlinhoWatch.entitlements`, `App/Assets.xcassets/` (AppIcon a partir de `src/logo/icon-mark-square.svg`, 1024×1024, e AccentColor `#C5DD01`), `ios/App/App.xcodeproj/xcshareddata/xcschemes/AlinhoWatch.xcscheme`, `Sources/ScoreboardUI/Resources/Outfit-Black.ttf`, `Resources/OFL.txt`, `Resources/Localizable.xcstrings`, `Sources/ScoreboardUI/Strings.swift`, `Sources/ScoreboardUI/RootView.swift` (provisório: «Novo jogo» num `Text`)
- Modify: `ios/App/App.xcodeproj/project.pbxproj`, `Sources/ScoreboardUI/Theme.swift`, `.github/workflows/watch.yml`

**Interfaces:**
- Produces: `public struct RootView: View` (em `ScoreboardUI`); `public enum Theme { static func registerFonts(); static let lime, themGrey, ink, red, listBg, muted, dimLime, dimGrey, dimText: Color; static func number(_ size: CGFloat) -> Font /* Outfit-Black */ }`; `enum L { static func t(_ key: String.LocalizationValue) -> String }` (`String(localized: key, bundle: .module)`).
- `AlinhoWatchApp.swift`: `@main struct AlinhoWatchApp: App`, que chama `Theme.registerFonts()` no `init` e mostra `RootView()`.

- [ ] **Step 1: Fonte e textos.** Descarregar `Outfit-Black.ttf` e o `OFL.txt` do repositório oficial da Outfit (github.com/Outfitio/Outfit-Fonts, pasta dos TTF estáticos). Confirmar que o nome PostScript é `Outfit-Black`. `Localizable.xcstrings` com língua base `pt-PT` e `en`, chaves = texto pt. Inglês provisório (estado «needs review» no catálogo):

| pt | en |
|---|---|
| Novo jogo | New match |
| Começar | Start |
| Formato | Format |
| Aos 40-40 | At 40-40 |
| Ponto de ouro | Golden point |
| Star Point | Star Point |
| Vantagens | Advantages |
| Quem serve | Serving first |
| Quem serve primeiro | Who serves first |
| Não mostrar | Don't show |
| Nós / Eles | Us / Them |
| Desfazer | Undo |
| Iguais / Iguais %lld | Deuce / Deuce %lld |
| Vantagem / Vantagem %lld | Advantage / Advantage %lld |
| Vant. | Ad. |
| Tie-break a 7 | Tie-break to 7 |
| Super tie-break a 10 | Super tie-break to 10 |
| Pontos / Pontos · até %lld | Points / Points · to %lld |
| Total: %lld pontos / Sem total / Total da ronda | Total: %lld points / No total / Round total |
| Trocar de lado | Change ends |
| %@ · Nós servimos / %@ · Eles servem | %@ · We serve / %@ · They serve |
| Quem recebe escolhe o lado | Receivers choose the side |
| Ganharam Nós / Ganharam Eles / Empatado | We won / They won / Draw |
| Terminado antes do fim. | Ended early. |
| O jogo a meio (%@) não conta. | The game in progress (%@) doesn't count. |
| Terminado | Ended |
| Últimos jogos | Recent matches |
| Ainda não há jogos. Acaba um e aparece aqui. | No matches yet. Finish one and it shows up here. |
| Terminar o jogo / Terminar / Cancelar | End match / End / Cancel |
| Mantém o dedo para terminar | Hold to end |
| Desliza para voltar ao marcador | Swipe back to the score |
| Melhor de 3 sets / 2 sets + super tie-break / Pro set a 9 / 1 set | Best of 3 sets / 2 sets + super tie-break / Pro set to 9 / 1 set |
| Melhor de 3 / 2 sets + super (curtos) | Best of 3 / 2 sets + super |
| Aos 40-40 joga-se um ponto só. | At 40-40 one point decides. |
| Duas vantagens; se continuar, um ponto decide. | Two advantages; if still level, one point decides. |
| Ganha quem fizer 2 pontos seguidos. | Win two points in a row. |
| Se escolheres, o relógio mostra quem serve em cada jogo. | If you choose, the watch shows who serves each game. |
| Para o ecrã não se apagar a meio do jogo, o alinho abre uma sessão de treino. Não grava nada. | So the screen stays on during the match, alinho starts a workout session. Nothing is saved. |

  A última linha é o texto do `NSHealthUpdateUsageDescription` e do `NSHealthShareUsageDescription` (ficam no `InfoPlist.xcstrings` da app, não no pacote; criar `App/InfoPlist.xcstrings` com pt-PT e en).

- [ ] **Step 2: `Info.plist` e entitlements.** `CFBundleDisplayName` «alinho», `CFBundleDevelopmentRegion` `pt-PT`, `CFBundleLocalizations` `[pt-PT, en]`, `WKApplication = true`, `WKCompanionAppBundleIdentifier = pt.alinho.app`, `WKRunsIndependentlyOfCompanionApp = true`, `WKBackgroundModes = [workout-processing]`, os dois textos de saúde. Entitlements: `com.apple.developer.healthkit = true`, `com.apple.developer.healthkit.access = []`.

- [ ] **Step 3: `project.pbxproj` à mão.** Manter `objectVersion = 60`. Acrescentar:
  - `XCLocalSwiftPackageReference` para `../AlinhoWatch` no projeto, e `XCSwiftPackageProductDependency` `ScoreboardUI` no alvo novo;
  - `PBXNativeTarget` «AlinhoWatch», `productType = "com.apple.product-type.application"`, com fases Sources (`AlinhoWatchApp.swift`), Resources (`Assets.xcassets`, `InfoPlist.xcstrings`) e Frameworks (`ScoreboardUI`); file refs num grupo `AlinhoWatch` com `path = ../AlinhoWatch/App`;
  - configurações Debug/Release: `SDKROOT = watchos`, `WATCHOS_DEPLOYMENT_TARGET = 10.0`, `TARGETED_DEVICE_FAMILY = 4`, `PRODUCT_BUNDLE_IDENTIFIER = pt.alinho.app.watchkitapp`, `PRODUCT_NAME = AlinhoWatch`, `INFOPLIST_FILE`, `CODE_SIGN_ENTITLEMENTS`, `MARKETING_VERSION = 1.0`, `CURRENT_PROJECT_VERSION` igual ao da App, `SWIFT_VERSION = 5.0`, `ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon`, `CODE_SIGN_STYLE = Automatic`, `SKIP_INSTALL = YES`;
  - no alvo `App`: `PBXTargetDependency` para o AlinhoWatch e uma `PBXCopyFilesBuildPhase` «Embed Watch Content» (`dstSubfolderSpec = 16`, `dstPath = "$(CONTENTS_FOLDER_PATH)/Watch"`) com o `AlinhoWatch.app`.

  Esquema partilhado `AlinhoWatch.xcscheme` (Build + Run do alvo AlinhoWatch).

- [ ] **Step 4: CI.** Em `watch.yml`, job novo `watch-app` (depois de `scoring`): `xcodebuild -project ios/App/App.xcodeproj -scheme AlinhoWatch -destination 'generic/platform=watchOS Simulator' CODE_SIGNING_ALLOWED=NO build`. E um job `ios-embed` só em `workflow_dispatch`: `npm ci && npm run build && npx cap sync ios` e depois `xcodebuild -scheme App -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build`, para provar que a app iOS compila com o relógio dentro.

- [ ] **Step 5: Push, ver `scoring` e `watch-app` verdes; correr `gh workflow run watch.yml --ref feature/apple-watch` e ver `ios-embed` verde**
- [ ] **Step 6: Commit** `feat(relógio): alvo watchOS embutido na app iOS, fonte e textos`

---

### Task 7: Estado da app e ecrã «Novo jogo»

**Files:**
- Create: `Sources/ScoreboardUI/AppModel.swift`, `Haptics.swift`, `SetupView.swift`, `OptionListView.swift`
- Modify: `Sources/ScoreboardUI/RootView.swift`

**Interfaces:**
- Consumes: `MatchSession`, `SessionStore`, `MatchConfig`
- Produces:
  - `@MainActor final class AppModel: ObservableObject { @Published private(set) var session: MatchSession; @Published var overlay: Overlay?; @Published var activeHold: HoldTarget?; init(store: SessionStore = SessionStore(fileURL: SessionStore.defaultURL)); func setConfig(_: MatchConfig); func start(); func point(_: Team); func undo(); func stop(); func newMatch() }`. Cada ação muda a sessão e grava logo (`try? store.save`).
  - `enum Overlay: Equatable { case switchSides, decisive(StatusLabel) }`, `enum HoldTarget: Equatable { case block(Team), undo, end }`
  - `enum Haptic { case touch, counted, double, long, undo; static func play(_: Haptic) }`, com `WKInterfaceDevice.current().play`: `touch → .click`, `counted → .directionUp`, `double → .notification`, `long → .success`, `undo → .directionDown` (afinar no pulso).
  - `RootView` mostra: sem jogo → `SetupView`; jogo a decorrer → `TabView` de 2 páginas (Task 8 e 9); jogo acabado → `EndView` (Task 9).

- [ ] **Step 1: `SetupView`** (PDF p. 5, «Abrir e começar»): título «Novo jogo», três linhas com a escolha atual e a legenda («Formato», «Aos 40-40» ou «Total da ronda», «Quem serve»; a terceira não aparece em Pontos), «Começar» a lima. Em Pontos a 2.ª linha mostra «Total: 24 pontos» ou «Sem total».
- [ ] **Step 2: `OptionListView`** genérica: título com «‹», linhas com visto, linha de ajuda por baixo (a da opção marcada no 40-40; a fixa no «Quem serve primeiro»). Desce-se com a coroa (`ScrollView`, já é o comportamento do watchOS).
- [ ] **Step 3: Push, ver `watch-app` verde**
- [ ] **Step 4: Commit** `feat(relógio): ecrã Novo jogo`

---

### Task 8: Marcador, toque comprido e avisos

**Files:**
- Create: `Sources/ScoreboardUI/ScoreboardView.swift`, `HoldButton.swift`, `OverlayView.swift`
- Modify: `AppModel.swift`

**Interfaces:**
- Consumes: `MatchState.display`, `setsLine`, `AppModel`, `Haptic`
- Produces: `struct HoldButton<Label: View>: View { init(target: HoldTarget, model: AppModel, fillFromBottom: Bool, onComplete: @escaping () -> Void, label: () -> Label) }`, `enum HoldDuration { static let seconds = 0.7 }`

- [ ] **Step 1: `HoldButton`.** `onLongPressGesture(minimumDuration: HoldDuration.seconds, maximumDistance: 10, perform:, onPressingChanged:)`. Ao pousar: só arranca se `model.activeHold == nil` (senão ignora), põe `activeHold = target`, `Haptic.play(.touch)`, anima um véu `#040404` a 24% de baixo para cima (a pílula: da esquerda para a direita) com `.linear(duration: 0.7)`. Ao largar antes: véu a 0, `activeHold = nil`, nada conta. Ao completar: `onComplete()`, `activeHold = nil`.
- [ ] **Step 2: `ScoreboardView`** (PDF p. 5 e 6): linha de cima com `setsLine` a cinzento ou o estado a lima («Ponto de ouro», «Iguais 2», «Tie-break a 7», «Pontos · até 24»…); hora do sistema no canto (a do watchOS). Blocos «NÓS» lima e «ELES» cinzento, número em `Theme.number`, «Vant.» mais pequeno; bola preta em baixo ao centro no bloco de quem serve. «↺ Desfazer» em contorno branco a toda a largura, desativado sem nada para desfazer. Quando o ponto conta: `Haptic.play(.counted)`, o número salta (`.contentTransition(.numericText())` com escala) e o bloco pisca um contorno branco 0,22 s.
- [ ] **Step 3: Pulso em baixo:** com `@Environment(\.isLuminanceReduced)`, blocos `#3E4500` / `#2A2B2D`, texto `#C9CCD1`, linha de cima a 60%, sem «Desfazer».
- [ ] **Step 4: Avisos em `AppModel.point`:** `.setWon` → `Haptic.long`; `.switchSides` → `overlay = .switchSides` e `Haptic.double` 0,25 s depois; senão `.decisivePoint` → `overlay = .decisive(status)` e `Haptic.double`; o aviso sai sozinho ao fim de 2 s (e se se desfizer entretanto). `.matchOver` → `Haptic.long`, sem aviso. `OverlayView`: ecrã todo lima, «⇄ Trocar de lado» + `setsLine` (+ «Nós servimos» / «Eles servem» se há serviço) ou «Ponto de ouro» / «Star Point» + «Quem recebe escolhe o lado».
- [ ] **Step 5: Push, ver `watch-app` verde**
- [ ] **Step 6: Commit** `feat(relógio): marcador com toque comprido, vibrações e avisos`

---

### Task 9: Segundo ecrã, fim e últimos jogos

**Files:**
- Create: `Sources/ScoreboardUI/GameMenuView.swift`, `EndView.swift`, `HistoryView.swift`
- Modify: `RootView.swift`

- [ ] **Step 1: `GameMenuView`** (página 2 do `TabView` `.page`): formato curto, cartão com o resultado e «Desliza para voltar ao marcador», «Últimos jogos» (contorno branco, abre `HistoryView`), `HoldButton(.end)` vermelho «Terminar o jogo», «Mantém o dedo para terminar». Completar o toque abre um `.alert` com «Terminar» (destrutivo) e «Cancelar»; «Terminar» chama `model.stop()`.
- [ ] **Step 2: `EndView`** (PDF p. 6): «Ganharam Nós» / «Ganharam Eles» a lima, ou «Empatado» a branco; `resultText` em grande; pelas regras «formato · `durationText`»; terminado antes «Terminado antes do fim.» e, se havia pontos no jogo a meio, «O jogo a meio (30-15) não conta.» (os pontos em texto, como o marcador os mostrava). «Novo jogo» a lima → `model.newMatch()` (volta ao Novo jogo com a mesma escolha). Por baixo, `HoldButton(.undo)` «↺ Desfazer» enquanto `canUndo` (escolha nossa, por confirmar com o Francisco).
- [ ] **Step 3: `HistoryView`**: até 20 linhas, `resultText` e por baixo «Ganharam Nós · 22 out · Melhor de 3» (+ « · Terminado»); vazio: «Ainda não há jogos. Acaba um e aparece aqui.» Data `d MMM` no idioma do relógio, sem ponto final.
- [ ] **Step 4: Push, ver verde**
- [ ] **Step 5: Commit** `feat(relógio): menu do jogo, fim e últimos jogos`

---

### Task 10: Ecrã sempre ligado (sessão de treino)

**Files:**
- Create: `Sources/ScoreboardUI/WorkoutKeeper.swift`
- Modify: `AppModel.swift`

**Interfaces:**
- Produces: `@MainActor final class WorkoutKeeper { func begin() async; func end() }`

- [ ] **Step 1:** `begin()`: pede autorização só para partilhar `HKObjectType.workoutType()` (uma vez), cria `HKWorkoutSession(healthStore:configuration:)` com `activityType = .paddleSports`, `locationType = .unknown`, e `startActivity(with: Date())`. Sem `HKLiveWorkoutBuilder`, nada é gravado no Saúde. Se a autorização for recusada ou falhar, o jogo continua na mesma (só o ecrã pode voltar ao mostrador).
- [ ] **Step 2:** `AppModel`: `begin()` no `start()` e ao abrir a app com um jogo a decorrer; `end()` quando o jogo acaba (regras ou «Terminar»); `begin()` outra vez se se desfizer o fim.
- [ ] **Step 3: Push, ver verde; commit** `feat(relógio): sessão de treino para o ecrã não se apagar`

---

### Task 11: Prints dos ecrãs na CI

Para a UX e o Francisco verem os ecrãs antes do TestFlight (critério do PDF), e para nós os vermos sem Mac.

**Files:**
- Create: `Sources/ScoreboardUI/ScreenshotFixtures.swift`
- Modify: `AppModel.swift`, `.github/workflows/watch.yml`

- [ ] **Step 1:** Com o argumento de arranque `-screenshot <nome>` (lido de `UserDefaults.standard.string(forKey: "screenshot")`), o `AppModel` arranca numa sessão em memória (não grava) num destes estados: `setup`, `game` (6-4 · 3-2, 30-15, Nós a servir), `golden` (40-40), `star` (Vantagem 1), `tiebreak` (5-4), `switch` (aviso), `decisive`, `menu`, `end` (6-4 3-6 10-7), `stopped` (6-4 4-6 3-3, 30-15), `history`, `dim` (ignora; o pulso em baixo vê-se no relógio).
- [ ] **Step 2:** Job `screenshots` em `watch.yml` (só em `workflow_dispatch`): compilar para o simulador, criar e arrancar um Apple Watch de 41/42 mm e um de 45/46 mm, instalar, para cada estado `xcrun simctl launch … -screenshot <nome>`, esperar 2 s, `xcrun simctl io booted screenshot`, e repetir com `-AppleLanguages "(en)"`. Publicar as imagens como artefacto `relogio-prints`.
- [ ] **Step 3: Correr, descarregar** (`gh run download -n relogio-prints`), ver os ecrãs, comparar com as páginas 5 e 6 do PDF e corrigir o que estiver diferente.
- [ ] **Step 4: Commit** `feat(relógio): prints dos ecrãs na CI`

---

### Task 12: Codemagic, documentação e TestFlight

**Files:**
- Modify: `codemagic.yaml`, `docs/native-apps.md`

- [ ] **Step 1: `codemagic.yaml`** (workflow `ios-testflight`): passo «Regras do relógio» com `cd ios/AlinhoWatch && swift test` antes de «Compilar o .ipa». Assinatura dos dois bundle ids: o `ios_signing` com `bundle_identifier: pt.alinho.app` deve apanhar também os perfis de `pt.alinho.app.*`; se a build disser «No matching profiles» para o relógio, passar a listar `provisioning_profiles` explícitos. O `agvtool new-version -all` já numera os dois alvos.
- [ ] **Step 2: `docs/native-apps.md`**: secção «Apple Watch» com: onde está o código, como correr os testes (CI), o App ID com HealthKit, o «Fetch profiles», como fazer a build a partir do branch `feature/apple-watch`, como instalar pelo TestFlight, e a lista do jogo de teste da spec.
- [ ] **Step 3: Pedir ao Renato** (não se faz por nós): registar o App ID `pt.alinho.app.watchkitapp` com HealthKit no portal da Apple; «Fetch profiles» no Codemagic; arrancar «iOS → TestFlight» no branch `feature/apple-watch`.
- [ ] **Step 4: Commit e push** `docs(relógio): builds do Apple Watch no Codemagic`
- [ ] **Step 5:** Com a build no TestFlight: o Renato instala, confirma que a app abre no relógio, que um ponto conta com 0,7 s e que o ecrã fica ligado com o pulso em baixo. Depois, o jogo de teste de 90 min do Francisco (lista na spec).
