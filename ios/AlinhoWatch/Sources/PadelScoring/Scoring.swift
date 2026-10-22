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
            deuceCount: 0,
            server: isPoints ? nil : config.firstServer,
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
        case .tieBreak, .superTieBreak, .points: break
        }
        return PointResult(state: st, events: ev)
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
        guard st.phase == .game, st.points == [3, 3] else { return false }
        switch st.config.deuceMode {
        case .golden: return true
        case .starPoint: return st.deuceCount >= 3
        case .advantage: return false
        }
    }

    private static func winGame(_ st: inout MatchState, _ t: Team, _ ev: inout Set<MatchEvent>) {
        st.games[t.rawValue] += 1
        st.points = [0, 0]
        st.deuceCount = 0
        ev.insert(.gameWon)
        st.server = st.server?.other
    }
}
