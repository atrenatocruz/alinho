import Capacitor
import Foundation
import WatchConnectivity

// Jogos do relógio no iPhone (Fase B do relógio): o relógio manda cada jogo acabado
// com `transferUserInfo`; aqui guardam-se num ficheiro e dão-se à app web pelo
// plugin `WatchGames` (src/lib/watchGames.js). A saúde (pulsação, kcal, esforço)
// fica só neste ficheiro, no telemóvel; nada disto vai ao servidor.

/// Os jogos guardados, o mais recente primeiro. Cada jogo é o JSON que o relógio
/// mandou (campos novos passam sem mudar nada aqui) mais `registeredMatchId`.
final class WatchGamesStore: NSObject {
    static let shared = WatchGamesStore()
    static let received = Notification.Name("alinho.watchGames.received")

    private let queue = DispatchQueue(label: "alinho.watchGames")
    private var games: [[String: Any]] = []
    /// Jogos apagados no telemóvel: um envio atrasado do relógio não os traz de volta.
    private var removedIDs: Set<String> = []
    private let fileURL: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("alinho-relogio/watch-games.json")
    }()

    override init() {
        super.init()
        load()
    }

    /// Chamar no arranque da app, para receber mesmo sem a página aberta.
    func activate() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func all() -> [[String: Any]] {
        queue.sync { games }
    }

    func isRemoved(_ id: String) -> Bool {
        queue.sync { removedIDs.contains(id) }
    }

    func remove(id: String) {
        queue.sync {
            games.removeAll { $0["id"] as? String == id }
            removedIDs.insert(id)
            save()
        }
    }

    func markRegistered(id: String, friendMatchId: String) {
        queue.sync {
            guard let i = games.firstIndex(where: { $0["id"] as? String == id }) else { return }
            games[i]["registeredMatchId"] = friendMatchId
            save()
        }
    }

    /// Junta pelo `id`: fica o de `updatedAt` mais recente; `deleted` apaga.
    /// Devolve o jogo como ficou (`nil` se foi apagado ou ignorado).
    @discardableResult
    func merge(_ game: [String: Any]) -> [String: Any]? {
        guard let id = game["id"] as? String else { return nil }
        return queue.sync {
            if removedIDs.contains(id) { return nil }
            let existing = games.firstIndex { $0["id"] as? String == id }
            if let i = existing, (games[i]["updatedAt"] as? String ?? "") > (game["updatedAt"] as? String ?? "") {
                return games[i]
            }
            if game["deleted"] as? Bool == true {
                if let i = existing { games.remove(at: i) }
                save()
                return nil
            }
            var merged = game
            if let i = existing {
                merged["registeredMatchId"] = games[i]["registeredMatchId"]
                games.remove(at: i)
            }
            games.append(merged)
            games.sort { ($0["startedAt"] as? String ?? "") > ($1["startedAt"] as? String ?? "") }
            save()
            return merged
        }
    }

    private func load() {
        guard let data = try? Data(contentsOf: fileURL),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return }
        games = root["games"] as? [[String: Any]] ?? []
        removedIDs = Set(root["removedIds"] as? [String] ?? [])
    }

    /// Só dentro da `queue`.
    private func save() {
        let root: [String: Any] = ["games": games, "removedIds": Array(removedIDs)]
        guard let data = try? JSONSerialization.data(withJSONObject: root) else { return }
        try? FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: fileURL, options: .atomic)
    }
}

extension WatchGamesStore: WCSessionDelegate {
    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {}

    func sessionDidBecomeInactive(_ session: WCSession) {}

    // Trocar de relógio: volta a ativar para o novo.
    func sessionDidDeactivate(_ session: WCSession) {
        WCSession.default.activate()
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        guard let json = userInfo["game"] as? String,
              let game = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any]
        else { return }
        // Apagado no telemóvel: o envio atrasado do relógio não o traz de volta.
        guard let id = game["id"] as? String, !isRemoved(id) else { return }
        // Apagado no relógio (`deleted`): a página tira-o da lista.
        let shown = merge(game) ?? ["id": id, "deleted": true]
        NotificationCenter.default.post(name: Self.received, object: nil, userInfo: ["game": shown])
    }
}

/// `WatchGames` na app web: `list()`, `remove({ id })`, `markRegistered({ id,
/// friendMatchId })` e o evento `gameReceived`.
@objc(WatchGamesPlugin)
public class WatchGamesPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WatchGamesPlugin"
    public let jsName = "WatchGames"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "markRegistered", returnType: CAPPluginReturnPromise),
    ]

    private var observer: NSObjectProtocol?

    override public func load() {
        observer = NotificationCenter.default.addObserver(
            forName: WatchGamesStore.received, object: nil, queue: .main
        ) { [weak self] note in
            guard let game = note.userInfo?["game"] as? [String: Any] else { return }
            self?.notifyListeners("gameReceived", data: ["game": game])
        }
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }

    @objc func list(_ call: CAPPluginCall) {
        call.resolve(["games": WatchGamesStore.shared.all()])
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { return call.reject("id em falta") }
        WatchGamesStore.shared.remove(id: id)
        call.resolve()
    }

    @objc func markRegistered(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let match = call.getString("friendMatchId") else {
            return call.reject("id ou friendMatchId em falta")
        }
        WatchGamesStore.shared.markRegistered(id: id, friendMatchId: match)
        call.resolve()
    }
}

/// O view controller da app (Main.storyboard): o do Capacitor, mais o plugin local.
class AlinhoBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(WatchGamesPlugin())
    }
}
