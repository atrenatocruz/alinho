#if os(watchOS)
import Foundation
import PadelScoring
import SwiftUI

/// Aviso no ecrã todo, 2 s, por cima do marcador.
enum Overlay: Equatable {
    case switchSides
    case decisive(StatusLabel)
}

/// Depois do fim: primeiro «Quão duro foi?» (se houve pontos), depois o resumo.
enum EndStep: Equatable {
    case effort, summary
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
    /// Página do jogo: 0 = menu do jogo, 1 = marcador, 2 = treino. Abre no marcador.
    @Published var page = 1 { didSet { touch() } }
    /// Jogo acabado: o ecrã a mostrar. `nil` (ao abrir a app) = o resumo.
    @Published var endStep: EndStep?
    /// «Ainda estão a jogar?» (20 min sem pontos).
    @Published var idlePrompt = false
    /// Há um ecrã aberto por cima do menu (acertar, listas): não volta sozinho ao marcador.
    var inSubscreen = false { didSet { touch() } }
    private var lastTouch = Date()
    private var idleDismissedAt: Date?
    /// Quando o ecrã acordou do pulso em baixo (ver `WakeGuard`).
    @Published var wokeAt: Date?
    /// Só nas prints: abre logo nos «Últimos jogos».
    @Published var showHistory = false

    private let store: SessionStore?
    /// O treino no Saúde. Nas prints dos ecrãs nunca arranca.
    let recorder = WorkoutRecorder()
    private let recordsWorkouts: Bool
    /// O jogo acabado cujo treino já se gravou (ver `finalizeWorkout`).
    private var finalizedMatchID: UUID?
    private var overlayTask: Task<Void, Never>?

    /// `store == nil`: não grava (prints dos ecrãs).
    init(store: SessionStore? = SessionStore(fileURL: SessionStore.defaultURL), session: MatchSession? = nil) {
        self.store = store
        self.recordsWorkouts = store != nil
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
        model.idlePrompt = f.idle
        model.endStep = f.endStep
        if let h = f.health {
            model.recorder.preview(heartRate: h.0, averageHeartRate: h.1, kilocalories: h.2, authorized: h.3)
        }
        return model
    }

    /// Ao abrir a app: com um jogo a decorrer retoma o treino; com um jogo acabado
    /// grava o treino que tenha ficado por gravar.
    func resumeWorkoutIfNeeded() async {
        guard let current, recordsWorkouts else { return }
        if current.isOver { await finalizeWorkout() } else { await recorder.begin(matchID: current.id) }
    }

    /// Grava (ou deita fora, num jogo sem pontos) o treino do jogo acabado. Uma vez
    /// gravado, desfazer o fim arranca outro treino.
    func finalizeWorkout() async {
        guard let current, current.isOver, finalizedMatchID != current.id else { return }
        finalizedMatchID = current.id
        if let record = session.history.first(where: { $0.id == current.id }) {
            await recorder.finish(record: record)
        } else {
            recorder.discard()
        }
    }

    /// No fim do jogo o treino só pára; os números do Saúde ficam no registo.
    private func matchEnded() {
        endStep = current?.hasPoints == true ? .effort : .summary
        recorder.pause()
        guard let id = current?.id, recorder.authorized == true else { return }
        session.setHealth(
            averageHeartRate: recorder.averageHeartRate,
            kilocalories: Int(recorder.kilocalories.rounded()),
            for: id
        )
    }

    var current: MatchState? { session.current }

    func setConfig(_ config: MatchConfig) {
        session.config = config
        save()
    }

    func start() {
        session.start(at: Date())
        page = 1
        idleDismissedAt = nil
        save()
        if recordsWorkouts, let id = current?.id { Task { await recorder.begin(matchID: id) } }
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
            matchEnded()
            save()
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
        if current?.isOver != true { endStep = nil }
        if wasOver, let current {
            if finalizedMatchID == current.id {
                finalizedMatchID = nil
                if recordsWorkouts { Task { await recorder.begin(matchID: current.id) } }
            } else {
                recorder.resume()
            }
        }
        hideOverlay()
        Haptic.play(.undo)
        save()
    }

    func stop() {
        session.stop(at: Date())
        matchEnded()
        hideOverlay()
        Haptic.play(.long)
        save()
    }

    func newMatch() {
        Task {
            await finalizeWorkout()
            endStep = nil
            session.clearFinished()
            save()
        }
    }

    // MARK: - Esforço

    func saveEffort(_ value: Int) {
        if let id = current?.id { session.setEffort(value, for: id) }
        endStep = .summary
        save()
    }

    func skipEffort() {
        endStep = .summary
    }

    // MARK: - Segundo ecrã

    func togglePause() {
        session.togglePause(at: Date())
        if current?.pausedAt != nil { recorder.pause() } else { recorder.resume() }
        page = 1
        save()
    }

    func setServer(_ team: Team, player: Player?) {
        session.setServer(team, player: player)
        page = 1
        save()
    }

    func setNextDeuceMode(_ mode: DeuceMode) {
        session.setNextDeuceMode(mode)
        save()
    }

    func correct(games: [Int], points: [Int]) {
        session.correct(games: games, points: points)
        page = 1
        save()
    }

    // MARK: - Regressos sozinhos

    /// Qualquer toque ou mudança de página: adia o regresso ao marcador.
    func touch() {
        lastTouch = Date()
    }

    /// Chamado a cada 2 s com um jogo a decorrer: fora do marcador, 10 s sem mexer
    /// volta ao marcador; 20 min sem pontos pergunta «Ainda estão a jogar?».
    func tick(now: Date = Date()) {
        guard let current else { return }
        // Cinco minutos depois do fim o treino grava-se, mesmo sem «Novo jogo».
        if current.isOver {
            if let end = current.endedAt, now.timeIntervalSince(end) >= 5 * 60 {
                Task { await finalizeWorkout() }
            }
            return
        }
        if page != 1 && !inSubscreen && now.timeIntervalSince(lastTouch) >= 10 { page = 1 }
        let quietSince = max(current.lastPointAt ?? current.startedAt, idleDismissedAt ?? .distantPast)
        if !idlePrompt && current.pausedAt == nil && session.isForgotten(at: now)
            && now.timeIntervalSince(quietSince) >= 20 * 60 {
            idlePrompt = true
            Haptic.play(.touch)
        }
    }

    func keepPlaying() {
        idleDismissedAt = Date()
        idlePrompt = false
        page = 1
    }

    func stopFromIdle() {
        idlePrompt = false
        stop()
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
