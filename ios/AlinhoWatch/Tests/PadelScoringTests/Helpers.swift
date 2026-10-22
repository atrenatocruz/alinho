import Foundation
@testable import PadelScoring

let t0 = Date(timeIntervalSince1970: 1_800_000_000)

func match(
    _ format: MatchFormat = .bestOf3,
    _ mode: DeuceMode = .golden,
    server: Team? = nil,
    total: Int? = 24
) -> MatchState {
    Scoring.newMatch(
        MatchConfig(format: format, deuceMode: mode, firstServer: server, pointsTotal: total),
        at: t0
    )
}

/// Joga uma sequência de pontos: `u` = Nós, `t` = Eles; espaços ignorados.
/// Devolve o estado final e os eventos de cada ponto.
func play(_ s: MatchState, _ seq: String) -> (MatchState, [Set<MatchEvent>]) {
    var state = s
    var events: [Set<MatchEvent>] = []
    for c in seq where c != " " {
        let r = Scoring.point(state, to: c == "u" ? .us : .them, at: t0)
        state = r.state
        events.append(r.events)
    }
    return (state, events)
}
