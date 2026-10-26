import Foundation
import Testing
@testable import AlinhoSync
@testable import PadelScoring

// A fila do resultado: guarda o resultado final de um jogo do mix até o
// `save_mix_match_result` o aceitar (ou o recusar de vez).

private let matchID = UUID(uuidString: "6f1c2a4e-0000-4000-8000-000000000001")!

/// `MixResult` só se constrói a partir de um `MatchRecord`; aqui vem do JSON.
private func result(_ a: Int, _ b: Int, sets: String = "null") -> MixResult {
    let json = #"{"scoreA":\#(a),"scoreB":\#(b),"sets":\#(sets)}"#
    return try! JSONDecoder().decode(MixResult.self, from: Data(json.utf8))
}

private func entry(_ r: MixResult, _ id: UUID = matchID) -> OutboxEntry {
    OutboxEntry(mixMatchID: id, result: r, createdAt: syncNow)
}

private func tempFile() -> URL {
    FileManager.default.temporaryDirectory
        .appendingPathComponent("outbox-\(UUID().uuidString)")
        .appendingPathComponent("outbox.json")
}

@Test func testOutboxReplacesSameMatch() async throws {
    let t = FakeTransport()
    let box = ResultOutbox(fileURL: nil)
    await box.put(entry(result(9, 7)))
    await box.put(entry(result(2, 1, sets: #"[{"score_a":6,"score_b":4,"is_super_tiebreak":false},{"score_a":3,"score_b":6,"is_super_tiebreak":false},{"score_a":10,"score_b":8,"is_super_tiebreak":true}]"#)))
    #expect(await box.status(matchID) == .pending)
    await box.flush(using: client(MemoryStore(credentials()), t))
    let reqs = await t.requests
    #expect(reqs.count == 1)
    let r = try #require(reqs.first)
    #expect(r.url?.absoluteString == "https://proj.supabase.co/rest/v1/rpc/save_mix_match_result")
    let body = bodyJSON(r)
    #expect(body["p_match_id"] as? String == matchID.uuidString.lowercased())
    #expect(body["p_score_a"] as? Int == 2)
    #expect(body["p_score_b"] as? Int == 1)
    let sets = try #require(body["p_sets"] as? [[String: Any]])
    #expect(sets.count == 3)
    #expect(sets[2]["score_a"] as? Int == 10)
    #expect(sets[2]["is_super_tiebreak"] as? Bool == true)
    #expect(await box.status(matchID) == .sent)
}

@Test func testOutboxSendsNullSets() async throws {
    let t = FakeTransport()
    let box = ResultOutbox(fileURL: nil)
    await box.put(entry(result(9, 7)))
    await box.flush(using: client(MemoryStore(credentials()), t))
    let body = bodyJSON(try #require(await t.requests.first))
    #expect(body["p_score_a"] as? Int == 9)
    #expect(body["p_score_b"] as? Int == 7)
    #expect(body["p_sets"] is NSNull)
}

@Test func testOutboxDropsNotAllowed() async throws {
    let t = FakeTransport([.http(400, #"{"code":"P0001","message":"not_allowed"}"#)])
    let box = ResultOutbox(fileURL: nil)
    await box.put(entry(result(9, 7)))
    let c = client(MemoryStore(credentials()), t)
    await box.flush(using: c)
    #expect(await box.status(matchID) == .dropped("not_allowed"))
    await box.flush(using: c)
    #expect(await t.requests.count == 1)
}

@Test func testOutboxKeepsOnNetworkError() async throws {
    let t = FakeTransport([.fail])
    let box = ResultOutbox(fileURL: nil)
    await box.put(entry(result(9, 7)))
    let c = client(MemoryStore(credentials()), t)
    await box.flush(using: c)
    #expect(await box.status(matchID) == .pending)
    await t.enqueue(.http(200, "{}"))
    await box.flush(using: c)
    #expect(await box.status(matchID) == .sent)
    #expect(await t.requests.count == 2)
}

@Test func testOutboxKeepsWhenSignedOut() async throws {
    let t = FakeTransport()
    let box = ResultOutbox(fileURL: nil)
    await box.put(entry(result(9, 7)))
    await box.flush(using: client(MemoryStore(nil), t))
    #expect(await box.status(matchID) == .pending)
    #expect(await t.requests.isEmpty)
}

@Test func testOutboxKeepsWhenUnavailable() async throws {
    let t = FakeTransport([.http(404, #"{"code":"PGRST202"}"#)])
    let box = ResultOutbox(fileURL: nil)
    await box.put(entry(result(9, 7)))
    await box.flush(using: client(MemoryStore(credentials()), t))
    #expect(await box.status(matchID) == .pending)
}

@Test func testOutboxUnknownMatchIsNone() async {
    let box = ResultOutbox(fileURL: nil)
    #expect(await box.status(UUID()) == .none)
}

@Test func testOutboxPersists() async throws {
    let file = tempFile()
    defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
    let box = ResultOutbox(fileURL: file)
    await box.put(entry(result(9, 7)))
    let again = ResultOutbox(fileURL: file)
    #expect(await again.status(matchID) == .pending)
    // Enviado, sai do ficheiro.
    await again.flush(using: client(MemoryStore(credentials()), FakeTransport()))
    #expect(await ResultOutbox(fileURL: file).status(matchID) != .pending)
}
