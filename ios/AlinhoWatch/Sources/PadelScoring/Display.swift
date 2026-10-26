import Foundation

/// O que aparece em grande num bloco. `advantage` é «Vant.» (o texto é da UI).
public enum PointMark: Equatable, Sendable {
    case value(String)
    case advantage
}

/// O estado que a linha de cima mostra a lima. `nil` na `ScoreDisplay` = mostra
/// os sets e jogos (`MatchState.setsLine`).
public enum StatusLabel: Equatable, Sendable {
    case goldenPoint
    case starPoint
    /// «Iguais» (`nil`, nas vantagens) ou «Iguais 2» (Star Point).
    case deuce(Int?)
    case advantage(Int?)
    case tieBreak
    case superTieBreak
    /// Pontos da Fase 1 (só em jogos gravados antes dos Pontos por jogos).
    case points(total: Int?)
    /// Pontos por jogos: «Jogos 5-3 · até 24».
    case gamesRound(us: Int, them: Int, total: Int?)
    case paused
    /// O próximo ponto de alguém fecha um set.
    case setPoint
    /// O próximo ponto de alguém acaba o jogo todo.
    case matchPoint

    /// Estados do 40-40, que ganham a tudo menos à pausa.
    var isDeuceState: Bool {
        switch self {
        case .goldenPoint, .starPoint, .deuce, .advantage: true
        default: false
        }
    }
}

public struct ScoreDisplay: Equatable, Sendable {
    public let us: PointMark
    public let them: PointMark
    public let status: StatusLabel?

    public init(us: PointMark, them: PointMark, status: StatusLabel?) {
        self.us = us
        self.them = them
        self.status = status
    }
}

public enum Side: Equatable, Sendable {
    case right, left
}

public enum ServeLabel: Equatable, Sendable {
    case player(Player, Side)
}

/// Quem serve, para o bloco: na nossa dupla, quem e de que lado («Tu · direita»);
/// na deles, só «Servem».
public struct ServeInfo: Equatable, Sendable {
    public let us: ServeLabel?
    public let them: Bool

    public init(us: ServeLabel?, them: Bool) {
        self.us = us
        self.them = them
    }
}

private let gameValues = ["0", "15", "30", "40"]

/// Duração para o ecrã de fim: «45 min», «1 h 22 min» (mínimo 1 min).
/// Minutos de jogo na linha de estado: «23 min» (arredonda para baixo).
public func minutesText(_ seconds: TimeInterval) -> String {
    "\(Int(max(0, seconds) / 60)) min"
}

public func durationText(from start: Date, to end: Date) -> String {
    let minutes = max(1, Int((end.timeIntervalSince(start) / 60).rounded()))
    return minutes >= 60 ? "\(minutes / 60) h \(minutes % 60) min" : "\(minutes) min"
}

extension MatchState {
    /// Linha de cima durante o jogo: sets fechados e jogos do set a decorrer, «6-4 · 3-2».
    public var setsLine: String {
        if isRallyPoints { return "\(points[0])-\(points[1])" }
        if phase == .points { return "\(games[0])-\(games[1])" }
        return (sets.map { "\($0.us)-\($0.them)" } + ["\(games[0])-\(games[1])"]).joined(separator: " · ")
    }

    /// Resultado no fim e nos últimos jogos: «6-4 3-6 10-7»; terminado antes do fim
    /// junta os jogos do set a decorrer («6-4 4-6 3-3»); nos Pontos «15-9».
    public var resultText: String {
        if config.format == .points && pointsScoring == .rally { return "\(points[0])-\(points[1])" }
        if config.format == .points { return "\(games[0])-\(games[1])" }
        var parts = sets.map { "\($0.us)-\($0.them)" }
        if endReason == .stopped && (games[0] > 0 || games[1] > 0) { parts.append("\(games[0])-\(games[1])") }
        return parts.isEmpty ? "0-0" : parts.joined(separator: " ")
    }

    /// Tempo de jogo até `date`, sem as pausas.
    public func elapsed(at date: Date) -> TimeInterval {
        let end = endedAt ?? date
        let open = pausedAt.map { max(0, end.timeIntervalSince($0)) } ?? 0
        return max(0, end.timeIntervalSince(startedAt) - pausedSeconds - open)
    }

    /// A linha de estado do marcador. `nil` = mostra `setsLine`.
    public var statusLine: StatusLabel? {
        if pausedAt != nil { return .paused }
        let status = display.status
        if let status, status.isDeuceState { return status }
        if !isOver && !isRallyPoints {
            var setPoint = false
            for team in [Team.us, .them] {
                let events = Scoring.point(self, to: team, at: startedAt).events
                if events.contains(.matchOver) { return .matchPoint }
                if events.contains(.setWon) { setPoint = true }
            }
            if setPoint { return .setPoint }
        }
        return status
    }

    /// `nil` quando não se mostra quem serve.
    public var serveInfo: ServeInfo? {
        guard let server else { return nil }
        if server == .them { return ServeInfo(us: nil, them: true) }
        let side: Side = (points[0] + points[1]) % 2 == 0 ? .right : .left
        return ServeInfo(us: .player(ourServer ?? config.ourFirstServer, side), them: false)
    }

    public var display: ScoreDisplay {
        let a = points[0], b = points[1]
        switch phase {
        case .points where pointsScoring == .rally:
            return ScoreDisplay(us: .value("\(a)"), them: .value("\(b)"), status: .points(total: config.pointsTotal))
        case .points:
            return gameDisplay(fallback: .gamesRound(us: games[0], them: games[1], total: config.pointsTotal))
        case .tieBreak:
            return ScoreDisplay(us: .value("\(a)"), them: .value("\(b)"), status: .tieBreak)
        case .superTieBreak:
            return ScoreDisplay(us: .value("\(a)"), them: .value("\(b)"), status: .superTieBreak)
        case .game:
            return gameDisplay(fallback: nil)
        }
    }

    /// 0, 15, 30, 40 e os estados do 40-40; sem estado, `fallback`.
    private func gameDisplay(fallback: StatusLabel?) -> ScoreDisplay {
        let a = points[0], b = points[1]
        guard a >= 3 && b >= 3 else {
            return ScoreDisplay(us: .value(gameValues[min(a, 3)]), them: .value(gameValues[min(b, 3)]), status: fallback)
        }
        let forty = PointMark.value("40")
        let count: Int? = deuceMode == .starPoint ? deuceCount : nil
        if a == b {
            let status: StatusLabel = switch deuceMode {
            case .golden: .goldenPoint
            case .starPoint where deuceCount >= 3: .starPoint
            default: .deuce(count)
            }
            return ScoreDisplay(us: forty, them: forty, status: status)
        }
        return ScoreDisplay(
            us: a > b ? .advantage : forty,
            them: b > a ? .advantage : forty,
            status: .advantage(count)
        )
    }
}
