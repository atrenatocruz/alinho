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

private let gameValues = ["0", "15", "30", "40"]

/// Duração para o ecrã de fim: «45 min», «1 h 22 min» (mínimo 1 min).
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
        let count: Int? = config.deuceMode == .starPoint ? deuceCount : nil
        if a == b {
            let status: StatusLabel = switch config.deuceMode {
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
