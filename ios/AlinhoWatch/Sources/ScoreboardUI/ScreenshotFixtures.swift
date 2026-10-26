#if os(watchOS)
import AlinhoSync
import Foundation
import PadelScoring

/// Nas prints: abrir logo nos «Jogos do mix» ou num jogo da lista.
enum MixScreen {
    case list
    case match(MixMatch)
}

/// Estados fixos para as prints dos ecrãs (job `screenshots` em .github/workflows/watch.yml).
/// A app arranca com `-screenshot <nome>`; nada é gravado.
enum ScreenshotFixtures {
    struct Fixture {
        var session: MatchSession
        var overlay: Overlay? = nil
        var page = 1
        var showHistory = false
        var idle = false
        /// Pulsação, média, kcal e autorização do Saúde para o ecrã do treino.
        var health: (Int?, Int?, Double, Bool)? = nil
        var endStep: EndStep? = nil
        /// Os jogos do mix (sem rede) e o ecrã do mix a abrir.
        var mix: MixModel? = nil
        var mixScreen: MixScreen? = nil
    }

    static var requested: String? { UserDefaults.standard.string(forKey: "screenshot") }

    @MainActor
    static func make(_ name: String) -> Fixture? {
        switch name {
        case "setup":
            return Fixture(session: MatchSession())
        case "setupPoints":
            var s = MatchSession()
            s.config = MatchConfig(format: .points, deuceMode: .golden, firstServer: nil, pointsTotal: 24)
            return Fixture(session: s)
        case "setupEndless":
            var s = MatchSession()
            s.config = MatchConfig(format: .endlessSet, deuceMode: .golden, firstServer: .us, pointsTotal: 24)
            return Fixture(session: s)
        case "scoreEndless":
            var s = session(.endlessSet, .golden, server: .them, minutesAgo: 50)
            games(&s, String(repeating: "u", count: 7))
            feed(&s, "uu t")
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
        case "scoreStack":
            return Fixture(session: inGame(server: .us, layout: .stack))
        case "scoreServeSide":
            return Fixture(session: inGame(server: .us))
        case "scorePaused":
            var s = inGame()
            s.togglePause(at: Date())
            return Fixture(session: s)
        case "scoreMatchPoint":
            return Fixture(session: inGame(games: "uuuuuu uuuuu", points: "uuu"))
        case "menu":
            return Fixture(session: inGame(server: .us), page: 0)
        case "training":
            return Fixture(session: inGame(), page: 2, health: (138, 131, 412, true))
        case "trainingDenied":
            return Fixture(session: inGame(), page: 2, health: (nil, nil, 0, false))
        case "idle":
            return Fixture(session: inGame(), idle: true)
        case "end":
            var s = session(.twoSetsSuperTieBreak, .golden, server: nil, minutesAgo: 82)
            games(&s, "uuuutttt uu ttttuuuu tt")
            feed(&s, "ttttttt uuuuuuuuuu")
            return Fixture(session: s)
        case "effort":
            var s = session(.bestOf3, .golden, server: nil, minutesAgo: 75)
            games(&s, "uuuuuu tttttt uuuuuu")
            return Fixture(session: s, endStep: .effort)
        case "endWithHealth":
            var s = session(.endlessSet, .golden, server: nil, minutesAgo: 70)
            games(&s, String(repeating: "u", count: 13) + String(repeating: "t", count: 11))
            s.stop(at: Date())
            if let id = s.current?.id {
                s.setHealth(averageHeartRate: 142, kilocalories: 610, for: id)
                s.setEffort(7, for: id)
            }
            return Fixture(session: s, endStep: .summary)
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
            feed(&s, String(repeating: "u", count: 15) + String(repeating: "t", count: 9))
            s.clearFinished()
            s.config = MatchConfig(format: .endlessSet, deuceMode: .golden, firstServer: nil, pointsTotal: 24)
            s.start(at: Date().addingTimeInterval(-4000))
            games(&s, String(repeating: "u", count: 7) + String(repeating: "t", count: 5))
            s.stop(at: Date())
            s.clearFinished()
            s.config = .default
            s.start(at: Date().addingTimeInterval(-5400))
            games(&s, "uuuutttt uu ttttuuuu tt")
            s.stop(at: Date())
            s.clearFinished()
            return Fixture(session: s, showHistory: true)
        case "mixList":
            let list = [
                mixMatch(round: 2, court: 1, partner: "Rita Ferreira", opponents: ["Rui Martins", "Ana Pires"]),
                mixMatch(round: 2, court: 3, partner: "Tiago Sousa", opponents: ["Marta Costa Lopes", "João Almeida"]),
            ]
            return Fixture(session: MatchSession(), mix: MixModel(preview: list), mixScreen: .list)
        case "mixTaken":
            let m = mixMatch(round: 3, court: 2, partner: "Rita Ferreira", opponents: ["Rui Martins", "Ana Pires"],
                             scorer: "Rita Ferreira")
            return Fixture(session: MatchSession(), mix: MixModel(preview: [m]), mixScreen: .match(m))
        case "endMixSent":
            var s = session(.twoSetsSuperTieBreak, .golden, server: nil, minutesAgo: 64)
            games(&s, "uuuutttt uu ttttuuuu tt")
            feed(&s, "ttttttt uuuuuuuuuu")
            let link = s.current.map {
                MixLink(localMatchID: $0.id, mixMatchID: UUID(), side: .a, title: "Mix de quinta")
            }
            return Fixture(session: s, mix: MixModel(preview: [], link: link, status: .sent))
        default:
            return nil
        }
    }

    /// Um jogo do mix como o `list_my_watch_mix_matches` o devolve (2 sets + super tie-break).
    private static func mixMatch(
        round: Int, court: Int, partner: String, opponents: [String], scorer: String? = nil
    ) -> MixMatch {
        var o: [String: Any] = [
            "match_id": UUID().uuidString,
            "game_id": UUID().uuidString,
            "game_name": "Mix de quinta",
            "round_number": round,
            "court_number": court,
            "my_side": "a",
            "partner_name": partner,
            "opponent_names": opponents,
            "format": "mix",
            "scoring_format": "melhor_2_sets",
            "deuce_mode": "ponto_de_ouro",
            "tiebreak_8_8": NSNull(),
            "scorer_id": NSNull(),
            "scorer_name": NSNull(),
        ]
        if let scorer {
            o["scorer_id"] = UUID().uuidString
            o["scorer_name"] = scorer
        }
        let data = try! JSONSerialization.data(withJSONObject: o)
        return try! JSONDecoder().decode(MixMatch.self, from: data)
    }

    /// Jogo a 6-4 · 3-2 e 30-15, com Nós a servir (como na proposta).
    private static func inGame(
        _ mode: DeuceMode = .golden,
        server: Team = .them,
        layout: ScoreLayout = .side,
        games seq: String = "uuuutttt uu uuu tt",
        points: String = "uu t"
    ) -> MatchSession {
        var s = session(.bestOf3, mode, server: server, minutesAgo: 40, layout: layout)
        games(&s, seq)
        feed(&s, points)
        return s
    }

    private static func session(
        _ format: MatchFormat, _ mode: DeuceMode, server: Team?, minutesAgo: Double, layout: ScoreLayout = .side
    ) -> MatchSession {
        var s = MatchSession()
        s.config = MatchConfig(format: format, deuceMode: mode, firstServer: server, pointsTotal: 24)
        s.config.layout = layout
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
