import Foundation

/// Um jogo acabado, como aparece em «Últimos jogos». Guarda já o que a Fase 2
/// vai mandar à app (formato, modo do 40-40, resultado, dia, hora e duração).
public struct MatchRecord: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let format: MatchFormat
    public let deuceMode: DeuceMode
    public let sets: [SetScore]
    /// Só nos Pontos da Fase 1 (pontos corridos).
    public let points: [Int]
    /// Só nos Pontos por jogos: os jogos da ronda.
    public let games: [Int]
    public let winner: Team?
    public let endReason: EndReason
    public let startedAt: Date
    public let endedAt: Date
    public let resultText: String

    init(_ s: MatchState) {
        id = s.id
        format = s.config.format
        deuceMode = s.config.deuceMode
        sets = s.sets
        let isPoints = s.config.format == .points
        points = isPoints && s.pointsScoring == .rally ? s.points : []
        games = isPoints && s.pointsScoring == .games ? s.games : []
        winner = s.winner
        endReason = s.endReason ?? .rules
        startedAt = s.startedAt
        endedAt = s.endedAt ?? s.startedAt
        resultText = s.resultText
    }
}

extension MatchRecord {
    // Campos novos com `decodeIfPresent`: os registos da Fase 1 continuam a abrir.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        format = try c.decode(MatchFormat.self, forKey: .format)
        deuceMode = try c.decode(DeuceMode.self, forKey: .deuceMode)
        sets = try c.decode([SetScore].self, forKey: .sets)
        points = try c.decode([Int].self, forKey: .points)
        games = try c.decodeIfPresent([Int].self, forKey: .games) ?? []
        winner = try c.decodeIfPresent(Team.self, forKey: .winner)
        endReason = try c.decode(EndReason.self, forKey: .endReason)
        startedAt = try c.decode(Date.self, forKey: .startedAt)
        endedAt = try c.decode(Date.self, forKey: .endedAt)
        resultText = try c.decode(String.self, forKey: .resultText)
    }
}

/// Tudo o que o relógio guarda: a última escolha, o jogo a decorrer, a pilha de
/// desfazer (até ao primeiro ponto) e os últimos jogos.
public struct MatchSession: Codable, Equatable, Sendable {
    public static let historyLimit = 20

    public var config: MatchConfig = .default
    public private(set) var current: MatchState?
    public private(set) var undoStack: [MatchState] = []
    /// O mais recente primeiro.
    public private(set) var history: [MatchRecord] = []

    public init() {}

    public var canUndo: Bool { current != nil && !undoStack.isEmpty }

    public mutating func start(at date: Date) {
        current = Scoring.newMatch(config, at: date)
        undoStack = []
    }

    @discardableResult
    public mutating func point(_ team: Team, at date: Date) -> Set<MatchEvent> {
        guard let s = current, !s.isOver else { return [] }
        let r = Scoring.point(s, to: team, at: date)
        undoStack.append(s)
        current = r.state
        if r.state.isOver { archive(r.state) }
        return r.events
    }

    /// Volta ao estado exato de antes do último ponto (ou de «Terminar»).
    @discardableResult
    public mutating func undo() -> Bool {
        guard let s = current, let previous = undoStack.popLast() else { return false }
        if s.isOver { history.removeAll { $0.id == s.id } }
        current = previous
        return true
    }

    public mutating func stop(at date: Date) {
        guard let s = current, !s.isOver else { return }
        undoStack.append(s)
        let stopped = Scoring.stop(s, at: date)
        current = stopped
        archive(stopped)
    }

    /// Um jogo de Pontos da Fase 1 (pontos corridos) a meio quando a app atualizou:
    /// termina-se como estava e vai para os últimos jogos, em vez de se continuar
    /// com regras que já não são as dele.
    public mutating func retireLegacyPoints(at date: Date) {
        guard let s = current, !s.isOver, s.isRallyPoints else { return }
        archive(Scoring.stop(s, at: date))
        current = nil
        undoStack = []
    }

    /// «Novo jogo» no ecrã de fim: o jogo acabado sai do ecrã (fica nos últimos jogos).
    public mutating func clearFinished() {
        guard current?.isOver == true else { return }
        current = nil
        undoStack = []
    }

    private mutating func archive(_ s: MatchState) {
        history.insert(MatchRecord(s), at: 0)
        if history.count > Self.historyLimit { history.removeLast(history.count - Self.historyLimit) }
    }
}
