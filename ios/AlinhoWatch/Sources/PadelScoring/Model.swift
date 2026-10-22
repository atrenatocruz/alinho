import Foundation

/// «Nós» é sempre a dupla de quem tem o relógio. O `rawValue` é o índice em
/// `MatchState.games` e `MatchState.points`.
public enum Team: Int, Codable, Equatable, Sendable {
    case us = 0, them = 1

    public var other: Team { self == .us ? .them : .us }
}

/// Os códigos são os do protótipo (`m3`, `stb`, …), que é a referência das regras.
public enum MatchFormat: String, Codable, Equatable, Sendable, CaseIterable {
    case bestOf3 = "m3"
    case twoSetsSuperTieBreak = "stb"
    case proSet9 = "pro9"
    case oneSet = "s1"
    case points = "pts"

    public var gamesPerSet: Int { self == .proSet9 ? 9 : 6 }
    public var tieBreakAt: Int { self == .proSet9 ? 8 : 6 }
    public var setsToWin: Int { self == .bestOf3 || self == .twoSetsSuperTieBreak ? 2 : 1 }
}

/// O que acontece aos 40-40 (só nos jogos, nunca nos tie-breaks).
public enum DeuceMode: String, Codable, Equatable, Sendable, CaseIterable {
    case golden = "ouro"
    case starPoint = "star"
    case advantage = "vant"
}

public enum Phase: String, Codable, Equatable, Sendable {
    case game, tieBreak, superTieBreak, points
}

public enum SetKind: String, Codable, Equatable, Sendable {
    case normal, tieBreak, superTieBreak
}

public struct SetScore: Codable, Equatable, Sendable {
    public var us: Int
    public var them: Int
    public var kind: SetKind

    public init(_ us: Int, _ them: Int, _ kind: SetKind) {
        self.us = us
        self.them = them
        self.kind = kind
    }
}

public struct MatchConfig: Codable, Equatable, Sendable {
    public var format: MatchFormat
    public var deuceMode: DeuceMode
    /// `nil` = «Não mostrar» quem serve.
    public var firstServer: Team?
    /// Só nos Pontos; `nil` = sem total.
    public var pointsTotal: Int?

    public init(format: MatchFormat, deuceMode: DeuceMode, firstServer: Team?, pointsTotal: Int?) {
        self.format = format
        self.deuceMode = deuceMode
        self.firstServer = firstServer
        self.pointsTotal = pointsTotal
    }

    public static let `default` = MatchConfig(format: .bestOf3, deuceMode: .golden, firstServer: nil, pointsTotal: 24)
    public static let pointsTotalOptions: [Int?] = [16, 24, 32, nil]
}

public enum EndReason: String, Codable, Equatable, Sendable {
    /// Acabou pelas regras.
    case rules
    /// «Terminar o jogo» antes do fim.
    case stopped
}

public struct MatchState: Codable, Equatable, Sendable {
    public let id: UUID
    public let config: MatchConfig
    public var sets: [SetScore]
    /// Jogos do set a decorrer, `[nós, eles]`.
    public var games: [Int]
    /// Pontos do jogo (ou tie-break, ou ronda de Pontos) a decorrer, `[nós, eles]`.
    /// Num jogo vão até `[3, 3]` (40-40); a vantagem é `[4, 3]`.
    public var points: [Int]
    public var phase: Phase
    /// Star Point: quantas vezes já se chegou a iguais neste jogo.
    public var deuceCount: Int
    public var server: Team?
    public var tieBreakFirstServer: Team?
    public let startedAt: Date
    public var endedAt: Date?
    public var endReason: EndReason?
    public var winner: Team?

    public var isOver: Bool { endReason != nil }
}

public enum MatchEvent: Hashable, Sendable {
    case point, gameWon, setWon, matchOver, switchSides, decisivePoint
}

public struct PointResult: Equatable, Sendable {
    public let state: MatchState
    public let events: Set<MatchEvent>
}
