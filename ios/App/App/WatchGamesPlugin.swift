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
    /// O relógio pediu uma sessão (`["kind": "needSession"]`).
    static let sessionNeeded = Notification.Name("alinho.watchGames.sessionNeeded")
    /// A ligação ao relógio ficou ativa ou mudou (emparelhado, app instalada):
    /// a página volta a ver se tem de mandar a sessão.
    static let stateChanged = Notification.Name("alinho.watchGames.stateChanged")

    private let queue = DispatchQueue(label: "alinho.watchGames")
    private var games: [[String: Any]] = []
    /// Jogos apagados no telemóvel: um envio atrasado do relógio não os traz de volta.
    private var removedIDs: Set<String> = []
    private let fileURL: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("alinho-relogio/watch-games.json")
    }()

    // A sessão do relógio (Relógio no mix, Fase A; src/lib/watchSession.js):
    // para que user se mandou a última e se o relógio pediu outra. Os tokens
    // não ficam aqui: só vão no applicationContext.
    private var sentUserId: String?
    private var needsSession = false
    /// Saiu da conta mas o "none" ainda não chegou ao applicationContext
    /// (relógio por ativar, ou o envio falhou). Fica guardado e tenta-se outra
    /// vez em `activationDidCompleteWith`; enquanto estiver marcado, nunca se
    /// manda uma sessão.
    private var pendingClear = false
    /// O último erro ao entregar a sessão ao relógio (só para o diagnóstico).
    private var lastSendError: String?
    private let sessionFileURL: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("alinho-relogio/watch-session.json")
    }()

    override init() {
        super.init()
        load()
        loadSessionState()
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

    // MARK: Sessão do relógio
    //
    // O relógio lê no applicationContext a chave "session", sempre uma string:
    //   - um JSON {access_token, refresh_token, expires_at (segundos), user_id,
    //     supabase_url, anon_key}, ou
    //   - "none": sem sessão (saiu da conta no telemóvel).
    // Pede outra com transferUserInfo ["kind": "needSession"]. Nunca registar os tokens.

    /// `installed`: há relógio emparelhado com a app instalada. Um pedido do
    /// relógio (`needsSession`) também prova que a app lá está, mesmo que o
    /// `isWatchAppInstalled` ainda diga que não. `activated`, `paired`,
    /// `appInstalled` e `lastError` são só para o diagnóstico.
    func sessionStatus() -> [String: Any] {
        var activated = false, paired = false, appInstalled = false
        if WCSession.isSupported() {
            let wc = WCSession.default
            activated = wc.activationState == .activated
            paired = activated && wc.isPaired
            appInstalled = activated && wc.isWatchAppInstalled
        }
        return queue.sync {
            [
                "installed": paired && (appInstalled || needsSession),
                "sentUserId": sentUserId.map { $0 as Any } ?? NSNull(),
                "needsSession": needsSession,
                "activated": activated,
                "paired": paired,
                "appInstalled": appInstalled,
                "lastError": lastSendError.map { $0 as Any } ?? NSNull(),
            ] as [String: Any]
        }
    }

    func recordSendError(_ error: Error?) {
        queue.sync { lastSendError = error.map { String(describing: $0) } }
    }

    /// Entrega ao relógio a sessão (`json`, já no formato de cima) do `userId`.
    func sendSession(json: String, userId: String) throws {
        guard WCSession.isSupported() else { throw WatchSessionError.unsupported }
        // Há um "none" por mandar: primeiro ele; se ainda não der, não se manda nada.
        try flushPendingClear()
        try WCSession.default.updateApplicationContext(["session": json])
        queue.sync {
            sentUserId = userId
            needsSession = false
            saveSessionState()
        }
    }

    /// O relógio fica sem sessão ("none"). Se não der já, fica pendente.
    func clearSession() throws {
        queue.sync {
            pendingClear = true
            saveSessionState()
        }
        try flushPendingClear()
    }

    /// Manda o "none" pendente. Só larga `sentUserId` e `pendingClear` quando
    /// o applicationContext ficou mesmo atualizado.
    func flushPendingClear() throws {
        guard queue.sync(execute: { pendingClear }) else { return }
        if WCSession.isSupported() {
            guard WCSession.default.activationState == .activated else { throw WatchSessionError.notActivated }
            try WCSession.default.updateApplicationContext(["session": "none"])
        }
        // Sem WatchConnectivity (iPad) não há relógio: nada a mandar.
        queue.sync {
            pendingClear = false
            sentUserId = nil
            saveSessionState()
        }
    }

    func markSessionNeeded() {
        queue.sync {
            needsSession = true
            saveSessionState()
        }
    }

    private func loadSessionState() {
        guard let data = try? Data(contentsOf: sessionFileURL),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return }
        sentUserId = root["sentUserId"] as? String
        needsSession = root["needsSession"] as? Bool ?? false
        pendingClear = root["pendingClear"] as? Bool ?? false
    }

    /// Só dentro da `queue`.
    private func saveSessionState() {
        var root: [String: Any] = ["needsSession": needsSession, "pendingClear": pendingClear]
        if let sentUserId { root["sentUserId"] = sentUserId }
        guard let data = try? JSONSerialization.data(withJSONObject: root) else { return }
        try? FileManager.default.createDirectory(at: sessionFileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: sessionFileURL, options: .atomic)
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
    // Um "none" que ficou por mandar (saiu da conta com o relógio por ativar).
    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        guard activationState == .activated else { return }
        try? flushPendingClear()
        // No arranque a página pergunta antes de a ligação estar ativa (e
        // desiste): agora já pode mandar.
        NotificationCenter.default.post(name: Self.stateChanged, object: nil)
    }

    // Emparelhou outro relógio, ou a app do relógio foi instalada/apagada.
    func sessionWatchStateDidChange(_ session: WCSession) {
        NotificationCenter.default.post(name: Self.stateChanged, object: nil)
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}

    // Trocar de relógio: volta a ativar para o novo.
    func sessionDidDeactivate(_ session: WCSession) {
        WCSession.default.activate()
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        // O relógio pede uma sessão: fica marcado; a página manda-a quando
        // puder (já, se estiver aberta; senão ao voltar à app).
        if userInfo["kind"] as? String == "needSession" {
            markSessionNeeded()
            NotificationCenter.default.post(name: Self.sessionNeeded, object: nil)
            return
        }
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

enum WatchSessionError: Error {
    case unsupported
    case notActivated
}

/// `WatchGames` na app web: `list()`, `remove({ id })`, `markRegistered({ id,
/// friendMatchId })` e o evento `gameReceived`. A sessão do relógio:
/// `watchSessionStatus()`, `sendWatchSession({ session, supabaseUrl, anonKey })`,
/// `clearWatchSession()` e o evento `sessionNeeded` (src/lib/watchSession.js).
@objc(WatchGamesPlugin)
public class WatchGamesPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WatchGamesPlugin"
    public let jsName = "WatchGames"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "markRegistered", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "watchSessionStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sendWatchSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearWatchSession", returnType: CAPPluginReturnPromise),
    ]

    private var observer: NSObjectProtocol?
    private var sessionObserver: NSObjectProtocol?
    private var stateObserver: NSObjectProtocol?

    override public func load() {
        observer = NotificationCenter.default.addObserver(
            forName: WatchGamesStore.received, object: nil, queue: .main
        ) { [weak self] note in
            guard let game = note.userInfo?["game"] as? [String: Any] else { return }
            self?.notifyListeners("gameReceived", data: ["game": game])
        }
        sessionObserver = NotificationCenter.default.addObserver(
            forName: WatchGamesStore.sessionNeeded, object: nil, queue: .main
        ) { [weak self] _ in
            self?.notifyListeners("sessionNeeded", data: [:])
        }
        stateObserver = NotificationCenter.default.addObserver(
            forName: WatchGamesStore.stateChanged, object: nil, queue: .main
        ) { [weak self] _ in
            self?.notifyListeners("watchStateChanged", data: [:])
        }
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
        if let sessionObserver { NotificationCenter.default.removeObserver(sessionObserver) }
        if let stateObserver { NotificationCenter.default.removeObserver(stateObserver) }
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

    @objc func watchSessionStatus(_ call: CAPPluginCall) {
        call.resolve(WatchGamesStore.shared.sessionStatus())
    }

    /// Junta `supabaseUrl` e `anonKey` à sessão e manda tudo numa string JSON
    /// (formato no `WatchGamesStore`). Os erros nunca levam os tokens.
    @objc func sendWatchSession(_ call: CAPPluginCall) {
        guard let session = call.getObject("session"),
              let accessToken = session["access_token"] as? String,
              let refreshToken = session["refresh_token"] as? String,
              let expiresAt = session["expires_at"] as? NSNumber,
              let userId = session["user_id"] as? String,
              let supabaseUrl = call.getString("supabaseUrl"),
              let anonKey = call.getString("anonKey")
        else { return call.reject("sessão incompleta") }
        let payload: [String: Any] = [
            "access_token": accessToken,
            "refresh_token": refreshToken,
            "expires_at": expiresAt.int64Value,
            "user_id": userId,
            "supabase_url": supabaseUrl,
            "anon_key": anonKey,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8)
        else { return call.reject("sessão inválida") }
        do {
            try WatchGamesStore.shared.sendSession(json: json, userId: userId)
            WatchGamesStore.shared.recordSendError(nil)
            call.resolve()
        } catch {
            WatchGamesStore.shared.recordSendError(error)
            call.reject("relógio indisponível")
        }
    }

    @objc func clearWatchSession(_ call: CAPPluginCall) {
        // Se o relógio não estiver ativo, o "none" fica pendente e vai quando
        // ativar; até lá não se manda nenhuma sessão.
        try? WatchGamesStore.shared.clearSession()
        call.resolve()
    }
}

/// O view controller da app (Main.storyboard): o do Capacitor, mais o plugin local.
class AlinhoBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(WatchGamesPlugin())
    }
}
