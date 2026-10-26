#if os(watchOS)
import Foundation
import PadelScoring
import WatchConnectivity

/// Manda cada jogo acabado ao iPhone com `transferUserInfo`: o sistema guarda e
/// entrega mesmo com a app do iPhone fechada ou o telemóvel longe. O que se manda
/// antes de a sessão ativar fica à espera e segue quando ativar.
@MainActor
final class WatchLink: NSObject {
    static let shared = WatchLink()

    private var pending: [WatchGamePayload] = []
    private var active = false

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

    fileprivate func didActivate() {
        active = true
        let queued = pending
        pending = []
        queued.forEach(send)
    }
}

extension WatchLink: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        guard state == .activated else { return }
        Task { @MainActor in self.didActivate() }
    }
}
#endif
