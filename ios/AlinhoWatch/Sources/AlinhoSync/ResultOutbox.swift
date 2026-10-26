import Foundation
import PadelScoring

/// O resultado final de um jogo do mix, à espera de seguir para o Supabase.
public struct OutboxEntry: Codable, Equatable, Sendable {
    public let mixMatchID: UUID
    public let result: MixResult
    public let createdAt: Date

    public init(mixMatchID: UUID, result: MixResult, createdAt: Date) {
        self.mixMatchID = mixMatchID
        self.result = result
        self.createdAt = createdAt
    }
}

/// Em que ponto está o resultado de um jogo.
public enum OutboxStatus: Equatable, Sendable {
    /// Nada na fila para este jogo.
    case none
    /// À espera (sem rede, sem sessão, ou o RPC ainda não existe).
    case pending
    /// Gravado no mix.
    case sent
    /// O mix recusou-o de vez (`not_allowed`, `empty`, …): saiu da fila.
    case dropped(String)
}

/// Fila do resultado: guarda-o num ficheiro até o `save_mix_match_result` o
/// aceitar, para a falta de rede no fim do jogo não o perder. Um jogo tem no
/// máximo uma entrada; um `put` novo substitui a anterior.
public actor ResultOutbox {
    private let fileURL: URL?
    private var entries: [OutboxEntry]
    /// O que já saiu da fila nesta execução (enviado ou recusado).
    private var finished: [UUID: OutboxStatus] = [:]
    private var flushing = false
    /// Houve um `put` durante a volta do `flush` em curso.
    private var putDuringFlush = false

    /// `fileURL == nil`: só em memória.
    public init(fileURL: URL?) {
        self.fileURL = fileURL
        // Um ficheiro que não se lê (estragado, de outra versão) conta como vazio.
        if let fileURL, let data = try? Data(contentsOf: fileURL),
           let saved = try? JSONDecoder().decode([OutboxEntry].self, from: data) {
            entries = saved
        } else {
            entries = []
        }
    }

    public static var defaultURL: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("alinho-relogio/outbox.json")
    }

    public func put(_ e: OutboxEntry) {
        entries.removeAll { $0.mixMatchID == e.mixMatchID }
        entries.append(e)
        finished[e.mixMatchID] = nil
        if flushing { putDuringFlush = true }
        persist()
    }

    public func status(_ mixMatchID: UUID) -> OutboxStatus {
        if entries.contains(where: { $0.mixMatchID == mixMatchID }) { return .pending }
        return finished[mixMatchID] ?? OutboxStatus.none
    }

    /// Tenta enviar tudo o que está na fila. Erros de rede, sessão ou RPC em falta
    /// deixam a entrada para a próxima; uma recusa do servidor tira-a. O que
    /// chegar com um `put` a meio segue no mesmo `flush` (outra volta), a não
    /// ser que uma falha tenha deixado entradas à espera.
    public func flush(using client: SupabaseClient) async {
        guard !flushing else { return }
        flushing = true
        defer { flushing = false }

        var failed = false
        repeat {
            putDuringFlush = false
            failed = await flushPass(using: client)
        } while putDuringFlush && !failed
    }

    /// Uma volta pela fila; devolve `true` se alguma entrada ficou por falha.
    private func flushPass(using client: SupabaseClient) async -> Bool {
        var failed = false
        for entry in entries {
            let body: Data
            do { body = try Self.body(entry) } catch { failed = true; continue }
            let outcome: OutboxStatus
            do {
                _ = try await client.rpcData("save_mix_match_result", body: body)
                outcome = .sent
            } catch SyncError.server(let code) {
                outcome = .dropped(code)
            } catch {
                failed = true
                continue
            }
            // Um `put` durante o envio pode ter trocado o resultado: esse fica na
            // fila (e o `putDuringFlush` manda-o na volta seguinte).
            guard let i = entries.firstIndex(of: entry) else { continue }
            entries.remove(at: i)
            finished[entry.mixMatchID] = outcome
            persist()
        }
        return failed
    }

    /// `p_match_id`, `p_score_a`, `p_score_b` e `p_sets` (os sets em JSON, ou `null`).
    static func body(_ e: OutboxEntry) throws -> Data {
        var sets: Any = NSNull()
        if let s = e.result.sets {
            sets = try JSONSerialization.jsonObject(with: JSONEncoder().encode(s))
        }
        let args: [String: Any] = [
            "p_match_id": e.mixMatchID.uuidString.lowercased(),
            "p_score_a": e.result.scoreA,
            "p_score_b": e.result.scoreB,
            "p_sets": sets,
        ]
        return try JSONSerialization.data(withJSONObject: args)
    }

    private func persist() {
        guard let fileURL else { return }
        do {
            try FileManager.default.createDirectory(
                at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONEncoder().encode(entries).write(to: fileURL, options: .atomic)
        } catch {
            // Sem disco, a fila continua em memória até a app fechar.
        }
    }
}
