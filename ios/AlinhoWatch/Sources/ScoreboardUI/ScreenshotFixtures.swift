#if os(watchOS)
import Foundation
import PadelScoring

/// Estados fixos para as prints dos ecrãs (job `screenshots` em .github/workflows/watch.yml).
/// A app arranca com `-screenshot <nome>`; nada é gravado.
enum ScreenshotFixtures {
    struct Fixture {
        var session: MatchSession
        var overlay: Overlay? = nil
        var page = 0
        var showHistory = false
    }

    static var requested: String? { UserDefaults.standard.string(forKey: "screenshot") }

    static func make(_ name: String) -> Fixture? {
        switch name {
        case "setup":
            return Fixture(session: MatchSession())
        case "setupPoints":
            var s = MatchSession()
            s.config = MatchConfig(format: .points, deuceMode: .golden, firstServer: nil, pointsTotal: 24)
            return Fixture(session: s)
        case "setupServeUs":
            var s = MatchSession()
            s.config = MatchConfig(format: .bestOf3, deuceMode: .starPoint, firstServer: .us, pointsTotal: 24)
            s.config.ourFirstServer = .partner
            s.config.layout = .stack
            return Fixture(session: s)
        case "game":
            return Fixture(session: inGame())
        case "golden":
            return Fixture(session: inGame(points: "uuuttt"))
        case "star":
            return Fixture(session: inGame(.starPoint, points: "uuuttt u"))
        case "tiebreak":
            return Fixture(session: inGame(games: "uuuutttt uu uuuuu ttttt u t", points: "uuuuu tttt"))
        case "switch":
            return Fixture(session: inGame(points: ""), overlay: .switchSides)
        case "decisive":
            return Fixture(session: inGame(points: "uuuttt"), overlay: .decisive(.goldenPoint))
        case "menu":
            return Fixture(session: inGame(), page: 1)
        case "end":
            var s = session(.twoSetsSuperTieBreak, .golden, server: nil, minutesAgo: 82)
            games(&s, "uuuutttt uu ttttuuuu tt")
            feed(&s, "ttttttt uuuuuuuuuu")
            return Fixture(session: s)
        case "stopped":
            var s = session(.bestOf3, .golden, server: nil, minutesAgo: 90)
            games(&s, "uuuutttt uu ttttuuuu tt uuuttt")
            feed(&s, "uu t")
            s.stop(at: Date())
            return Fixture(session: s)
        case "history":
            var s = MatchSession()
            s.config = MatchConfig(format: .points, deuceMode: .golden, firstServer: nil, pointsTotal: 24)
            s.start(at: Date().addingTimeInterval(-3600))
            games(&s, String(repeating: "u", count: 13) + String(repeating: "t", count: 11))
            s.clearFinished()
            s.config = .default
            s.start(at: Date().addingTimeInterval(-5400))
            games(&s, "uuuutttt uu ttttuuuu tt")
            s.stop(at: Date())
            s.clearFinished()
            return Fixture(session: s, showHistory: true)
        default:
            return nil
        }
    }

    /// Jogo a 6-4 · 3-2 e 30-15, com Nós a servir (como na proposta).
    private static func inGame(
        _ mode: DeuceMode = .golden,
        games seq: String = "uuuutttt uu uuu tt",
        points: String = "uu t"
    ) -> MatchSession {
        var s = session(.bestOf3, mode, server: .them, minutesAgo: 40)
        games(&s, seq)
        feed(&s, points)
        return s
    }

    private static func session(_ format: MatchFormat, _ mode: DeuceMode, server: Team?, minutesAgo: Double) -> MatchSession {
        var s = MatchSession()
        s.config = MatchConfig(format: format, deuceMode: mode, firstServer: server, pointsTotal: 24)
        s.start(at: Date().addingTimeInterval(-minutesAgo * 60))
        return s
    }

    private static func feed(_ s: inout MatchSession, _ seq: String) {
        for c in seq where c != " " { s.point(c == "u" ? .us : .them, at: Date()) }
    }

    private static func games(_ s: inout MatchSession, _ seq: String) {
        for c in seq where c != " " { feed(&s, String(repeating: c, count: 4)) }
    }
}
#endif
