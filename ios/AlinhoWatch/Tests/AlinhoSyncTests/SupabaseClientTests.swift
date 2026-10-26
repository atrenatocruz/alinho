import Foundation
import Testing
@testable import AlinhoSync
@testable import PadelScoring

// Pedidos ao Supabase sem rede: um transport falso guarda os pedidos e devolve
// respostas preparadas. Ver docs/superpowers/specs/2026-10-26-relogio-mix-a-decorrer-design.md.

let syncNow = Date(timeIntervalSince1970: 1_800_000_000)
let syncURL = URL(string: "https://proj.supabase.co")!

func credentials(expiresIn: TimeInterval = 3600) -> WatchCredentials {
    WatchCredentials(
        supabaseURL: syncURL, anonKey: "anon-key", accessToken: "access-1", refreshToken: "refresh-1",
        expiresAt: syncNow.addingTimeInterval(expiresIn),
        userID: UUID(uuidString: "11111111-1111-1111-1111-111111111111")!)
}

/// Guarda a sessão em memória.
final class MemoryStore: CredentialStore, @unchecked Sendable {
    private let lock = NSLock()
    private var value: WatchCredentials?
    init(_ c: WatchCredentials?) { value = c }
    func load() -> WatchCredentials? { lock.lock(); defer { lock.unlock() }; return value }
    func save(_ c: WatchCredentials?) { lock.lock(); defer { lock.unlock() }; value = c }
}

/// Responde por ordem às respostas preparadas; sem respostas, 200 com `{}`.
actor FakeTransport: HTTPTransport {
    /// `act`: corre a ação (com o pedido «no ar») e depois responde.
    enum Reply { case http(Int, String), fail, act(@Sendable () async -> Void, Int, String) }
    private var replies: [Reply]
    private(set) var requests: [URLRequest] = []

    init(_ replies: [Reply] = []) { self.replies = replies }

    func enqueue(_ r: Reply) { replies.append(r) }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        var reply = replies.isEmpty ? .http(200, "{}") : replies.removeFirst()
        if case let .act(action, status, body) = reply {
            await action()
            reply = .http(status, body)
        }
        switch reply {
        case .fail, .act:
            throw URLError(.notConnectedToInternet)
        case let .http(status, body):
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
            return (Data(body.utf8), response)
        }
    }
}

func bodyJSON(_ r: URLRequest) -> [String: Any] {
    guard let d = r.httpBody, let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return [:] }
    return o
}

/// Uma resposta qualquer de um RPC.
struct AnyReply: Decodable {}

func client(_ store: MemoryStore, _ t: FakeTransport) -> SupabaseClient {
    SupabaseClient(store: store, transport: t, now: { syncNow })
}

@Test func testRPCSendsAuthHeaders() async throws {
    let t = FakeTransport([.http(200, "[]")])
    let c = client(MemoryStore(credentials()), t)
    let list: [MixMatch] = try await c.rpc("list_my_watch_mix_matches", [:])
    #expect(list.isEmpty)
    let reqs = await t.requests
    #expect(reqs.count == 1)
    let r = try #require(reqs.first)
    #expect(r.url?.absoluteString == "https://proj.supabase.co/rest/v1/rpc/list_my_watch_mix_matches")
    #expect(r.httpMethod == "POST")
    #expect(r.value(forHTTPHeaderField: "apikey") == "anon-key")
    #expect(r.value(forHTTPHeaderField: "Authorization") == "Bearer access-1")
    #expect(r.value(forHTTPHeaderField: "Content-Type") == "application/json")
}

@Test func testRefreshesNearExpiry() async throws {
    let t = FakeTransport([
        .http(200, #"{"access_token":"access-2","refresh_token":"refresh-2","expires_in":3600,"expires_at":1800003600}"#),
        .http(200, "{}"),
    ])
    let store = MemoryStore(credentials(expiresIn: 30))
    let _: AnyReply = try await client(store, t).rpc("claim_mix_match", ["p_match_id": "x"])
    let reqs = await t.requests
    #expect(reqs.count == 2)
    let refresh = reqs[0]
    #expect(refresh.url?.absoluteString == "https://proj.supabase.co/auth/v1/token?grant_type=refresh_token")
    #expect(refresh.httpMethod == "POST")
    #expect(refresh.value(forHTTPHeaderField: "apikey") == "anon-key")
    #expect(bodyJSON(refresh)["refresh_token"] as? String == "refresh-1")
    // O pedido a seguir já vai com o token novo.
    #expect(reqs[1].value(forHTTPHeaderField: "Authorization") == "Bearer access-2")
    let saved = try #require(store.load())
    #expect(saved.accessToken == "access-2")
    #expect(saved.refreshToken == "refresh-2")
    #expect(saved.expiresAt == Date(timeIntervalSince1970: 1_800_003_600))
    #expect(saved.userID == credentials().userID)
}

@Test func testRefreshUsesExpiresInWhenNoExpiresAt() async throws {
    let t = FakeTransport([.http(200, #"{"access_token":"a2","refresh_token":"r2","expires_in":3600}"#)])
    let store = MemoryStore(credentials(expiresIn: 10))
    let _: AnyReply = try await client(store, t).rpc("list_my_watch_mix_matches", [:])
    #expect(store.load()?.expiresAt == syncNow.addingTimeInterval(3600))
}

@Test func testRefreshRejectedSignsOut() async throws {
    let t = FakeTransport([.http(400, #"{"error":"invalid_grant"}"#)])
    let store = MemoryStore(credentials(expiresIn: 30))
    await #expect(throws: SyncError.signedOut) {
        let _: AnyReply = try await client(store, t).rpc("list_my_watch_mix_matches", [:])
    }
    #expect(store.load() == nil)
    #expect(await t.requests.count == 1)
}

@Test func testNoCredentialsIsSignedOut() async throws {
    let t = FakeTransport()
    await #expect(throws: SyncError.signedOut) {
        let _: AnyReply = try await client(MemoryStore(nil), t).rpc("list_my_watch_mix_matches", [:])
    }
    #expect(await t.requests.isEmpty)
}

@Test func testMissingRPCIsUnavailable() async throws {
    let t = FakeTransport([.http(404, #"{"code":"PGRST202","message":"Could not find the function"}"#)])
    await #expect(throws: SyncError.unavailable) {
        let _: AnyReply = try await client(MemoryStore(credentials()), t).rpc("list_my_watch_mix_matches", [:])
    }
}

@Test func testServerErrorCode() async throws {
    let t = FakeTransport([.http(400, #"{"code":"P0001","message":"taken","details":null,"hint":null}"#)])
    await #expect(throws: SyncError.server("taken")) {
        let _: ClaimResult = try await client(MemoryStore(credentials()), t).rpc("claim_mix_match", ["p_match_id": "x"])
    }
}

@Test func testTransportFailureIsNetwork() async throws {
    let t = FakeTransport([.fail])
    await #expect(throws: SyncError.network) {
        let _: AnyReply = try await client(MemoryStore(credentials()), t).rpc("list_my_watch_mix_matches", [:])
    }
}

@Test func testExpiredJWTRefreshesAndRetries() async throws {
    // O servidor recusa o token antes da hora (relógio adiantado): renova e tenta outra vez.
    let t = FakeTransport([
        .http(401, #"{"code":"PGRST303","message":"JWT expired"}"#),
        .http(200, #"{"access_token":"access-2","refresh_token":"refresh-2","expires_in":3600}"#),
        .http(200, "{}"),
    ])
    let store = MemoryStore(credentials())
    let _: AnyReply = try await client(store, t).rpc("list_my_watch_mix_matches", [:])
    let reqs = await t.requests
    #expect(reqs.count == 3)
    #expect(reqs[2].value(forHTTPHeaderField: "Authorization") == "Bearer access-2")
    #expect(store.load()?.accessToken == "access-2")
}

@Test func testDecodeMixMatch() throws {
    let json = #"""
    [{"match_id":"6f1c2a4e-0000-4000-8000-000000000001","game_id":"6f1c2a4e-0000-4000-8000-000000000002",
      "game_name":"Mix de quinta","round_number":2,"court_number":3,"my_side":"b",
      "partner_name":"Rita","opponent_names":["Ana","Rui"],"format":"sobe_desce",
      "scoring_format":"pro_set_9","deuce_mode":"ponto_de_ouro","tiebreak_8_8":null,
      "scorer_id":null,"scorer_name":null}]
    """#
    let list = try JSONDecoder().decode([MixMatch].self, from: Data(json.utf8))
    let m = try #require(list.first)
    #expect(m.id == UUID(uuidString: "6f1c2a4e-0000-4000-8000-000000000001"))
    #expect(m.matchID == m.id)
    #expect(m.gameName == "Mix de quinta")
    #expect(m.roundNumber == 2)
    #expect(m.courtNumber == 3)
    #expect(m.mySide == .b)
    #expect(m.partnerName == "Rita")
    #expect(m.opponentNames.count == 2)
    #expect(m.scoringFormat == "pro_set_9")
    #expect(m.deuceMode == "ponto_de_ouro")
    #expect(m.tiebreak88 == nil)
    #expect(m.scorerID == nil)
    #expect(m.scorerName == nil)
}

@Test func testDecodeClaimResult() throws {
    let json = #"{"match_id":"6f1c2a4e-0000-4000-8000-000000000001","my_side":"a"}"#
    let r = try JSONDecoder().decode(ClaimResult.self, from: Data(json.utf8))
    #expect(r.matchID == UUID(uuidString: "6f1c2a4e-0000-4000-8000-000000000001"))
    #expect(r.mySide == .a)
}

// MARK: - Falhas passageiras não são recusas do servidor

@Test func testRateLimitIsNetwork() async throws {
    // 429 (e 408) é «tenta mais tarde», mesmo com uma `message` no corpo.
    let t = FakeTransport([.http(429, #"{"message":"rate limited"}"#), .http(408, "")])
    let c = client(MemoryStore(credentials()), t)
    await #expect(throws: SyncError.network) {
        let _: AnyReply = try await c.rpc("list_my_watch_mix_matches", [:])
    }
    await #expect(throws: SyncError.network) {
        let _: AnyReply = try await c.rpc("list_my_watch_mix_matches", [:])
    }
}

@Test func testClientErrorWithoutPostgrestBodyIsNetwork() async throws {
    let t = FakeTransport([.http(400, "<html>proxy</html>")])
    await #expect(throws: SyncError.network) {
        let _: AnyReply = try await client(MemoryStore(credentials()), t).rpc("list_my_watch_mix_matches", [:])
    }
}

@Test func testHTMLSuccessIsNetwork() async throws {
    // Um portal cativo responde 200 com uma página: não conta como gravado.
    let t = FakeTransport([.http(200, "<html>Wi-Fi login</html>")])
    await #expect(throws: SyncError.network) {
        let _: AnyReply = try await client(MemoryStore(credentials()), t).rpc("list_my_watch_mix_matches", [:])
    }
}

@Test func testStaleRefreshKeepsNewerSession() async throws {
    // O iPhone manda uma sessão nova enquanto o relógio renova a antiga; a
    // antiga é recusada, mas a nova não se apaga e o pedido segue com ela.
    let store = MemoryStore(credentials(expiresIn: 30))
    var newer = credentials()
    newer.accessToken = "access-new"
    newer.refreshToken = "refresh-new"
    let fresh = newer
    let t = FakeTransport([
        .act({ store.save(fresh) }, 400, #"{"error":"invalid_grant"}"#),
        .http(200, "{}"),
    ])
    let _: AnyReply = try await client(store, t).rpc("list_my_watch_mix_matches", [:])
    #expect(store.load() == fresh)
    let reqs = await t.requests
    #expect(reqs.count == 2)
    #expect(reqs[1].value(forHTTPHeaderField: "Authorization") == "Bearer access-new")
}

@Test func testDecodeMixMatchHasResult() throws {
    let base = #"{"match_id":"6f1c2a4e-0000-4000-8000-000000000001","game_id":"6f1c2a4e-0000-4000-8000-000000000002","game_name":"Mix","round_number":1,"court_number":1,"my_side":"a","partner_name":"Rita","opponent_names":["Ana","Rui"],"format":"sobe_desce","scoring_format":"pro_set_9","deuce_mode":"ponto_de_ouro","tiebreak_8_8":null,"scorer_id":null,"scorer_name":null"#
    // Sem o campo (migração antiga): sem resultado.
    #expect(try JSONDecoder().decode(MixMatch.self, from: Data((base + "}").utf8)).hasResult == false)
    #expect(try JSONDecoder().decode(MixMatch.self, from: Data((base + #","has_result":true}"#).utf8)).hasResult == true)
}
