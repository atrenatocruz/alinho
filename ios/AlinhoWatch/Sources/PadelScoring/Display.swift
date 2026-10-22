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
    case points(total: Int?)
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

extension MatchState {
    public var display: ScoreDisplay {
        let a = points[0], b = points[1]
        switch phase {
        case .points:
            return ScoreDisplay(us: .value("\(a)"), them: .value("\(b)"), status: .points(total: config.pointsTotal))
        case .tieBreak:
            return ScoreDisplay(us: .value("\(a)"), them: .value("\(b)"), status: .tieBreak)
        case .superTieBreak:
            return ScoreDisplay(us: .value("\(a)"), them: .value("\(b)"), status: .superTieBreak)
        case .game:
            guard a >= 3 && b >= 3 else {
                return ScoreDisplay(us: .value(gameValues[min(a, 3)]), them: .value(gameValues[min(b, 3)]), status: nil)
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
}
