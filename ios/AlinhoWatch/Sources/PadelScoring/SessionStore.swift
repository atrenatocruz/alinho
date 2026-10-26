import Foundation

/// Grava a sessão num ficheiro JSON, para a app fechar ou o relógio desligar a
/// meio do jogo e, ao abrir, continuar onde estava.
public struct SessionStore: Sendable {
    public let fileURL: URL

    public init(fileURL: URL) {
        self.fileURL = fileURL
    }

    public static var defaultURL: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("alinho-relogio/session.json")
    }

    /// Sem ficheiro, ou um ficheiro que não se lê (estragado, de outra versão):
    /// começa do zero em vez de rebentar.
    public func load() -> MatchSession {
        guard let data = try? Data(contentsOf: fileURL),
              let session = try? JSONDecoder().decode(MatchSession.self, from: data)
        else { return MatchSession() }
        var loaded = session
        loaded.retireLegacyPoints(at: Date())
        return loaded
    }

    public func save(_ session: MatchSession) throws {
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(session).write(to: fileURL, options: .atomic)
    }
}
