import Foundation

/// O que o relógio manda ao iPhone por cada jogo acabado (e de novo quando muda o
/// esforço ou o treino, ou quando o «Desfazer» o apaga). O iPhone junta pelo `id` e
/// fica com o de `updatedAt` mais recente. JSON com datas ISO 8601, para a app web
/// o ler sem conversões; campos novos só se acrescentam, nunca se mudam.
public struct WatchGamePayload: Codable, Equatable, Sendable {
    public static let currentVersion = 2

    public let version: Int
    public let id: UUID
    public let updatedAt: Date
    public let format: String
    public let resultText: String
    /// `[[nós, eles], …]`; nos Pontos um só par com os jogos da ronda.
    public let sets: [[Int]]
    /// `"us"`, `"them"` ou `nil` (empate).
    public let winner: String?
    public let endReason: String
    public let startedAt: Date
    public let minutes: Int
    public let effort: Int?
    public let averageHeartRate: Int?
    public let activeKilocalories: Int?
    /// O jogo deixou de existir no relógio (desfazer depois do fim).
    public let deleted: Bool

    public init(_ r: MatchRecord, updatedAt: Date) {
        version = Self.currentVersion
        id = r.id
        self.updatedAt = updatedAt
        format = r.format.rawValue
        resultText = r.resultText
        if r.format == .points {
            sets = [r.games.isEmpty ? r.points : r.games]
        } else {
            sets = r.sets.map { [$0.us, $0.them] }
        }
        winner = r.winner.map { $0 == .us ? "us" : "them" }
        endReason = r.endReason.rawValue
        startedAt = r.startedAt
        minutes = r.minutes
        effort = r.effort
        averageHeartRate = r.averageHeartRate
        activeKilocalories = r.activeKilocalories
        deleted = false
    }

    private init(deletedID: UUID, at date: Date) {
        version = Self.currentVersion
        id = deletedID
        updatedAt = date
        format = ""
        resultText = ""
        sets = []
        winner = nil
        endReason = ""
        startedAt = date
        minutes = 0
        effort = nil
        averageHeartRate = nil
        activeKilocalories = nil
        deleted = true
    }

    public static func deleted(id: UUID, at date: Date) -> WatchGamePayload {
        WatchGamePayload(deletedID: id, at: date)
    }

    public func encoded() throws -> Data {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        e.outputFormatting = .sortedKeys
        return try e.encode(self)
    }

    public static func decode(_ data: Data) throws -> WatchGamePayload {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return try d.decode(WatchGamePayload.self, from: data)
    }

    /// Para `WCSession.transferUserInfo`: o JSON numa string, em `"game"`.
    public func userInfo() -> [String: Any] {
        guard let data = try? encoded(), let json = String(data: data, encoding: .utf8) else { return [:] }
        return ["game": json]
    }
}
