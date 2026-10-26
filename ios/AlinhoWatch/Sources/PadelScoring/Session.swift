import Foundation

/// Um jogo acabado, como aparece em «Últimos jogos». Guarda já o que a Fase 2
/// vai mandar à app (formato, modo do 40-40, resultado, dia, hora e duração).
public struct MatchRecord: Codable, Equatable, Identifiable, Sendable {
    /// 1 = Fase 1; 2 = com minutos, esforço e treino.
    public static let currentVersion = 2

    public let version: Int
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
    /// Minutos de jogo, sem as pausas (mínimo 1).
    public let minutes: Int
    /// «Quão duro foi?», de 1 a 10; `nil` = saltou.
    public internal(set) var effort: Int?
    public internal(set) var averageHeartRate: Int?
    public internal(set) var activeKilocalories: Int?

    init(_ s: MatchState) {
        version = Self.currentVersion
        id = s.id
        format = s.config.format
        deuceMode = s.deuceMode
        sets = s.sets
        let isPoints = s.config.format == .points
        points = isPoints && s.pointsScoring == .rally ? s.points : []
        games = isPoints && s.pointsScoring == .games ? s.games : []
        winner = s.winner
        endReason = s.endReason ?? .rules
        startedAt = s.startedAt
        endedAt = s.endedAt ?? s.startedAt
        resultText = s.resultText
        minutes = Self.minutes(s.elapsed(at: endedAt))
        effort = nil
        averageHeartRate = nil
        activeKilocalories = nil
    }

    static func minutes(_ seconds: TimeInterval) -> Int {
        max(1, Int((seconds / 60).rounded()))
    }
}

extension MatchRecord {
    // Campos novos com `decodeIfPresent`: os registos da Fase 1 continuam a abrir.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = try c.decodeIfPresent(Int.self, forKey: .version) ?? 1
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
        minutes = try c.decodeIfPresent(Int.self, forKey: .minutes)
            ?? Self.minutes(endedAt.timeIntervalSince(startedAt))
        effort = try c.decodeIfPresent(Int.self, forKey: .effort)
        averageHeartRate = try c.decodeIfPresent(Int.self, forKey: .averageHeartRate)
        activeKilocalories = try c.decodeIfPresent(Int.self, forKey: .activeKilocalories)
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

    init(current: MatchState) {
        self.current = current
    }

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
        var stopped = s
        stopped.resume(at: date)
        stopped = Scoring.stop(stopped, at: date)
        current = stopped
        archive(stopped)
    }

    // MARK: - Segundo ecrã (cada ação desfaz-se com o «Desfazer»)

    public mutating func togglePause(at date: Date) {
        change { st in
            if st.pausedAt != nil { st.resume(at: date) } else { st.pausedAt = date }
        }
    }

    /// «Mudar quem serve»: vale do próximo ponto em diante. `player` só com `.us`.
    public mutating func setServer(_ team: Team, player: Player?) {
        change { st in
            st.server = team
            if team == .us {
                st.ourServer = player ?? st.ourServer ?? st.config.ourFirstServer
                st.lastOurServer = st.ourServer
            }
        }
    }

    /// «Aos 40-40» a meio: passa a valer no jogo seguinte.
    public mutating func setNextDeuceMode(_ mode: DeuceMode) {
        change { st in st.nextDeuceMode = mode == st.deuceMode ? nil : mode }
    }

    public mutating func correct(games: [Int], points: [Int]) {
        change { st in st = Scoring.correct(st, games: games, points: points) }
    }

    // MARK: - Depois do fim

    /// «Quão duro foi?»: de 1 a 10; fora disso não muda nada.
    public mutating func setEffort(_ value: Int, for id: UUID) {
        guard (1...10).contains(value), let i = history.firstIndex(where: { $0.id == id }) else { return }
        history[i].effort = value
    }

    /// Pulsação média e calorias do treino, quando o Saúde as dá.
    public mutating func setHealth(averageHeartRate: Int?, kilocalories: Int?, for id: UUID) {
        guard let i = history.firstIndex(where: { $0.id == id }) else { return }
        history[i].averageHeartRate = averageHeartRate
        history[i].activeKilocalories = kilocalories
    }

    /// 20 minutos sem pontos (e sem pausa): «Ainda estão a jogar?».
    public func isForgotten(at date: Date) -> Bool {
        guard let s = current, !s.isOver, s.pausedAt == nil else { return false }
        return date.timeIntervalSince(s.lastPointAt ?? s.startedAt) >= 20 * 60
    }

    private mutating func change(_ apply: (inout MatchState) -> Void) {
        guard var st = current, !st.isOver else { return }
        undoStack.append(st)
        apply(&st)
        current = st
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
        guard s.hasPoints else { return }
        history.insert(MatchRecord(s), at: 0)
        if history.count > Self.historyLimit { history.removeLast(history.count - Self.historyLimit) }
    }
}
