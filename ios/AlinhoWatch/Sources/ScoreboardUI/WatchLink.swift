#if os(watchOS)
import AlinhoSync
import CryptoKit
import Foundation
import PadelScoring
import WatchConnectivity

extension Notification.Name {
    /// A sessão do relógio no Keychain mudou (chegou uma nova, ou saiu da conta).
    static let watchSessionChanged = Notification.Name("alinho.watch.sessionChanged")
}

/// Manda cada jogo acabado ao iPhone com `transferUserInfo`: o sistema guarda e
/// entrega mesmo com a app do iPhone fechada ou o telemóvel longe. O que se manda
/// antes de a sessão ativar fica à espera e segue quando ativar.
///
/// Recebe também a sessão do Supabase que o iPhone põe no `applicationContext`
/// (chave `"session"`: o JSON da sessão, ou `"none"`) e grava-a no Keychain.
@MainActor
final class WatchLink: NSObject {
    static let shared = WatchLink()

    private var pending: [WatchGamePayload] = []
    private var active = false
    private var sessionRequested = false
    private let credentials: CredentialStore = KeychainCredentialStore()

    func activate() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func send(_ payload: WatchGamePayload) {
        guard WCSession.isSupported() else { return }
        guard active else { pending.append(payload); return }
        WCSession.default.transferUserInfo(payload.userInfo())
    }

    /// Pede ao iPhone uma sessão para o relógio (`["kind": "needSession"]`).
    func requestSession() {
        guard WCSession.isSupported() else { return }
        guard active else { sessionRequested = true; return }
        WCSession.default.transferUserInfo(["kind": "needSession"])
    }

    fileprivate func didActivate(context: String?) {
        active = true
        if let context { applySession(context) }
        let queued = pending
        pending = []
        queued.forEach(send)
        if sessionRequested {
            sessionRequested = false
            requestSession()
        }
    }

    /// Grava a sessão que veio do iPhone. O mesmo contexto volta a aparecer em
    /// cada arranque (`receivedApplicationContext`): aplicá-lo outra vez repunha
    /// um `refresh_token` que o relógio já gastou ao renovar, e a sessão morria.
    /// Por isso só se aplica um contexto diferente do último (pelo SHA-256).
    fileprivate func applySession(_ value: String) {
        let key = KeychainCredentialStore.appliedContextKey
        let digest = SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
        guard UserDefaults.standard.string(forKey: key) != digest else { return }
        if value == "none" {
            credentials.save(nil)
        } else if let creds = WatchCredentials.fromPhoneContext(value) {
            credentials.save(creds)
        } else {
            return
        }
        UserDefaults.standard.set(digest, forKey: key)
        NotificationCenter.default.post(name: .watchSessionChanged, object: nil)
    }
}

extension WatchLink: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        guard state == .activated else { return }
        let context = session.receivedApplicationContext["session"] as? String
        Task { @MainActor in self.didActivate(context: context) }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        guard let value = applicationContext["session"] as? String else { return }
        Task { @MainActor in self.applySession(value) }
    }
}
#endif
