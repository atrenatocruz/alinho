import Foundation

/// Regras de pontuação do BA (spec, «Regras de pontuação»). Funções puras: cada
/// uma recebe um estado e devolve outro, para o desfazer ser só guardar estados.
public enum Scoring {
    public static func newMatch(_ config: MatchConfig, id: UUID = UUID(), at date: Date) -> MatchState {
        let isPoints = config.format == .points
        return MatchState(
            id: id,
            config: config,
            sets: [],
            games: [0, 0],
            points: [0, 0],
            phase: isPoints ? .points : .game,
            pointsScoring: .games,
            deuceCount: 0,
            server: config.firstServer,
            ourServer: config.firstServer == .us ? config.ourFirstServer : nil,
            lastOurServer: config.firstServer == .us ? config.ourFirstServer : nil,
            tieBreakFirstServer: nil,
            startedAt: date,
            endedAt: nil,
            endReason: nil,
            winner: nil
        )
    }

    /// Um ponto para `team`. Num jogo acabado não faz nada.
    public static func point(_ s: MatchState, to team: Team, at date: Date) -> PointResult {
        guard !s.isOver else { return PointResult(state: s, events: []) }
        var st = s
        var ev: Set<MatchEvent> = [.point]
        switch st.phase {
        case .game: gamePoint(&st, team, &ev)
        case .tieBreak, .superTieBreak: tieBreakPoint(&st, team, &ev)
        case .points where st.pointsScoring == .games: gamePoint(&st, team, &ev)
        case .points: rallyPoint(&st, team)
        }
        if st.isOver {
            st.endedAt = date
            ev.insert(.matchOver)
            ev.remove(.switchSides)             // acabou: já não se troca de lado
        }
        return PointResult(state: st, events: ev)
    }

    /// «Terminar o jogo» antes do fim: contam os sets e os jogos já fechados; os
    /// pontos do jogo (ou tie-break) a meio ficam no estado mas não contam.
    public static func stop(_ s: MatchState, at date: Date) -> MatchState {
        guard !s.isOver else { return s }
        var st = s
        finish(&st, .stopped)
        st.endedAt = date
        return st
    }

    // MARK: - Pontos da Fase 1 (cada ponto soma 1; só para jogos gravados antes)

    private static func rallyPoint(_ st: inout MatchState, _ t: Team) {
        st.points[t.rawValue] += 1
        if let total = st.config.pointsTotal, st.points[0] + st.points[1] >= total {
            finish(&st, .rules)
        }
    }

    // MARK: - Jogo (0, 15, 30, 40)

    private static func gamePoint(_ st: inout MatchState, _ t: Team, _ ev: inout Set<MatchEvent>) {
        let me = t.rawValue, op = t.other.rawValue
        let a = st.points[me], b = st.points[op]
        if a >= 3 && b >= 3 {
            let mode = st.config.deuceMode
            if mode == .golden || a > b || (a == b && mode == .starPoint && st.deuceCount >= 3) {
                winGame(&st, t, &ev)
            } else if a == b {
                st.points[me] += 1                  // vantagem
            } else {
                st.points[op] -= 1                  // o outro perde a vantagem: iguais
                if mode == .starPoint { st.deuceCount += 1 }
                if isDecisive(st) { ev.insert(.decisivePoint) }
            }
            return
        }
        if a >= 3 { winGame(&st, t, &ev); return }
        st.points[me] += 1
        if st.points == [3, 3] {
            st.deuceCount = 1
            if isDecisive(st) { ev.insert(.decisivePoint) }
        }
    }

    /// 40-40 em que o ponto seguinte decide: ponto de ouro, ou Star Point ao terceiro iguais.
    static func isDecisive(_ st: MatchState) -> Bool {
        guard st.isGamePhase, st.points == [3, 3] else { return false }
        switch st.config.deuceMode {
        case .golden: return true
        case .starPoint: return st.deuceCount >= 3
        case .advantage: return false
        }
    }

    private static func winGame(_ st: inout MatchState, _ t: Team, _ ev: inout Set<MatchEvent>) {
        let format = st.config.format
        st.games[t.rawValue] += 1
        st.points = [0, 0]
        st.deuceCount = 0
        ev.insert(.gameWon)
        st.passServe(to: st.server?.other)
        if st.phase == .points {
            // Pontos: a ronda soma jogos e acaba quando a soma chega ao total.
            if let total = st.config.pointsTotal, st.games[0] + st.games[1] >= total {
                finish(&st, .rules)
            } else if (st.games[0] + st.games[1]) % 2 == 1 {
                ev.insert(.switchSides)
            }
            return
        }
        let mine = st.games[t.rawValue], theirs = st.games[t.other.rawValue]
        if mine >= format.gamesPerSet && mine - theirs >= 2 {
            closeSet(&st, SetScore(st.games[0], st.games[1], .normal), &ev)
            return
        }
        // Jogos ímpares do set: 1.º, 3.º, 5.º…
        if (st.games[0] + st.games[1]) % 2 == 1 { ev.insert(.switchSides) }
        if st.games == [format.tieBreakAt, format.tieBreakAt] {
            st.phase = .tieBreak
            st.tieBreakFirstServer = st.server
        }
    }

    // MARK: - Tie-break (a 7) e super tie-break (a 10)

    private static func tieBreakPoint(_ st: inout MatchState, _ t: Team, _ ev: inout Set<MatchEvent>) {
        let me = t.rawValue, op = t.other.rawValue
        st.points[me] += 1
        let played = st.points[0] + st.points[1]
        // 1.º ponto: quem calhava; depois muda a cada 2 pontos (1, 2, 2, 2…).
        if st.server != nil, let first = st.tieBreakFirstServer {
            st.passServe(to: ((played + 1) / 2) % 2 == 0 ? first : first.other)
        }
        let target = st.phase == .tieBreak ? 7 : 10
        guard st.points[me] >= target && st.points[me] - st.points[op] >= 2 else {
            if played % 6 == 0 { ev.insert(.switchSides) }
            return
        }
        if st.phase == .tieBreak {
            // Conta como um jogo (7-6, ou 9-8 no pro set). No set seguinte serve
            // primeiro quem recebeu o 1.º ponto do tie-break.
            st.games[me] += 1
            ev.insert(.gameWon)
            st.passServe(to: st.tieBreakFirstServer?.other)
            closeSet(&st, SetScore(st.games[0], st.games[1], .tieBreak), &ev)
        } else {
            closeSet(&st, SetScore(st.points[0], st.points[1], .superTieBreak), &ev)
        }
    }

    // MARK: - Sets e fim

    private static func closeSet(_ st: inout MatchState, _ score: SetScore, _ ev: inout Set<MatchEvent>) {
        st.sets.append(score)
        st.games = [0, 0]
        st.points = [0, 0]
        ev.insert(.setWon)
        // Troca-se se o número de jogos do set for ímpar (6-3 sim, 6-4 não).
        if score.kind != .superTieBreak && (score.us + score.them) % 2 == 1 { ev.insert(.switchSides) }
        let won = setsWon(st.sets)
        if max(won[0], won[1]) >= st.config.format.setsToWin {
            finish(&st, .rules)
        } else if st.config.format == .twoSetsSuperTieBreak && won == [1, 1] {
            st.phase = .superTieBreak
            st.tieBreakFirstServer = st.server
        } else {
            st.phase = .game
        }
    }

    static func setsWon(_ sets: [SetScore]) -> [Int] {
        sets.reduce(into: [0, 0]) { won, set in
            if set.us > set.them { won[0] += 1 } else if set.them > set.us { won[1] += 1 }
        }
    }

    private static func finish(_ st: inout MatchState, _ reason: EndReason) {
        st.endReason = reason
        func leader(_ x: [Int]) -> Team? { x[0] > x[1] ? .us : x[1] > x[0] ? .them : nil }
        if st.isRallyPoints {
            st.winner = leader(st.points)
        } else if st.phase == .points {
            st.winner = leader(st.games)
        } else {
            // Com os sets empatados, ganha quem tem mais jogos no set a decorrer.
            st.winner = leader(setsWon(st.sets)) ?? (reason == .stopped ? leader(st.games) : nil)
        }
    }
}
