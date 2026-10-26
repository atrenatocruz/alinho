#if os(watchOS)
import AlinhoSync
import Foundation
import Security

/// A sessão do relógio no Keychain (um só item, service `pt.alinho.watch.session`).
/// Fica legível depois do primeiro desbloqueio, para a fila do resultado poder
/// enviar com o ecrã apagado.
struct KeychainCredentialStore: CredentialStore {
    /// Resumo do último contexto do iPhone aplicado. Só o `WatchLink.applySession`
    /// lhe mexe: apagar a sessão aqui (o refresh recusado) NÃO o esquece, senão o
    /// mesmo contexto, com um `refresh_token` já gasto, voltava a entrar.
    static let appliedContextKey = "alinho.watch.appliedSessionDigest"

    private let service = "pt.alinho.watch.session"
    private let account = "session"

    private var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    func load() -> WatchCredentials? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data
        else { return nil }
        return try? JSONDecoder().decode(WatchCredentials.self, from: data)
    }

    func save(_ c: WatchCredentials?) {
        guard let c, let data = try? JSONEncoder().encode(c) else {
            SecItemDelete(query as CFDictionary)
            return
        }
        let update: [String: Any] = [kSecValueData as String: data]
        let status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var add = query
            add[kSecValueData as String] = data
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            SecItemAdd(add as CFDictionary, nil)
        }
    }
}
#endif
