import Foundation

/// Quem faz os pedidos HTTP. Na app é o `URLSessionTransport`; nos testes, um falso.
public protocol HTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

/// O transport de verdade, por `URLSession`.
public struct URLSessionTransport: HTTPTransport {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (data, http)
    }
}

/// O que pode correr mal ao falar com o Supabase.
public enum SyncError: Error, Equatable {
    /// Sem sessão, ou o Supabase recusou renová-la: é preciso ligar o relógio outra vez.
    case signedOut
    /// O RPC não existe (404 ou `PGRST202`): a migração ainda não correu neste projeto.
    case unavailable
    /// O RPC recusou o pedido; o código é a `message` do PostgREST (`taken`, `not_allowed`, …).
    case server(String)
    /// Sem rede, ou uma falha do servidor que vale a pena tentar mais tarde.
    case network
}

/// Fala com o Supabase por REST, sem SDK, com a sessão própria do relógio.
/// Antes de cada pedido, se o token estiver quase a acabar (menos de 60 s),
/// renova-o e grava o par novo na `CredentialStore`.
public actor SupabaseClient {
    private let store: CredentialStore
    private let transport: HTTPTransport
    private let now: @Sendable () -> Date
    /// A renovação em curso: dois pedidos ao mesmo tempo esperam pela mesma,
    /// porque o `refresh_token` só se pode usar uma vez.
    private var refreshing: Task<WatchCredentials, Error>?

    public init(store: CredentialStore, transport: HTTPTransport, now: @escaping @Sendable () -> Date = { Date() }) {
        self.store = store
        self.transport = transport
        self.now = now
    }

    /// Chama `POST /rest/v1/rpc/{name}` com `args` como corpo JSON e descodifica a resposta.
    public nonisolated func rpc<T: Decodable>(_ name: String, _ args: [String: Any]) async throws -> T {
        let body: Data
        do { body = try JSONSerialization.data(withJSONObject: args) } catch { throw SyncError.server("bad_args") }
        let data = try await rpcData(name, body: body)
        return try JSONDecoder().decode(T.self, from: data)
    }

    /// Como `rpc`, mas com o corpo já em JSON e a resposta por descodificar.
    func rpcData(_ name: String, body: Data) async throws -> Data {
        var creds = try await validCredentials()
        var (data, response) = try await post(rpc: name, body: body, creds: creds)
        if response.statusCode == 401 {
            // O servidor recusou o token antes da hora (relógio adiantado, por
            // exemplo): renova e tenta uma vez mais.
            creds = try await refresh(from: creds)
            (data, response) = try await post(rpc: name, body: body, creds: creds)
        }
        try check(response.statusCode, data)
        return data
    }

    // MARK: - Pedidos

    private func post(rpc name: String, body: Data, creds: WatchCredentials) async throws -> (Data, HTTPURLResponse) {
        var request = URLRequest(url: creds.supabaseURL.appendingPathComponent("rest/v1/rpc/\(name)"))
        request.httpMethod = "POST"
        request.setValue(creds.anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(creds.accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = body
        return try await send(request)
    }

    private func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do { return try await transport.send(request) } catch { throw SyncError.network }
    }

    /// Erros do PostgREST: `{"code": "...", "message": "..."}`.
    private struct PostgrestError: Decodable {
        let code: String?
        let message: String?
    }

    /// Só é recusa do servidor (`.server`) um erro do PostgREST com `message`:
    /// a fila deita fora o resultado nesse caso, por isso tudo o que possa ser
    /// passageiro (408, 429, 5xx, um proxy ou portal cativo a responder HTML)
    /// é `.network` e fica para a próxima.
    private func check(_ status: Int, _ data: Data) throws {
        if (200..<300).contains(status) {
            // Um 200 com uma página (portal cativo do Wi-Fi) não é uma resposta do RPC.
            if status == 204 && data.isEmpty { return }
            guard (try? JSONSerialization.jsonObject(with: data, options: .fragmentsAllowed)) != nil
            else { throw SyncError.network }
            return
        }
        let error = try? JSONDecoder().decode(PostgrestError.self, from: data)
        if status == 404 || error?.code == "PGRST202" { throw SyncError.unavailable }
        // 401 que se mantém com o token acabado de renovar, pedido demorado,
        // limite de pedidos ou falha do servidor: tentar mais tarde.
        if status == 401 || status == 408 || status == 429 || status >= 500 { throw SyncError.network }
        guard let message = error?.message else { throw SyncError.network }
        throw SyncError.server(message)
    }

    // MARK: - Sessão

    private func validCredentials() async throws -> WatchCredentials {
        guard let creds = store.load() else { throw SyncError.signedOut }
        if creds.expiresAt.timeIntervalSince(now()) < 60 {
            return try await refresh(from: creds)
        }
        return creds
    }

    private func refresh(from creds: WatchCredentials) async throws -> WatchCredentials {
        if let task = refreshing { return try await task.value }
        // Outro pedido já renovou entretanto: o `refresh_token` antigo já não vale.
        if let stored = store.load(), stored.accessToken != creds.accessToken {
            return stored
        }
        let task = Task { try await self.performRefresh(from: creds) }
        refreshing = task
        defer { refreshing = nil }
        return try await task.value
    }

    /// Resposta de `/auth/v1/token`: o GoTrue manda `expires_in` e, nas versões
    /// recentes, também `expires_at` (segundos).
    private struct TokenResponse: Decodable {
        let access_token: String
        let refresh_token: String
        let expires_in: Double?
        let expires_at: Double?
    }

    private func performRefresh(from creds: WatchCredentials) async throws -> WatchCredentials {
        var components = URLComponents(url: creds.supabaseURL.appendingPathComponent("auth/v1/token"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "grant_type", value: "refresh_token")]
        var request = URLRequest(url: components.url!)
        request.httpMethod = "POST"
        request.setValue(creds.anonKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["refresh_token": creds.refreshToken])

        let (data, response) = try await send(request)
        if response.statusCode == 400 || response.statusCode == 401 {
            // Se entretanto chegou outra sessão (o iPhone mandou uma nova), a
            // recusa é só da antiga: segue com a nova em vez de a apagar.
            guard let stored = store.load() else { throw SyncError.signedOut }
            if stored.refreshToken != creds.refreshToken { return stored }
            store.save(nil)
            throw SyncError.signedOut
        }
        guard (200..<300).contains(response.statusCode),
              let token = try? JSONDecoder().decode(TokenResponse.self, from: data)
        else { throw SyncError.network }

        var fresh = creds
        fresh.accessToken = token.access_token
        fresh.refreshToken = token.refresh_token
        if let at = token.expires_at {
            fresh.expiresAt = Date(timeIntervalSince1970: at)
        } else {
            fresh.expiresAt = now().addingTimeInterval(token.expires_in ?? 3600)
        }
        // O mesmo: se a sessão mudou durante a renovação, a guardada ganha.
        guard let stored = store.load() else { throw SyncError.signedOut }
        if stored.refreshToken != creds.refreshToken { return stored }
        store.save(fresh)
        return fresh
    }
}
