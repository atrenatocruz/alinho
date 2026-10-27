#if os(watchOS)
import AlinhoSync
import Foundation
import PadelScoring

/// O jogo do relógio que conta um jogo do mix: o resultado final vai para o mix
/// (pela `ResultOutbox`) em vez de ir ao iPhone como jogo entre amigos.
struct MixLink: Codable, Equatable {
    let localMatchID: UUID
    let mixMatchID: UUID
    let side: MixSide
    let title: String
    /// Quem ficou com o jogo. `nil` num vínculo de uma versão antiga: o user atual.
    let userID: UUID?

    init(localMatchID: UUID, mixMatchID: UUID, side: MixSide, title: String, userID: UUID? = nil) {
        self.localMatchID = localMatchID
        self.mixMatchID = mixMatchID
        self.side = side
        self.title = title
        self.userID = userID
    }

    enum CodingKeys: String, CodingKey {
        case localMatchID, mixMatchID, side, title, userID
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        localMatchID = try c.decode(UUID.self, forKey: .localMatchID)
        mixMatchID = try c.decode(UUID.self, forKey: .mixMatchID)
        side = try c.decode(MixSide.self, forKey: .side)
        title = try c.decode(String.self, forKey: .title)
        userID = try c.decodeIfPresent(UUID.self, forKey: .userID)
    }
}

/// Credenciais fixas, só para as prints dos ecrãs.
private struct MemoryCredentialStore: CredentialStore {
    let creds: WatchCredentials?
    func load() -> WatchCredentials? { creds }
    func save(_ c: WatchCredentials?) {}
}

/// «Jogos do mix»: a lista que vem do Supabase, ficar com um jogo e a fila do
/// resultado. Fala com o Supabase com a sessão própria do relógio (Keychain).
@MainActor
final class MixModel: ObservableObject {
    enum State: Equatable { case idle, loading, signedOut, unavailable, failed }

    @Published var matches: [MixMatch] = []
    @Published var state: State = .idle
    /// Há sessão no relógio.
    @Published private(set) var hasCredentials: Bool
    /// O vínculo em curso (gravado num ficheiro, para sobreviver a um arranque).
    @Published private(set) var link: MixLink? = nil
    /// Em que ponto está o resultado do jogo do `link`.
    @Published private(set) var sendStatus: OutboxStatus = OutboxStatus.none

    let outbox: ResultOutbox
    private let credentials: CredentialStore
    private let client: SupabaseClient
    private let linkURL: URL?
    /// `false` nas prints: nada vai à rede nem ao disco.
    private let live: Bool
    private var askedForSession = false
    private var lastFlush = Date.distantPast
    private var loading = false
    /// A app vive tanto como o modelo: o observador nunca sai.
    private var sessionObserver: NSObjectProtocol?

    static var defaultLinkURL: URL {
        SessionStore.defaultURL.deletingLastPathComponent().appendingPathComponent("mix-link.json")
    }

    init() {
        let store = KeychainCredentialStore()
        credentials = store
        client = SupabaseClient(store: store, transport: URLSessionTransport())
        outbox = ResultOutbox(fileURL: ResultOutbox.defaultURL)
        linkURL = Self.defaultLinkURL
        live = true
        hasCredentials = store.load() != nil
        if let data = try? Data(contentsOf: Self.defaultLinkURL) {
            link = try? JSONDecoder().decode(MixLink.self, from: data)
        }
        sessionObserver = NotificationCenter.default.addObserver(
            forName: .watchSessionChanged, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.sessionChanged() }
        }
    }

    /// Para as prints: um estado fixo, com uma sessão a fingir.
    init(preview matches: [MixMatch], state: State = .idle, link: MixLink? = nil, status: OutboxStatus = OutboxStatus.none) {
        let store = MemoryCredentialStore(creds: WatchCredentials(
            supabaseURL: URL(string: "https://example.invalid")!, anonKey: "", accessToken: "",
            refreshToken: "", expiresAt: .distantFuture, userID: Self.previewUserID))
        credentials = store
        client = SupabaseClient(store: store, transport: URLSessionTransport())
        outbox = ResultOutbox(fileURL: nil)
        linkURL = nil
        live = false
        hasCredentials = true
        self.matches = matches
        self.state = state
        self.link = link
        sendStatus = status
    }

    static let previewUserID = UUID(uuidString: "00000000-0000-4000-8000-0000000000aa")!

    /// Quem tem o relógio.
    var userID: UUID? { credentials.load()?.userID }

    /// O botão «Jogos do mix» aparece. Também sem sessão: lá dentro diz para
    /// abrir o alinho no iPhone, em vez de o botão faltar sem explicação.
    var showsEntry: Bool { state != .unavailable }

    // MARK: - Lista

    /// No «Novo jogo»: sem sessão pede uma ao iPhone (uma vez por arranque);
    /// com sessão, vai buscar a lista (e fica a saber se o RPC existe).
    func setupAppeared() {
        guard live else { return }
        if hasCredentials { refresh() } else { askForSessionOnce() }
    }

    func refresh() {
        Task { await reload() }
    }

    func reload() async {
        guard live, !loading else { return }
        guard credentials.load() != nil else {
            signedOut()
            return
        }
        loading = true
        defer { loading = false }
        state = .loading
        do {
            let list: [MixMatch] = try await client.rpc("list_my_watch_mix_matches", [:])
            matches = list
            state = .idle
        } catch SyncError.signedOut {
            signedOut()
        } catch SyncError.unavailable {
            state = .unavailable
        } catch {
            // Rede, servidor, ou uma resposta que não se lê (`DecodingError`).
            state = .failed
        }
    }

    /// Fica com o jogo (`claim_mix_match`). Os erros chegam como `SyncError`; uma
    /// resposta que não se lê conta como `.network`.
    func claim(_ m: MixMatch) async throws -> ClaimResult {
        do {
            return try await client.rpc("claim_mix_match", ["p_match_id": m.matchID.uuidString.lowercased()])
        } catch let error as SyncError {
            if error == .signedOut { signedOut() }
            throw error
        } catch {
            throw SyncError.network
        }
    }

    private func signedOut() {
        hasCredentials = false
        matches = []
        state = .signedOut
        askForSessionOnce()
    }

    private func askForSessionOnce() {
        guard live, !askedForSession else { return }
        askedForSession = true
        WatchLink.shared.requestSession()
    }

    private func sessionChanged() {
        hasCredentials = credentials.load() != nil
        if hasCredentials {
            // Sessão nova: se voltar a cair, pode pedir-se outra.
            askedForSession = false
            refresh()
            // O que ficou na fila por falta de sessão segue já.
            Task { await flush() }
        } else {
            matches = []
            state = .signedOut
        }
    }

    // MARK: - Vínculo e resultado

    func setLink(_ l: MixLink?) {
        link = l
        sendStatus = OutboxStatus.none
        guard let linkURL else { return }
        if let l, let data = try? JSONEncoder().encode(l) {
            try? FileManager.default.createDirectory(
                at: linkURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? data.write(to: linkURL, options: .atomic)
        } else {
            try? FileManager.default.removeItem(at: linkURL)
        }
    }

    /// O vínculo do jogo `localMatchID`, se for um jogo do mix.
    func mixLink(for localMatchID: UUID?) -> MixLink? {
        guard let link, link.localMatchID == localMatchID else { return nil }
        return link
    }

    /// O jogo acabou (ou voltou a acabar depois de um «Desfazer»): o resultado
    /// entra na fila, por cima de um anterior do mesmo jogo, e segue logo.
    func submit(_ record: MatchRecord) {
        guard let link = mixLink(for: record.id) else { return }
        let entry = OutboxEntry(mixMatchID: link.mixMatchID, result: MixResult(record: record, side: link.side),
                                createdAt: Date(), userID: link.userID)
        sendStatus = .pending
        Task {
            await outbox.put(entry)
            await flush()
        }
    }

    func flush() async {
        guard live else { return }
        lastFlush = Date()
        // Sem sessão a meio do envio: como na lista, fica «sem sessão» e pede outra.
        if await outbox.flush(using: client) { signedOut() }
        await updateStatus()
    }

    func updateStatus() async {
        guard live else { return }
        guard let link else { sendStatus = OutboxStatus.none; return }
        sendStatus = await outbox.status(link.mixMatchID)
    }

    /// Chamado a cada 2 s: de 30 em 30 s tenta outra vez a fila. Com a fila
    /// vazia não há pedido nenhum, por isso não é preciso saber se há `pending`.
    func tick(now: Date = Date()) {
        guard live, now.timeIntervalSince(lastFlush) >= 30 else { return }
        lastFlush = now
        Task { await flush() }
    }
}

/// Os textos dos jogos do mix.
enum MixText {
    /// «Ronda 2 · Campo 3».
    static func title(_ m: MixMatch) -> String {
        L.t("Ronda \(m.roundNumber) · Campo \(m.courtNumber)")
    }

    /// «com Rita F. · contra Rui M. e Ana P.».
    static func pairs(_ m: MixMatch) -> String {
        L.t("com \(shortName(m.partnerName)) · contra \(opponents(m))")
    }

    /// «Rui M. e Ana P.».
    static func opponents(_ m: MixMatch) -> String {
        let names = m.opponentNames.map(shortName)
        guard names.count == 2 else { return names.joined(separator: ", ") }
        return L.t("\(names[0]) e \(names[1])")
    }

    /// A linha do ecrã de fim; `nil` = nada a mostrar.
    static func status(_ s: OutboxStatus) -> String? {
        switch s {
        case .none: return nil
        case .pending: return L.t("A enviar para o mix…")
        case .sent: return L.t("Gravado no mix ✓")
        case .dropped("not_allowed"): return L.t("O mix já fechou. Pede ao admin para meter o resultado.")
        case .dropped: return L.t("O mix recusou o resultado. Pede ao admin para o meter.")
        }
    }
}
#endif
