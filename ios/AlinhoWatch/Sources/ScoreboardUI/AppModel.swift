#if os(watchOS)
import Foundation
import PadelScoring
import SwiftUI

/// Aviso no ecrã todo, 2 s, por cima do marcador.
enum Overlay: Equatable {
    case switchSides
    case decisive(StatusLabel)
}

/// O que está a receber o dedo pousado. Só um de cada vez: a manga a tocar nos
/// dois blocos não pode dar dois pontos.
enum HoldTarget: Equatable {
    case block(Team), undo, end
}

/// Estado da app: a sessão (regras, desfazer, últimos jogos) e o que só existe
/// no ecrã (avisos, toque comprido). Cada ação grava logo no disco.
@MainActor
final class AppModel: ObservableObject {
    @Published private(set) var session: MatchSession
    @Published var overlay: Overlay?
    @Published var activeHold: HoldTarget?
    /// Último bloco que contou um ponto, para o contorno branco piscar.
    @Published var flash: Team?
    /// Página do jogo: 0 = marcador, 1 = menu do jogo.
    @Published var page = 0
    /// Quando o ecrã acordou do pulso em baixo (ver `WakeGuard`).
    @Published var wokeAt: Date?
    /// Só nas prints: abre logo nos «Últimos jogos».
    @Published var showHistory = false

    private let store: SessionStore?
    /// Sessão de treino para o ecrã não se apagar; `nil` nas prints dos ecrãs.
    private let keeper: WorkoutKeeper?
    private var overlayTask: Task<Void, Never>?

    /// `store == nil`: não grava (prints dos ecrãs).
    init(store: SessionStore? = SessionStore(fileURL: SessionStore.defaultURL), session: MatchSession? = nil) {
        self.store = store
        self.keeper = store == nil ? nil : WorkoutKeeper()
        self.session = session ?? store?.load() ?? MatchSession()
    }

    /// O modelo da app; com `-screenshot <nome>`, um estado fixo que não grava.
    static func launch() -> AppModel {
        guard let name = ScreenshotFixtures.requested, let f = ScreenshotFixtures.make(name) else {
            return AppModel()
        }
        let model = AppModel(store: nil, session: f.session)
        model.overlay = f.overlay
        model.page = f.page
        model.showHistory = f.showHistory
        return model
    }

    /// Ao abrir a app com um jogo a decorrer.
    func resumeWorkoutIfNeeded() async {
        if let current, !current.isOver { await keeper?.begin() }
    }

    var current: MatchState? { session.current }

    func setConfig(_ config: MatchConfig) {
        session.config = config
        save()
    }

    func start() {
        session.start(at: Date())
        page = 0
        save()
        Task { await keeper?.begin() }
    }

    func point(_ team: Team) {
        let events = session.point(team, at: Date())
        guard !events.isEmpty else { return }
        save()
        flash = team
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(220))
            if flash == team { flash = nil }
        }
        if events.contains(.matchOver) {
            Haptic.play(.long)
            keeper?.end()
            return
        }
        if events.contains(.setWon) { Haptic.play(.long) } else { Haptic.point(team) }
        if events.contains(.switchSides) {
            show(.switchSides, doubleAfter: .milliseconds(250))
        } else if events.contains(.decisivePoint), let status = current?.display.status {
            show(.decisive(status), doubleAfter: .zero)
        }
    }

    func undo() {
        let wasOver = current?.isOver == true
        guard session.undo() else { return }
        if wasOver { Task { await keeper?.begin() } }
        hideOverlay()
        Haptic.play(.undo)
        save()
    }

    func stop() {
        session.stop(at: Date())
        keeper?.end()
        hideOverlay()
        Haptic.play(.long)
        save()
    }

    func newMatch() {
        session.clearFinished()
        save()
    }

    private func show(_ o: Overlay, doubleAfter delay: Duration) {
        overlayTask?.cancel()
        overlay = o
        overlayTask = Task { @MainActor in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            Haptic.play(.double)
            try? await Task.sleep(for: .seconds(2) - delay)
            guard !Task.isCancelled else { return }
            overlay = nil
        }
    }

    /// Um toque no aviso fecha-o, para o «Desfazer» não ficar tapado 2 s.
    func hideOverlay() {
        overlayTask?.cancel()
        overlay = nil
    }

    private func save() {
        try? store?.save(session)
    }
}
#endif
