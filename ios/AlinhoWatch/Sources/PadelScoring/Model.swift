import Foundation

/// «Nós» é sempre a dupla de quem tem o relógio. O `rawValue` é o índice em
/// `MatchState.games` e `MatchState.points`.
public enum Team: Int, Codable, Equatable, Sendable {
    case us = 0, them = 1

    public var other: Team { self == .us ? .them : .us }
}

/// Quem da nossa dupla serve. Os códigos são os do protótipo.
public enum Player: String, Codable, Equatable, Sendable, CaseIterable {
    case me = "eu", partner = "parceiro"

    public var other: Player { self == .me ? .partner : .me }
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

/// Como se contam os Pontos. `rally` é a Fase 1 (cada ponto soma 1) e só existe
/// para ler jogos gravados por essa versão; os jogos novos são `games`: cada jogo
/// conta-se 0, 15, 30, 40 e a ronda soma jogos, sem sets.
public enum PointsScoring: String, Codable, Equatable, Sendable {
    case rally, games
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
    /// Na nossa dupla, quem serve primeiro (só conta com `firstServer == .us`).
    public var ourFirstServer: Player = .me

    public init(format: MatchFormat, deuceMode: DeuceMode, firstServer: Team?, pointsTotal: Int?) {
        self.format = format
        self.deuceMode = deuceMode
        self.firstServer = firstServer
        self.pointsTotal = pointsTotal
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        format = try c.decode(MatchFormat.self, forKey: .format)
        deuceMode = try c.decode(DeuceMode.self, forKey: .deuceMode)
        firstServer = try c.decodeIfPresent(Team.self, forKey: .firstServer)
        pointsTotal = try c.decodeIfPresent(Int.self, forKey: .pointsTotal)
        ourFirstServer = try c.decodeIfPresent(Player.self, forKey: .ourFirstServer) ?? .me
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
    /// Só conta nos Pontos. Um jogo gravado sem este campo é da Fase 1 (`rally`).
    public var pointsScoring: PointsScoring
    /// Star Point: quantas vezes já se chegou a iguais neste jogo.
    public var deuceCount: Int
    public var server: Team?
    /// Quem da nossa dupla serve quando `server == .us`.
    public var ourServer: Player?
    /// Quem da nossa dupla serviu da última vez, para alternar.
    public var lastOurServer: Player?
    public var tieBreakFirstServer: Team?
    public let startedAt: Date
    /// Em pausa desde; `nil` = a jogar.
    public var pausedAt: Date? = nil
    /// Tempo já passado em pausas fechadas.
    public var pausedSeconds: TimeInterval = 0
    public var endedAt: Date?
    public var endReason: EndReason?
    public var winner: Team?

    public var isOver: Bool { endReason != nil }

    /// Pontos de 0, 15, 30, 40 a decorrer: num jogo de um set, ou nos Pontos por jogos.
    var isGamePhase: Bool { phase == .game || (phase == .points && pointsScoring == .games) }
    /// Pontos da Fase 1, que somam 1 a cada ponto.
    var isRallyPoints: Bool { phase == .points && pointsScoring == .rally }

    /// Passa o serviço para `team`. Quando voltamos a servir, serve o outro da
    /// nossa dupla (na primeira vez, quem se escolheu no Novo jogo).
    mutating func passServe(to team: Team?) {
        guard server != nil, let team else { return }
        if team == .us && server != .us {
            ourServer = lastOurServer?.other ?? config.ourFirstServer
            lastOurServer = ourServer
        }
        server = team
    }
}

extension MatchState {
    // Os campos novos lêem-se com `decodeIfPresent`, para um jogo gravado por uma
    // versão anterior da app continuar a abrir.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        config = try c.decode(MatchConfig.self, forKey: .config)
        sets = try c.decode([SetScore].self, forKey: .sets)
        games = try c.decode([Int].self, forKey: .games)
        points = try c.decode([Int].self, forKey: .points)
        phase = try c.decode(Phase.self, forKey: .phase)
        pointsScoring = try c.decodeIfPresent(PointsScoring.self, forKey: .pointsScoring) ?? .rally
        deuceCount = try c.decode(Int.self, forKey: .deuceCount)
        server = try c.decodeIfPresent(Team.self, forKey: .server)
        ourServer = try c.decodeIfPresent(Player.self, forKey: .ourServer)
        lastOurServer = try c.decodeIfPresent(Player.self, forKey: .lastOurServer)
        tieBreakFirstServer = try c.decodeIfPresent(Team.self, forKey: .tieBreakFirstServer)
        startedAt = try c.decode(Date.self, forKey: .startedAt)
        pausedAt = try c.decodeIfPresent(Date.self, forKey: .pausedAt)
        pausedSeconds = try c.decodeIfPresent(TimeInterval.self, forKey: .pausedSeconds) ?? 0
        endedAt = try c.decodeIfPresent(Date.self, forKey: .endedAt)
        endReason = try c.decodeIfPresent(EndReason.self, forKey: .endReason)
        winner = try c.decodeIfPresent(Team.self, forKey: .winner)
    }
}

public enum MatchEvent: Hashable, Sendable {
    case point, gameWon, setWon, matchOver, switchSides, decisivePoint
}

public struct PointResult: Equatable, Sendable {
    public let state: MatchState
    public let events: Set<MatchEvent>
}
