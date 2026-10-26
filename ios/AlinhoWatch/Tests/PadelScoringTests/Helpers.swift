import Foundation
@testable import PadelScoring

let t0 = Date(timeIntervalSince1970: 1_800_000_000)

func match(
    _ format: MatchFormat = .bestOf3,
    _ mode: DeuceMode = .golden,
    server: Team? = nil,
    first: Player = .me,
    total: Int? = 24
) -> MatchState {
    var config = MatchConfig(format: format, deuceMode: mode, firstServer: server, pointsTotal: total)
    config.ourFirstServer = first
    return Scoring.newMatch(config, at: t0)
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

/// Joga jogos inteiros (4 pontos seguidos) por letra: `u` = Nós, `t` = Eles.
/// Devolve os eventos do último ponto de cada jogo.
func games(_ s: MatchState, _ seq: String) -> (MatchState, [Set<MatchEvent>]) {
    var state = s
    var events: [Set<MatchEvent>] = []
    for c in seq where c != " " {
        let (next, ev) = play(state, String(repeating: c, count: 4))
        state = next
        events.append(ev.last!)
    }
    return (state, events)
}

/// Uma sessão como a Fase 1 a gravava: Pontos a meio, com pontos corridos e sem
/// a chave `pointsScoring` (que só existe desde os Pontos por jogos).
func legacyPointsSessionJSON(points: [Int]) throws -> Data {
    var s = MatchSession()
    s.config = MatchConfig(format: .points, deuceMode: .golden, firstServer: nil, pointsTotal: 24)
    s.start(at: t0)
    var root = try JSONSerialization.jsonObject(with: JSONEncoder().encode(s)) as! [String: Any]
    var current = root["current"] as! [String: Any]
    current["points"] = points
    current["server"] = nil
    current.removeValue(forKey: "pointsScoring")
    root["current"] = current
    return try JSONSerialization.data(withJSONObject: root)
}

/// Uma sessão com `m` a decorrer e a pilha de desfazer vazia.
func session(started m: MatchState) -> MatchSession {
    MatchSession(current: m)
}
