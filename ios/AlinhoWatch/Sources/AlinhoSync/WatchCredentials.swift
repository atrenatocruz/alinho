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
