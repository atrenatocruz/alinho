import Foundation

/// A sessão do relógio no Supabase: o projeto (`supabaseURL` + `anonKey`) e o par
/// de tokens que a Edge Function `watch-session` devolve (`access_token`,
/// `refresh_token`, `expires_at` em segundos, `user_id`). O relógio fala com o
/// Supabase por si, sem passar pelo iPhone.
public struct WatchCredentials: Codable, Equatable, Sendable {
    public var supabaseURL: URL
    public var anonKey: String
    public var accessToken: String
    public var refreshToken: String
    /// Quando o `accessToken` deixa de valer.
    public var expiresAt: Date
    public var userID: UUID

    public init(supabaseURL: URL, anonKey: String, accessToken: String, refreshToken: String, expiresAt: Date, userID: UUID) {
        self.supabaseURL = supabaseURL
        self.anonKey = anonKey
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.expiresAt = expiresAt
        self.userID = userID
    }
}

/// Onde a sessão fica guardada. No relógio é o Keychain; nos testes, memória.
/// `save(nil)` apaga-a (sessão terminada).
public protocol CredentialStore: Sendable {
    func load() -> WatchCredentials?
    func save(_ c: WatchCredentials?)
}

extension WatchCredentials {
    /// O formato que o iPhone põe no `applicationContext` (chave `"session"`):
    /// `{access_token, refresh_token, expires_at (segundos), user_id,
    /// supabase_url, anon_key}`. `nil` se faltar alguma coisa ou não se ler.
    public static func fromPhoneContext(_ json: String) -> WatchCredentials? {
        struct Wire: Decodable {
            let access_token: String
            let refresh_token: String
            let expires_at: Double
            let user_id: String
            let supabase_url: String
            let anon_key: String
        }
        guard let wire = try? JSONDecoder().decode(Wire.self, from: Data(json.utf8)),
              let url = URL(string: wire.supabase_url),
              let userID = UUID(uuidString: wire.user_id)
        else { return nil }
        return WatchCredentials(
            supabaseURL: url,
            anonKey: wire.anon_key,
            accessToken: wire.access_token,
            refreshToken: wire.refresh_token,
            expiresAt: Date(timeIntervalSince1970: wire.expires_at),
            userID: userID
        )
    }
}
